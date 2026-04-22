#![no_std]

//! Mango v4 perps resolver for Beethoven.
//!
//! Account layout + data encoding ported from mango-v4 IDL v0.33.9 and
//! cross-checked against an SDK-built `perpPlaceOrderIx` (Group 1701,
//! BTC-PERP, owner = our deploy wallet — see
//! `packages/programs/scripts/mango-test-place-order.mjs`).
//!
//! Live devnet execution is currently blocked by the Mango devnet SOL
//! oracle's confidence band (error 6023 OracleConfidence on tokenDeposit).
//! The ix construction itself doesn't run health/oracle checks, so the
//! captured 52-byte data + 8-fixed account list is the byte-exact
//! reference; `health_remaining_accounts` is forwarded verbatim from the
//! caller and computed client-side via Mango's `buildHealthRemainingAccounts`.

use {
    beethoven_core::Perps,
    core::mem::MaybeUninit,
    solana_account_view::AccountView,
    solana_address::Address,
    solana_instruction_view::{
        cpi::{invoke_signed, Signer},
        InstructionAccount, InstructionView,
    },
    solana_program_error::{ProgramError, ProgramResult},
};

/// Mango v4 program ID (same on mainnet/testnet/devnet).
/// `4MangoMjqJ2firMokCjjGgoK8d4MXcrgL7XJaL3w6fVg`
pub const MANGO_V4_PROGRAM_ID: Address = Address::new_from_array([
    0x31, 0xd8, 0xe1, 0x7d, 0xde, 0x0f, 0x59, 0xc1,
    0x8e, 0x07, 0x5b, 0x98, 0xca, 0x9d, 0x6b, 0x65,
    0xc8, 0xfa, 0x24, 0xed, 0x50, 0x6d, 0x20, 0x6c,
    0x5e, 0xbe, 0x3c, 0x18, 0x0f, 0x02, 0x37, 0x7f,
]);

/// Anchor disc for `perp_place_order`. sha256("global:perp_place_order")[..8].
pub const PERP_PLACE_ORDER_DISCRIMINATOR: [u8; 8] =
    [189, 196, 225, 201, 114, 172, 25, 166];

/// Anchor disc for `perp_place_order_v2` (extra `selfTradeBehavior` arg).
pub const PERP_PLACE_ORDER_V2_DISCRIMINATOR: [u8; 8] =
    [232, 224, 154, 78, 158, 184, 6, 219];

/// Total ix data length for `perp_place_order` (v1):
/// 8 (disc) + 1 (side) + 8 + 8 + 8 (price/base/quote lots) + 8 (client_id)
/// + 1 (order_type) + 1 (reduce_only) + 8 (expiry_ts) + 1 (limit) = 52.
const PERP_PLACE_ORDER_DATA_LEN: usize = 52;

/// Cap on health_remaining_accounts forwarded to the CPI.
/// Real-world Mango health rarely exceeds ~16 accounts (active token banks +
/// oracles + perp markets + oracles); 24 leaves headroom without burning
/// stack on never-used slots.
const MAX_HEALTH_ACCOUNTS: usize = 24;

/// Total fixed CPI account-info entries: group, account, owner, perp_market,
/// bids, asks, event_queue, oracle = 8.
const FIXED_CPI_ACCOUNTS: usize = 8;

pub struct Mango;

/// Accounts for Mango v4 `perp_place_order`.
///
/// Beethoven's standard layout: [0] is the program-id detector and is
/// stripped before the CPI; the next 8 map to the IDL's fixed accounts;
/// any accounts after are passed through as Mango's
/// `health_remaining_accounts` (banks + oracles + perp markets the account
/// has positions in — built client-side).
pub struct MangoPlaceOrderAccounts<'info> {
    pub mango_program: &'info AccountView,
    pub group: &'info AccountView,
    pub mango_account: &'info AccountView,
    pub owner: &'info AccountView,
    pub perp_market: &'info AccountView,
    pub bids: &'info AccountView,
    pub asks: &'info AccountView,
    pub event_queue: &'info AccountView,
    pub oracle: &'info AccountView,
    pub health_remaining_accounts: &'info [AccountView],
}

impl<'info> TryFrom<&'info [AccountView]> for MangoPlaceOrderAccounts<'info> {
    type Error = ProgramError;

    fn try_from(accounts: &'info [AccountView]) -> Result<Self, Self::Error> {
        let [
            mango_program,
            group,
            mango_account,
            owner,
            perp_market,
            bids,
            asks,
            event_queue,
            oracle,
            health_remaining_accounts @ ..,
        ] = accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };
        if health_remaining_accounts.len() > MAX_HEALTH_ACCOUNTS {
            return Err(ProgramError::InvalidArgument);
        }
        Ok(MangoPlaceOrderAccounts {
            mango_program,
            group,
            mango_account,
            owner,
            perp_market,
            bids,
            asks,
            event_queue,
            oracle,
            health_remaining_accounts,
        })
    }
}

