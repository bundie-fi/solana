#![no_std]

//! Drift v2 perps resolver for Beethoven — `place_perp_order`.
//!
//! Account layout + arg encoding derived verbatim from drift-labs/protocol-v2
//! master (Apr 2026):
//!
//!   - `programs/drift/src/instructions/user.rs::PlaceOrder` (line ~4865):
//!     struct with 3 accounts — `state`, `user`, `authority` (Signer).
//!   - `programs/drift/src/instructions/user.rs::handle_place_perp_order`
//!     (line ~2323): handler taking `OrderParams` and reading
//!     `remaining_accounts` for perp_market + oracle + (optional)
//!     high-leverage-mode config via `load_maps`.
//!   - `programs/drift/src/state/order_params.rs::OrderParams`: the Borsh
//!     arg struct whose on-wire shape we replicate byte-for-byte below.
//!   - `programs/drift/src/instructions/admin.rs`: confirms
//!     `seeds = [b"perp_market", market_index.to_le_bytes().as_ref()]`.
//!
//! ── IMPORTANT — authority is AccountInfo, not Signer WAIT ──
//! Cross-check: for `place_perp_order` specifically, the IDL *and* the
//! `PlaceOrder` account struct both mark `authority: Signer<'info>` (from
//! `sdk/src/idl/drift.json::placePerpOrder`: `{"name":"authority",
//! "isMut":false,"isSigner":true}`). This is the OPPOSITE of
//! `initialize_user` (where authority is `AccountInfo`). We therefore mark
//! authority as `readonly_signer` here, not `readonly`.
//!
//! ── Account list (fixed 3 + variable trailing) ────────────────────────
//!   0  drift_program   readonly   (program-id detector — stripped by adapter)
//!   1  state           readonly
//!   2  user            writable
//!   3  authority       readonly + signer   (wallet PDA in strategy-token)
//!   4..N  remaining    forwarded verbatim   (perp_market + oracle pairs,
//!                      optional high-leverage-mode config)
//!
//! Drift's `load_maps` walks `remaining_accounts` owner-checking each entry
//! — order matters to it, but Beethoven just needs to splat them through.

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

/// Drift v2 program ID (`dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH`).
pub const DRIFT_PROGRAM_ID: Address =
    Address::from_str_const("dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH");

/// Anchor disc for `place_perp_order`. sha256("global:place_perp_order")[..8].
/// Verified against `sdk/src/idl/drift.json::placePerpOrder` — matches.
pub const PLACE_PERP_ORDER_DISCRIMINATOR: [u8; 8] = [69, 161, 93, 202, 120, 126, 76, 185];

/// Mainnet SOL-PERP market index. Derivation seed: ["perp_market", [0, 0]].
/// Verified: `find_program_address(["perp_market", &[0,0]], DRIFT_PROGRAM_ID)`
/// resolves to `8UJgxaiQx5nTrdDgph5FiahMmzduuLTLf5WmsPegYiXW` on mainnet.
/// Devnet may differ — Drift's devnet deployment exposes the same market
/// index naming, so callers should still use 0 for SOL-PERP.
pub const MARKET_INDEX_SOL_PERP: u16 = 0;

// ─── OrderParams enum variants (u8-by-index, from Borsh) ──────────────────
// Source: programs/drift/src/state/user.rs (OrderType, MarketType,
// OrderTriggerCondition) + programs/drift/src/controller/position.rs
// (PositionDirection) + programs/drift/src/state/order_params.rs (PostOnlyParam).

/// OrderType enum.
pub const ORDER_TYPE_MARKET: u8 = 0;
pub const ORDER_TYPE_LIMIT: u8 = 1;
pub const ORDER_TYPE_TRIGGER_MARKET: u8 = 2;
pub const ORDER_TYPE_TRIGGER_LIMIT: u8 = 3;
pub const ORDER_TYPE_ORACLE: u8 = 4;

/// MarketType enum.
pub const MARKET_TYPE_SPOT: u8 = 0;
pub const MARKET_TYPE_PERP: u8 = 1;

/// PositionDirection enum.
pub const DIRECTION_LONG: u8 = 0;
pub const DIRECTION_SHORT: u8 = 1;

/// PostOnlyParam enum.
pub const POST_ONLY_NONE: u8 = 0;
pub const POST_ONLY_MUST: u8 = 1;
pub const POST_ONLY_TRY: u8 = 2;
pub const POST_ONLY_SLIDE: u8 = 3;

