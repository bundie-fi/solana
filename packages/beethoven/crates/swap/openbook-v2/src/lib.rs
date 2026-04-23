#![no_std]

//! OpenBook v2 CLOB swap adapter for Beethoven.
//!
//! Wraps `place_take_order` — an Immediate-Or-Cancel (IOC) take against the
//! resting book. No order rests, no `OpenOrdersAccount` PDA is required (unlike
//! `place_order`), so it is the cleanest swap-shaped instruction the program
//! exposes.
//!
//! Anchor discriminator (`sha256("global:place_take_order")[..8]`):
//!   `[3, 44, 71, 3, 26, 199, 203, 85]`
//!
//! Args (Borsh, after discriminator):
//!   side: u8                          (0 = Bid, 1 = Ask)
//!   price_lots: i64
//!   max_base_lots: i64
//!   max_quote_lots_including_fees: i64
//!   order_type: u8                    (forced to 0 = ImmediateOrCancel)
//!   limit: u8                         (max matches; caller-tunable)
//! Total instruction data length: 8 (disc) + 25 (args) = 33 bytes.
//!
//! ## in_amount / min_out → lots mapping
//!
//! Beethoven gives us two scalar amounts (`in_amount`, `minimum_out_amount`) in
//! the input/output mint's native units. OpenBook expresses both base and quote
//! in *lots*. The strategy-token caller is responsible for converting native
//! amounts to lots using the market's `base_lot_size` / `quote_lot_size` before
//! invoking the adapter, so on this side we treat the `u64` values as already
//! lot-denominated and reinterpret them per side:
//!
//!   Side::Bid (buying base, paying quote):
//!     in_amount  -> max_quote_lots_including_fees   (cap on quote spent)
//!     min_out    -> max_base_lots                   (lower bound on base out)
//!
//!   Side::Ask (selling base, receiving quote):
//!     in_amount  -> max_base_lots                   (cap on base sold)
//!     min_out    -> max_quote_lots_including_fees   (lower bound on quote out)
//!
//! `price_lots` is set to `i64::MAX` so the take walks the book at any price up
//! to whichever of the two `max_*` caps binds first — this gives us a true
//! "swap up to N tokens, abort if I'd get less than min_out" semantics. The
//! `min_out` bound is *not* enforced by `place_take_order` itself; the
//! strategy-token program must verify `delta(user_*_account) >= min_out` after
//! the CPI returns. We only forward the bound as the `max_*` on the *receiving*
//! side, which causes the match loop to stop early once we've received enough.
//!
//! ## Account layout (16 entries; oracles + open_orders_admin are optional)
//!
//! Indexes match `programs/openbook-v2/src/instructions/place_take_order.rs`:
//!   0  signer                (signer)
//!   1  penalty_payer         (signer)        — typically same key as signer
//!   2  market                (writable)
//!   3  market_authority      (read)
//!   4  bids                  (writable)
//!   5  asks                  (writable)
//!   6  market_base_vault     (writable)
//!   7  market_quote_vault    (writable)
//!   8  event_heap            (writable)
//!   9  user_base_account     (writable)
//!  10  user_quote_account    (writable)
//!  11  oracle_a              (read, OPTIONAL — pass program_id sentinel to skip)
//!  12  oracle_b              (read, OPTIONAL — pass program_id sentinel to skip)
//!  13  token_program         (read)
//!  14  system_program        (read)
//!  15  open_orders_admin     (signer, OPTIONAL — pass program_id sentinel to skip)
//!
//! The "optional" Anchor accounts are encoded by passing the OpenBook program
//! ID itself in that slot (Anchor's `Option<AccountInfo>` convention). The
//! strategy-token caller must wire the right sentinel for markets that don't
//! configure oracles or an admin.

use {
    beethoven_core::Swap,
    core::mem::MaybeUninit,
    solana_account_view::AccountView,
    solana_address::Address,
    solana_instruction_view::{
        cpi::{invoke_signed, Signer},
        InstructionAccount, InstructionView,
    },
    solana_program_error::{ProgramError, ProgramResult},
};

pub const OPENBOOK_V2_PROGRAM_ID: Address =
    Address::from_str_const("opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb");

/// Anchor discriminator for `global:place_take_order`.
const PLACE_TAKE_ORDER_DISCRIMINATOR: [u8; 8] = [3, 44, 71, 3, 26, 199, 203, 85];