/// Args for `perp_place_order`. Field order matches the IDL byte layout
/// (see `PERP_PLACE_ORDER_DATA_LEN`).
pub struct MangoPlaceOrderData {
    /// 0 = Bid (long), 1 = Ask (short).
    pub side: u8,
    /// Limit price in lots (Mango-native).
    pub price_lots: i64,
    /// Max base lots to transact.
    pub max_base_lots: i64,
    /// Max quote lots to transact (caps slippage).
    pub max_quote_lots: i64,
    /// Client-assigned order id (for cancel/replace flows).
    pub client_order_id: u64,
    /// 0 = Limit, 1 = ImmediateOrCancel, 2 = PostOnly, 3 = Market, 4 = PostOnlySlide.
    pub order_type: u8,
    /// Reduce-only flag — fills only against opposite-direction positions.
    pub reduce_only: bool,
    /// Unix ts (0 = no expiry).
    pub expiry_timestamp: u64,
    /// Max iterations through the opposite book (typical: 10).
    pub limit: u8,
}

impl<'info> Perps<'info> for Mango {
    type Accounts = MangoPlaceOrderAccounts<'info>;
    type Data = MangoPlaceOrderData;

    fn place_order_signed(
        ctx: &Self::Accounts,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        // ── Build the CPI account list ────────────────────────────────────
        // Roles, in order (verified against the captured ix):
        //   group        readonly
        //   mango_account writable
        //   owner        readonly + signer (wallet PDA in our case)
        //   perp_market  writable
        //   bids         writable
        //   asks         writable
        //   event_queue  writable
        //   oracle       readonly
        //   health…      readonly (any number, may be empty)
        const N: usize = FIXED_CPI_ACCOUNTS + MAX_HEALTH_ACCOUNTS;
        let mut accounts_buf = MaybeUninit::<[InstructionAccount; N]>::uninit();
        let accounts_ptr = accounts_buf.as_mut_ptr() as *mut InstructionAccount;
        unsafe {
            core::ptr::write(accounts_ptr.add(0), InstructionAccount::readonly(ctx.group.address()));
            core::ptr::write(accounts_ptr.add(1), InstructionAccount::writable(ctx.mango_account.address()));
            core::ptr::write(accounts_ptr.add(2), InstructionAccount::readonly_signer(ctx.owner.address()));
            core::ptr::write(accounts_ptr.add(3), InstructionAccount::writable(ctx.perp_market.address()));
            core::ptr::write(accounts_ptr.add(4), InstructionAccount::writable(ctx.bids.address()));
            core::ptr::write(accounts_ptr.add(5), InstructionAccount::writable(ctx.asks.address()));
            core::ptr::write(accounts_ptr.add(6), InstructionAccount::writable(ctx.event_queue.address()));
            core::ptr::write(accounts_ptr.add(7), InstructionAccount::readonly(ctx.oracle.address()));
            for (i, acc) in ctx.health_remaining_accounts.iter().enumerate() {
                core::ptr::write(
                    accounts_ptr.add(FIXED_CPI_ACCOUNTS + i),
                    InstructionAccount::readonly(acc.address()),
                );
            }
        }
        let accounts_len = FIXED_CPI_ACCOUNTS + ctx.health_remaining_accounts.len();
        let accounts_slice =
            unsafe { core::slice::from_raw_parts(accounts_ptr as *const InstructionAccount, accounts_len) };

        // ── account_infos (parallel array of AccountView refs) ───────────
        // Unused trailing slots are filled with duplicates of `ctx.group`
        // (a valid readonly account-info); invoke_signed only resolves the
        // entries referenced by `InstructionView::accounts`, so duplicates
        // are inert. Same trick Kamino's refresh_obligation uses.
        let mut infos_buf: [&AccountView; N] = [ctx.group; N];
        infos_buf[1] = ctx.mango_account;
        infos_buf[2] = ctx.owner;
        infos_buf[3] = ctx.perp_market;
        infos_buf[4] = ctx.bids;
        infos_buf[5] = ctx.asks;
        infos_buf[6] = ctx.event_queue;
        infos_buf[7] = ctx.oracle;
        for (i, acc) in ctx.health_remaining_accounts.iter().enumerate() {
            infos_buf[FIXED_CPI_ACCOUNTS + i] = acc;
        }

        // ── Build ix data: 8 disc + 44 args = 52 bytes ───────────────────
        let mut data_buf = [0u8; PERP_PLACE_ORDER_DATA_LEN];
        data_buf[..8].copy_from_slice(&PERP_PLACE_ORDER_DISCRIMINATOR);
        data_buf[8] = data.side;
        data_buf[9..17].copy_from_slice(&data.price_lots.to_le_bytes());
        data_buf[17..25].copy_from_slice(&data.max_base_lots.to_le_bytes());
        data_buf[25..33].copy_from_slice(&data.max_quote_lots.to_le_bytes());
        data_buf[33..41].copy_from_slice(&data.client_order_id.to_le_bytes());
        data_buf[41] = data.order_type;
        data_buf[42] = data.reduce_only as u8;
        data_buf[43..51].copy_from_slice(&data.expiry_timestamp.to_le_bytes());
        data_buf[51] = data.limit;

        let ix = InstructionView {
            program_id: &MANGO_V4_PROGRAM_ID,
            accounts: accounts_slice,
            data: &data_buf,
        };

        invoke_signed(&ix, &infos_buf, signer_seeds)
    }

    fn place_order(
        ctx: &Self::Accounts,
        data: &Self::Data,
    ) -> ProgramResult {
        Self::place_order_signed(ctx, data, &[])
    }
}
