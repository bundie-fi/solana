#![no_std]

//! Phoenix CLOB swap CPI for Beethoven.
//!
//! Phoenix is a non-Anchor central limit order book program. The `Swap`
//! instruction is encoded as:
//!   • 1 byte  — PhoenixInstruction variant tag (`Swap` = 0, first variant)
//!   • borsh-encoded `OrderPacket::ImmediateOrCancel`
//!
//! ## OrderPacket::ImmediateOrCancel layout (encoded by this crate)
//!
//! Phoenix's `OrderPacket` is itself a borsh enum; `ImmediateOrCancel` is
//! variant index 1. So the payload after the outer Swap tag is:
//!   • 1 byte  — OrderPacket variant tag = 1 (ImmediateOrCancel)
//!   • 1 byte  — side (0 = Bid, 1 = Ask)
//!   • 1 byte  — Option<u64> price_in_ticks tag (we always emit 0 = None,
//!               i.e. take any price up to slippage)
//!   • 8 bytes — num_base_lots (u64 LE)
//!   • 8 bytes — num_quote_lots (u64 LE)
//!   • 8 bytes — min_base_lots_to_fill (u64 LE)
//!   • 8 bytes — min_quote_lots_to_fill (u64 LE)
//!   • 1 byte  — self_trade_behavior (we emit 1 = CancelProvide; safe default)
//!   • 1 byte  — Option<u64> match_limit tag (we emit 0 = None)
//!   • 16 bytes — client_order_id (u128 LE; we emit 0)
//!   • 1 byte  — use_only_deposited_funds bool (we emit 0 = false; uses
//!               the trader's token accounts, not pre-deposited seat funds)
//!   • 1 byte  — Option<u64> last_valid_slot tag (0 = None)
//!   • 1 byte  — Option<u64> last_valid_unix_timestamp_in_seconds tag (0 = None)
//!
//! Outer variant byte (1) + 56 inner bytes = **57 bytes total** for a typical
//! IOC swap with no price limit, no expiry, and no client metadata.
//!
//! ## side / lot mapping (Beethoven `Swap` trait → Phoenix)
//!
//! The Beethoven trait gives us only `in_amount` and `min_out` as `u64`. Phoenix
//! needs base/quote distinction *and* expects values in **lots**, not raw token
//! atoms. The caller (strategy-token) is responsible for atoms→lots conversion
//! before invoking this CPI; we treat `in_amount` and `min_out` as lots.
//!
//! Mapping by side (carried in `PhoenixSwapData::side`):
//!   • `Bid` (0) — buying base with quote → input is quote, output is base
//!       num_quote_lots          = in_amount
//!       num_base_lots           = 0  (Phoenix matches by quote when base is 0)
//!       min_base_lots_to_fill   = min_out
//!       min_quote_lots_to_fill  = 0
//!   • `Ask` (1) — selling base for quote → input is base, output is quote
//!       num_base_lots           = in_amount
//!       num_quote_lots          = 0  (matches by base when quote is 0)
//!       min_quote_lots_to_fill  = min_out
//!       min_base_lots_to_fill   = 0
//!
//! Phoenix log authority (PDA, same on devnet+mainnet):
//!   `7aDTsspkQNGKmrexAN7FLx9oxU3iPczSSvHNggyuqYkR`

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

/// Phoenix v1 program id (same on devnet and mainnet).
pub const PHOENIX_PROGRAM_ID: Address =
    Address::from_str_const("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY");

/// `PhoenixInstruction::Swap` is the first variant.
const SWAP_DISCRIMINATOR: u8 = 0;
/// `OrderPacket::ImmediateOrCancel` is the third variant of the OrderPacket
/// borsh enum (index 2). Variant order from the SDK source: PostOnly=0,
/// Limit=1, ImmediateOrCancel=2. Phoenix's `Swap` ix only accepts IOC packets.
/// Probe-verified 2026-04-23 by serializing each variant via the SDK and
/// comparing the tag byte. Wrong tag silently posts a malformed Limit order.
const ORDER_PACKET_IOC_TAG: u8 = 2;

/// Default `SelfTradeBehavior::CancelProvide` (variant 1) — cancels resting
/// orders from the same trader; safest for swap-style use.
const SELF_TRADE_BEHAVIOR_CANCEL_PROVIDE: u8 = 1;

/// Total CPI ix data: 1 (outer Swap tag) + 56 (IOC packet payload) = 57 bytes.
const IX_DATA_LEN: usize = 57;

pub struct Phoenix;

/// Side of the trade — selects which `num_*_lots` field carries `in_amount`.
#[repr(u8)]
#[derive(Clone, Copy)]
pub enum PhoenixSide {
    /// Buying base with quote (input = quote, output = base).
    Bid = 0,
    /// Selling base for quote (input = base, output = quote).
    Ask = 1,
}

pub struct PhoenixSwapData {
    /// 0 = Bid (in=quote, out=base); 1 = Ask (in=base, out=quote).
    pub side: u8,
}

impl PhoenixSwapData {
    pub const DATA_LEN: usize = 1;
}

impl TryFrom<&[u8]> for PhoenixSwapData {
    type Error = ProgramError;

    fn try_from(data: &[u8]) -> Result<Self, Self::Error> {
        if data.is_empty() {
            return Err(ProgramError::InvalidInstructionData);
        }
        if data[0] > 1 {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(Self { side: data[0] })
    }
}

impl PhoenixSwapAccounts<'_> {
    pub const NUM_ACCOUNTS: usize = 9;
}