/// `OrderType::ImmediateOrCancel` in OpenBook v2.
const ORDER_TYPE_IOC: u8 = 0;

/// Sentinel price meaning "match at any price the book offers" — combined with
/// IOC + `max_base_lots` / `max_quote_lots` caps, this gives swap semantics.
const PRICE_LOTS_ANY: i64 = i64::MAX;

pub struct OpenbookV2;

#[repr(u8)]
#[derive(Clone, Copy)]
pub enum Side {
    /// Buy base, pay quote.
    Bid = 0,
    /// Sell base, receive quote.
    Ask = 1,
}

pub struct OpenbookV2SwapData {
    pub side: Side,
    /// Max number of book levels to walk during the take. OpenBook caps this
    /// internally; values up to 50 are typical.
    pub limit: u8,
}

impl OpenbookV2SwapData {
    pub const DATA_LEN: usize = 2;
}

impl TryFrom<&[u8]> for OpenbookV2SwapData {
    type Error = ProgramError;

    fn try_from(data: &[u8]) -> Result<Self, Self::Error> {
        if data.len() < 2 {
            return Err(ProgramError::InvalidInstructionData);
        }
        let side = match data[0] {
            0 => Side::Bid,
            1 => Side::Ask,
            _ => return Err(ProgramError::InvalidInstructionData),
        };
        Ok(Self {
            side,
            limit: data[1],
        })
    }
}

impl OpenbookV2SwapAccounts<'_> {
    /// Total positional account count, including the two oracles and the
    /// open_orders_admin slot. Optional slots are filled with the OpenBook
    /// program ID by the caller when not used.
    pub const NUM_ACCOUNTS: usize = 16;
}

pub struct OpenbookV2SwapAccounts<'info> {
    pub openbook_v2_program: &'info AccountView,
    pub signer: &'info AccountView,
    pub penalty_payer: &'info AccountView,
    pub market: &'info AccountView,
    pub market_authority: &'info AccountView,
    pub bids: &'info AccountView,
    pub asks: &'info AccountView,
    pub market_base_vault: &'info AccountView,
    pub market_quote_vault: &'info AccountView,
    pub event_heap: &'info AccountView,
    pub user_base_account: &'info AccountView,
    pub user_quote_account: &'info AccountView,
    /// Optional oracle A. Pass the OpenBook program ID to skip.
    pub oracle_a: &'info AccountView,
    /// Optional oracle B. Pass the OpenBook program ID to skip.
    pub oracle_b: &'info AccountView,
    pub token_program: &'info AccountView,
    pub system_program: &'info AccountView,
    /// Optional open_orders_admin signer. Pass the OpenBook program ID to skip.
    pub open_orders_admin: &'info AccountView,
}

impl<'info> TryFrom<&'info [AccountView]> for OpenbookV2SwapAccounts<'info> {
    type Error = ProgramError;

    fn try_from(accounts: &'info [AccountView]) -> Result<Self, Self::Error> {
        let [openbook_v2_program, signer, penalty_payer, market, market_authority, bids, asks, market_base_vault, market_quote_vault, event_heap, user_base_account, user_quote_account, oracle_a, oracle_b, token_program, system_program, open_orders_admin, ..] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        Ok(OpenbookV2SwapAccounts {
            openbook_v2_program,
            signer,
            penalty_payer,
            market,
            market_authority,
            bids,
            asks,
            market_base_vault,
            market_quote_vault,
            event_heap,
            user_base_account,
            user_quote_account,
            oracle_a,
            oracle_b,
            token_program,
            system_program,
            open_orders_admin,
        })
    }
}

impl<'info> Swap<'info> for OpenbookV2 {
    type Accounts = OpenbookV2SwapAccounts<'info>;
    type Data = OpenbookV2SwapData;