/// OrderTriggerCondition enum.
pub const TRIGGER_COND_ABOVE: u8 = 0;

/// OrderParamsBitFlag::ImmediateOrCancel. Not set for market-open path.
pub const BIT_FLAG_IOC: u8 = 0b0000_0001;

/// Length of the Borsh-serialised OrderParams for our minimal market-order
/// path (all `Option<_>` fields serialised as None = single `0x00` byte):
///
///   off  size  field
///   ──────────────────────────────────────────
///     0   1   order_type
///     1   1   market_type
///     2   1   direction
///     3   1   user_order_id
///     4   8   base_asset_amount
///    12   8   price                     (= 0 for market order)
///    20   2   market_index
///    22   1   reduce_only
///    23   1   post_only
///    24   1   bit_flags
///    25   1   max_ts              (None — single 0x00)
///    26   1   trigger_price       (None — single 0x00)
///    27   1   trigger_condition
///    28   1   oracle_price_offset (None — single 0x00)
///    29   1   auction_duration    (None — single 0x00)
///    30   1   auction_start_price (None — single 0x00)
///    31   1   auction_end_price   (None — single 0x00)
///   ──────────────────────────────────────────
///   total = 32 bytes
const ORDER_PARAMS_MIN_LEN: usize = 32;

/// Disc + OrderParams payload = 8 + 32 = 40 bytes total ix data.
const PLACE_PERP_ORDER_DATA_LEN: usize = 8 + ORDER_PARAMS_MIN_LEN;

/// Cap on variable tail (perp_markets + oracles + high-leverage-mode config).
/// In practice 3–6 accounts; 16 leaves headroom.
const MAX_TRAILING_ACCOUNTS: usize = 16;

/// Fixed CPI accounts: state, user, authority.
const FIXED_CPI_ACCOUNTS: usize = 3;

pub struct Drift;

/// Accounts for Drift `place_perp_order`.
///
/// Beethoven's standard layout: `[0]` is the program-id detector, stripped
/// before the CPI. The next 3 map 1:1 to `PlaceOrder` in drift-labs/protocol-v2.
/// Anything after is forwarded verbatim as `remaining_accounts` for
/// `load_maps` (perp_market + oracle for the referenced market, plus any
/// spot markets the user has positions in — keeper-supplied).
pub struct DriftPlacePerpOrderAccounts<'info> {
    pub drift_program: &'info AccountView,
    pub state: &'info AccountView,
    pub user: &'info AccountView,
    pub authority: &'info AccountView,
    pub remaining_accounts: &'info [AccountView],
}

impl<'info> TryFrom<&'info [AccountView]> for DriftPlacePerpOrderAccounts<'info> {
    type Error = ProgramError;

    fn try_from(accounts: &'info [AccountView]) -> Result<Self, Self::Error> {
        let [drift_program, state, user, authority, remaining_accounts @ ..] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };
        if remaining_accounts.len() > MAX_TRAILING_ACCOUNTS {
            return Err(ProgramError::InvalidArgument);
        }
        Ok(DriftPlacePerpOrderAccounts {
            drift_program,
            state,
            user,
            authority,
            remaining_accounts,
        })
    }
}

/// Args for the minimal market-order path. Fields beyond these (auction,
/// trigger, oracle offset, max_ts) are serialised as `None` — callers who
/// need them can extend this struct + bump `ORDER_PARAMS_MIN_LEN`.
pub struct DriftPlacePerpOrderData {
    /// Perp market index (0 = SOL-PERP on mainnet).
    pub market_index: u16,
    /// Base-asset size in Drift-native base precision (1e9 for SOL).
    pub base_asset_amount: u64,
    /// 0 = Long, 1 = Short. See `DIRECTION_*`.
    pub direction: u8,
}

impl<'info> Perps<'info> for Drift {
    type Accounts = DriftPlacePerpOrderAccounts<'info>;
    type Data = DriftPlacePerpOrderData;

