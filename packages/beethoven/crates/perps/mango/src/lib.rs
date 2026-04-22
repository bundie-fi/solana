#![no_std]

//! Mango v4 perps resolver for Beethoven.
//!
//! Scaffold: defines the account struct, order-data shape, and program ID;
//! the `place_order_signed` CPI is stubbed and will be filled in once
//! the CLI-side resolver has produced a verified account manifest from
//! a live devnet PerpPlaceOrder call (analogue of kamino-test-deposit.mjs).

use {
    beethoven_core::Perps,
    solana_account_view::AccountView,
    solana_address::Address,
    solana_instruction_view::cpi::Signer,
    solana_program_error::{ProgramError, ProgramResult},
};

/// Mango v4 program ID (same on mainnet and devnet).
pub const MANGO_V4_PROGRAM_ID: Address = Address::new_from_array([
    // 4MangoMjqJ2firMokCjjGgoK8d4MXcrgL7XJaL3w6fVg
    0x31, 0xd8, 0xe1, 0x7d, 0xde, 0x0f, 0x59, 0xc1,
    0x8e, 0x07, 0x5b, 0x98, 0xca, 0x9d, 0x6b, 0x65,
    0xc8, 0xfa, 0x24, 0xed, 0x50, 0x6d, 0x20, 0x6c,
    0x5e, 0xbe, 0x3c, 0x18, 0x0f, 0x02, 0x37, 0x7f,
]);

/// Anchor discriminator for `perp_place_order`.
/// sha256("global:perp_place_order")[..8]. Placeholder — verify before CPI.
pub const PERP_PLACE_ORDER_DISCRIMINATOR: [u8; 8] = [0; 8];

pub struct Mango;

/// Accounts for Mango v4 `perp_place_order`.
///
/// Fields follow the IDL order. The first account is the Mango program id
/// (detector for Beethoven's `try_from_perps_context`).
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
        ] = accounts
        else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };
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
        })
    }
}

/// Data passed to `place_order_signed`.
///
/// Layout matches Mango v4's `PerpPlaceOrder` args. Field docs capture the
/// semantics we expose; wire-format encoding/decoding is added alongside
/// the CPI impl in the follow-up.
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
    /// 0 = Limit, 1 = ImmediateOrCancel, 2 = PostOnly, 3 = Market.
    pub order_type: u8,
    /// Unix ts (0 = no expiry).
    pub expiry_ts: u64,
    /// Max iterations through the opposite book.
    pub limit: u8,
    /// 0 = DecrementTake, 1 = CancelProvide, 2 = AbortTransaction.
    pub self_trade_behavior: u8,
}

impl<'info> Perps<'info> for Mango {
    type Accounts = MangoPlaceOrderAccounts<'info>;
    type Data = MangoPlaceOrderData;

    fn place_order_signed(
        _ctx: &Self::Accounts,
        _data: &Self::Data,
        _signer_seeds: &[Signer],
    ) -> ProgramResult {
        // TODO: build PerpPlaceOrder instruction data (disc + borsh-encoded args),
        // assemble InstructionView with the 8 account refs (program account is
        // `mango_program`, other 8 are the instruction accounts),
        // invoke_signed with `signer_seeds`.
        Err(ProgramError::Custom(0xDEAD_BEE1))
    }

    fn place_order(
        ctx: &Self::Accounts,
        data: &Self::Data,
    ) -> ProgramResult {
        Self::place_order_signed(ctx, data, &[])
    }
}