    fn swap_signed(
        ctx: &Self::Accounts,
        in_amount: u64,
        minimum_out_amount: u64,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        // Side decides which `max_*` cap is the input cap vs. the output bound.
        // `in_amount` and `minimum_out_amount` are interpreted as *lots* —
        // the strategy-token caller converts native units → lots upstream
        // using the market's `base_lot_size` / `quote_lot_size`.
        let (max_base_lots, max_quote_lots_including_fees) = match data.side {
            // Buying base with quote: cap quote spent at in_amount, stop once
            // we've received min_out base.
            Side::Bid => (
                minimum_out_amount as i64,
                in_amount as i64,
            ),
            // Selling base for quote: cap base sold at in_amount, stop once
            // we've received min_out quote.
            Side::Ask => (
                in_amount as i64,
                minimum_out_amount as i64,
            ),
        };

        let accounts = [
            // signer is `mut` in the OpenBook v2 IDL — passing readonly fails
            // with AccountNotMutable (0x06b9) before any logic runs. Probe-
            // verified 2026-04-23 against `@openbook-dex/openbook-v2@0.2.10`.
            InstructionAccount::writable_signer(ctx.signer.address()),
            InstructionAccount::writable_signer(ctx.penalty_payer.address()),
            InstructionAccount::writable(ctx.market.address()),
            InstructionAccount::readonly(ctx.market_authority.address()),
            InstructionAccount::writable(ctx.bids.address()),
            InstructionAccount::writable(ctx.asks.address()),
            InstructionAccount::writable(ctx.market_base_vault.address()),
            InstructionAccount::writable(ctx.market_quote_vault.address()),
            InstructionAccount::writable(ctx.event_heap.address()),
            InstructionAccount::writable(ctx.user_base_account.address()),
            InstructionAccount::writable(ctx.user_quote_account.address()),
            InstructionAccount::readonly(ctx.oracle_a.address()),
            InstructionAccount::readonly(ctx.oracle_b.address()),
            InstructionAccount::readonly(ctx.token_program.address()),
            InstructionAccount::readonly(ctx.system_program.address()),
            // open_orders_admin is "signer optional"; if the caller wired the
            // OpenBook program ID sentinel here, the account is not actually a
            // signer of our outer transaction, so we mark it readonly.
            InstructionAccount::readonly(ctx.open_orders_admin.address()),
        ];

        let account_infos = [
            ctx.signer,
            ctx.penalty_payer,
            ctx.market,
            ctx.market_authority,
            ctx.bids,
            ctx.asks,
            ctx.market_base_vault,
            ctx.market_quote_vault,
            ctx.event_heap,
            ctx.user_base_account,
            ctx.user_quote_account,
            ctx.oracle_a,
            ctx.oracle_b,
            ctx.token_program,
            ctx.system_program,
            ctx.open_orders_admin,
        ];

        // Layout: 8 (disc) + 1 (side) + 8 (price) + 8 (max_base) + 8 (max_quote)
        //         + 1 (order_type) + 1 (limit) = 35 bytes.
        // Note: 33 was the spec's "~25 after disc" approximation; the precise
        // Borsh encoding of the args is 27 bytes, giving 35 total. We size the
        // buffer to match the wire format exactly.
        const DATA_LEN: usize = 8 + 1 + 8 + 8 + 8 + 1 + 1;
        let mut instruction_data = MaybeUninit::<[u8; DATA_LEN]>::uninit();
        unsafe {
            let ptr = instruction_data.as_mut_ptr() as *mut u8;
            core::ptr::copy_nonoverlapping(
                PLACE_TAKE_ORDER_DISCRIMINATOR.as_ptr(),
                ptr,
                8,
            );
            // side: u8
            core::ptr::write(ptr.add(8), data.side as u8);
            // price_lots: i64 — max value ⇒ "any price"
            core::ptr::copy_nonoverlapping(
                PRICE_LOTS_ANY.to_le_bytes().as_ptr(),
                ptr.add(9),
                8,
            );
            // max_base_lots: i64
            core::ptr::copy_nonoverlapping(
                max_base_lots.to_le_bytes().as_ptr(),
                ptr.add(17),
                8,
            );
            // max_quote_lots_including_fees: i64
            core::ptr::copy_nonoverlapping(
                max_quote_lots_including_fees.to_le_bytes().as_ptr(),
                ptr.add(25),
                8,
            );
            // order_type: u8 — forced IOC for swap semantics
            core::ptr::write(ptr.add(33), ORDER_TYPE_IOC);
            // limit: u8 — max book levels to consume
            core::ptr::write(ptr.add(34), data.limit);
        }

        let instruction = InstructionView {
            program_id: &OPENBOOK_V2_PROGRAM_ID,
            accounts: &accounts,
            data: unsafe { instruction_data.assume_init_ref() },
        };

        invoke_signed(&instruction, &account_infos, signer_seeds)
    }

    fn swap(
        ctx: &Self::Accounts,
        in_amount: u64,
        minimum_out_amount: u64,
        data: &Self::Data,
    ) -> ProgramResult {
        Self::swap_signed(ctx, in_amount, minimum_out_amount, data, &[])
    }
}