    fn place_order_signed(
        ctx: &Self::Accounts,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        // ── Build the CPI account list ────────────────────────────────────
        // Roles, in order:
        //   state       readonly
        //   user        writable
        //   authority   readonly + signer   (Drift's PlaceOrder marks it Signer)
        //   trailing…   forwarded verbatim  (perp_market, oracle, …)
        const N: usize = FIXED_CPI_ACCOUNTS + MAX_TRAILING_ACCOUNTS;
        let mut accounts_buf = MaybeUninit::<[InstructionAccount; N]>::uninit();
        let accounts_ptr = accounts_buf.as_mut_ptr() as *mut InstructionAccount;
        unsafe {
            core::ptr::write(
                accounts_ptr.add(0),
                InstructionAccount::readonly(ctx.state.address()),
            );
            core::ptr::write(
                accounts_ptr.add(1),
                InstructionAccount::writable(ctx.user.address()),
            );
            core::ptr::write(
                accounts_ptr.add(2),
                InstructionAccount::readonly_signer(ctx.authority.address()),
            );
            for (i, acc) in ctx.remaining_accounts.iter().enumerate() {
                core::ptr::write(
                    accounts_ptr.add(FIXED_CPI_ACCOUNTS + i),
                    InstructionAccount::from(acc),
                );
            }
        }
        let accounts_len = FIXED_CPI_ACCOUNTS + ctx.remaining_accounts.len();
        let accounts_slice = unsafe {
            core::slice::from_raw_parts(accounts_ptr as *const InstructionAccount, accounts_len)
        };

        // ── account_infos (parallel array of AccountView refs) ───────────
        // Unused trailing slots duplicate `ctx.state` — invoke_signed only
        // resolves slots referenced by `InstructionView::accounts`, so dupes
        // are inert. Same trick Mango's perps adapter uses.
        let mut infos_buf: [&AccountView; N] = [ctx.state; N];
        infos_buf[1] = ctx.user;
        infos_buf[2] = ctx.authority;
        for (i, acc) in ctx.remaining_accounts.iter().enumerate() {
            infos_buf[FIXED_CPI_ACCOUNTS + i] = acc;
        }

        // ── Build ix data: 8 disc + 31-byte OrderParams template ─────────
        // OrderParams is a fixed constant byte template (market_order,
        // Perp market_type, all Options = None, triggers Above) with three
        // fields spliced in: market_index, base_asset_amount, direction.
        let mut data_buf = [0u8; PLACE_PERP_ORDER_DATA_LEN];
        data_buf[..8].copy_from_slice(&PLACE_PERP_ORDER_DISCRIMINATOR);

        // OrderParams fields starting at offset 8 (after the 8-byte disc):
        //   8   order_type              = Market (0)
        //   9   market_type             = Perp (1)
        //   10  direction               = data.direction
        //   11  user_order_id           = 0
        //   12..20  base_asset_amount   = data.base_asset_amount (u64 LE)
        //   20..28  price               = 0          (market order)
        //   28..30  market_index        = data.market_index (u16 LE)
        //   30  reduce_only             = 0 (false)
        //   31  post_only               = None (0)
        //   32  bit_flags               = 0 (no IOC for open)
        //   33  max_ts                  Option<i64> = None (0x00)
        //   34  trigger_price           Option<u64> = None (0x00)
        //   35  trigger_condition       = Above (0)
        //   36  oracle_price_offset     Option<i32> = None (0x00)
        //   37  auction_duration        Option<u8>  = None (0x00)
        //   38  auction_start_price     Option<i64> = None (0x00)
        //   39  auction_end_price       Option<i64> = None (0x00)
        data_buf[8] = ORDER_TYPE_MARKET;
        data_buf[9] = MARKET_TYPE_PERP;
        data_buf[10] = data.direction;
        // data_buf[11] stays 0 (user_order_id).
        data_buf[12..20].copy_from_slice(&data.base_asset_amount.to_le_bytes());
        // data_buf[20..28] stays 0 (price = 0 for market order).
        data_buf[28..30].copy_from_slice(&data.market_index.to_le_bytes());
        // data_buf[30..40] all stay 0:
        //   reduce_only=false, post_only=None, bit_flags=0, then six
        //   Option/enum bytes serialised as their default-discriminant
        //   None / Above (also 0). Trigger condition Above is variant 0.

        let ix = InstructionView {
            program_id: &DRIFT_PROGRAM_ID,
            accounts: accounts_slice,
            data: &data_buf,
        };

        invoke_signed(&ix, &infos_buf, signer_seeds)
    }

    fn place_order(ctx: &Self::Accounts, data: &Self::Data) -> ProgramResult {
        Self::place_order_signed(ctx, data, &[])
    }
}