pub struct PhoenixSwapAccounts<'info> {
    pub phoenix_program: &'info AccountView,
    pub log_authority: &'info AccountView,
    pub market: &'info AccountView,
    pub trader: &'info AccountView,
    pub base_account: &'info AccountView,
    pub quote_account: &'info AccountView,
    pub base_vault: &'info AccountView,
    pub quote_vault: &'info AccountView,
    pub token_program: &'info AccountView,
}

impl<'info> TryFrom<&'info [AccountView]> for PhoenixSwapAccounts<'info> {
    type Error = ProgramError;

    fn try_from(accounts: &'info [AccountView]) -> Result<Self, Self::Error> {
        let [phoenix_program, log_authority, market, trader, base_account, quote_account, base_vault, quote_vault, token_program, ..] =
            accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        Ok(PhoenixSwapAccounts {
            phoenix_program,
            log_authority,
            market,
            trader,
            base_account,
            quote_account,
            base_vault,
            quote_vault,
            token_program,
        })
    }
}

impl<'info> Swap<'info> for Phoenix {
    type Accounts = PhoenixSwapAccounts<'info>;
    type Data = PhoenixSwapData;

    fn swap_signed(
        ctx: &Self::Accounts,
        in_amount: u64,
        minimum_out_amount: u64,
        data: &Self::Data,
        signer_seeds: &[Signer],
    ) -> ProgramResult {
        // Account meta layout per Phoenix v1 `Swap`:
        //   0  phoenix_program  (read)   — included so the CPI sees the program account
        //   1  log_authority    (read)   — Phoenix logging PDA
        //   2  market           (write)  — the market account being traded against
        //   3  trader           (signer) — wallet authority over base/quote token accts
        //   4  base_account     (write)  — trader's base SPL token account
        //   5  quote_account    (write)  — trader's quote SPL token account
        //   6  base_vault       (write)  — market's base vault PDA
        //   7  quote_vault      (write)  — market's quote vault PDA
        //   8  token_program    (read)
        let accounts = [
            InstructionAccount::readonly(ctx.phoenix_program.address()),
            InstructionAccount::readonly(ctx.log_authority.address()),
            InstructionAccount::writable(ctx.market.address()),
            InstructionAccount::readonly_signer(ctx.trader.address()),
            InstructionAccount::writable(ctx.base_account.address()),
            InstructionAccount::writable(ctx.quote_account.address()),
            InstructionAccount::writable(ctx.base_vault.address()),
            InstructionAccount::writable(ctx.quote_vault.address()),
            InstructionAccount::readonly(ctx.token_program.address()),
        ];

        let account_infos = [
            ctx.phoenix_program,
            ctx.log_authority,
            ctx.market,
            ctx.trader,
            ctx.base_account,
            ctx.quote_account,
            ctx.base_vault,
            ctx.quote_vault,
            ctx.token_program,
        ];

        // Map (in_amount, min_out) → Phoenix lot fields based on side.
        // See module doc-comment for the full mapping table.
        let (num_base_lots, num_quote_lots, min_base_lots_to_fill, min_quote_lots_to_fill) =
            match data.side {
                0 => (0u64, in_amount, minimum_out_amount, 0u64), // Bid: in=quote, out=base
                _ => (in_amount, 0u64, 0u64, minimum_out_amount), // Ask: in=base, out=quote
            };

        let mut instruction_data = MaybeUninit::<[u8; IX_DATA_LEN]>::uninit();
        unsafe {
            let ptr = instruction_data.as_mut_ptr() as *mut u8;

            // [0]   outer PhoenixInstruction::Swap tag
            core::ptr::write(ptr, SWAP_DISCRIMINATOR);
            // [1]   inner OrderPacket variant tag (ImmediateOrCancel)
            core::ptr::write(ptr.add(1), ORDER_PACKET_IOC_TAG);
            // [2]   side
            core::ptr::write(ptr.add(2), data.side);
            // [3]   Option<u64> price_in_ticks = None
            core::ptr::write(ptr.add(3), 0u8);
            // [4..12]  num_base_lots
            core::ptr::copy_nonoverlapping(num_base_lots.to_le_bytes().as_ptr(), ptr.add(4), 8);
            // [12..20] num_quote_lots
            core::ptr::copy_nonoverlapping(num_quote_lots.to_le_bytes().as_ptr(), ptr.add(12), 8);
            // [20..28] min_base_lots_to_fill
            core::ptr::copy_nonoverlapping(
                min_base_lots_to_fill.to_le_bytes().as_ptr(),
                ptr.add(20),
                8,
            );
            // [28..36] min_quote_lots_to_fill
            core::ptr::copy_nonoverlapping(
                min_quote_lots_to_fill.to_le_bytes().as_ptr(),
                ptr.add(28),
                8,
            );
            // [36]  self_trade_behavior = CancelProvide
            core::ptr::write(ptr.add(36), SELF_TRADE_BEHAVIOR_CANCEL_PROVIDE);
            // [37]  Option<u64> match_limit = None
            core::ptr::write(ptr.add(37), 0u8);
            // [38..54] client_order_id (u128) = 0
            core::ptr::write_bytes(ptr.add(38), 0u8, 16);
            // [54]  use_only_deposited_funds = false
            core::ptr::write(ptr.add(54), 0u8);
            // [55]  Option<u64> last_valid_slot = None
            core::ptr::write(ptr.add(55), 0u8);
            // [56]  Option<u64> last_valid_unix_timestamp_in_seconds = None
            core::ptr::write(ptr.add(56), 0u8);
        }

        let instruction = InstructionView {
            program_id: &PHOENIX_PROGRAM_ID,
            accounts: &accounts,
            data: unsafe {
                core::slice::from_raw_parts(instruction_data.as_ptr() as *const u8, IX_DATA_LEN)
            },
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
