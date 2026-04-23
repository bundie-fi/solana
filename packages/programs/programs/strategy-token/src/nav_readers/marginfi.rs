//! marginfi lending-account reader — values a `MarginfiAccount` in
//! underlying tokens (USDC, in our realistic-scope path).
//!
//! Layout source: mrgnlabs/marginfi-v2,
//! programs/marginfi/src/state/marginfi_account.rs (`MarginfiAccount`,
//! 2304 bytes incl. discriminator) and
//! programs/marginfi/src/state/marginfi_group.rs (`Bank`, ~1856 bytes).
//!
//! ## Why multi-account
//!
//! `MarginfiAccount.lending_account.balances[]` holds up to 16 `Balance`
//! entries. Each entry stores `asset_shares: WrappedI80F48` and a
//! `bank_pk: Pubkey` reference — but the share→token conversion factor
//! lives on the *Bank* account as `asset_share_value: WrappedI80F48`. So
//! to value any non-trivial position we need both the MarginfiAccount
//! and the relevant Bank accounts.
//!
//! The reader takes `state_accs[0] = MarginfiAccount` and
//! `state_accs[1..] = Bank accounts`. We match each non-empty Balance to
//! a Bank by `bank_pk`.
//!
//! ## Realistic scope (USDC-only path)
//!
//! For now we only sum positions whose `Bank.mint == USDC_MINT`. Multi-
//! asset valuation would need a price oracle step that isn't wired here
//! yet — see TODO(NAV-MARGINFI-MULTI-ASSET).
//!
//! ## I80F48 fixed-point
//!
//! `WrappedI80F48` is a 128-bit value carrying an 80-bit integer + 48-bit
//! fractional part (2^-48 unit). Multiplying two I80F48s yields an
//! I160F96; dividing by 2^48 brings us back to I80F48 magnitude. Since
//! `asset_share_value` is initialised at 1 token-base-unit per share
//! (×2^48 in I80F48 form), the conversion
//!
//!     token_amount ≈ (asset_shares * asset_share_value) >> 48
//!
//! lands directly in the mint's base units (e.g. USDC's 6-decimal units).
//!
//! ## Defensive posture
//!
//! - owner-check `state_accs[0]` (must be marginfi)
//! - owner-check every aux Bank — skip-on-fail rather than error
//! - length-check before slicing
//! - net NAV = Σ(asset_value) − Σ(liability_value), saturating at 0 so an
//!   over-leveraged account doesn't wrap into a huge u64
//!
//! ## Offsets
//!
//! Offsets are hard-coded from mrgnlabs/marginfi-v2 master. They MUST be
//! re-verified against a live devnet `MarginfiAccount` + `Bank` PDA
//! before mainnet trust — see TODO(NAV-MARGINFI-OFFSET) markers.

use pinocchio::{account::AccountView, error::ProgramError};

use super::{PositionReader, USDC_MINT};

/// marginfi v2 program ID (`MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA`).
pub const MARGINFI_PROGRAM_ID: pinocchio::address::Address =
    pinocchio::address::Address::new_from_array([
        5, 48, 122, 214, 69, 75, 188, 94, 30, 78, 146, 5, 146, 83, 161, 139, 184, 200, 134, 140,
        88, 166, 49, 46, 200, 106, 57, 230, 34, 78, 55, 59,
    ]);

// ─── MarginfiAccount layout ───────────────────────────────────────────────
//
// mrgnlabs/marginfi-v2 programs/marginfi/src/state/marginfi_account.rs:
//
//     0..8       Anchor discriminator
//     8..40      group:           Pubkey
//     40..72     authority:       Pubkey
//     72..       lending_account: LendingAccount
//                  balances: [Balance; 16]   (104 B each → 1664 B)
//     ...        account_flags + padding
//
// Balance layout (104 B):
//     0..1       active (u8 / bool)
//     1..33      bank_pk: Pubkey
//     33..34     bank_asset_tag: u8
//     34..40     _pad0: [u8; 6]
//     40..56     asset_shares:           WrappedI80F48 (i128 LE)
//     56..72     liability_shares:       WrappedI80F48 (i128 LE)
//     72..88     emissions_outstanding:  WrappedI80F48 (i128 LE)
//     88..96     last_update: u64
//     96..104    _padding
//
// TODO(NAV-MARGINFI-OFFSET): verify against current master + a live
// devnet MarginfiAccount PDA. The Balance struct grew an `bank_asset_tag`
// byte in marginfi-v2 mid-2023; if the layout has shifted again only
// the offsets below need to update.
const ACCOUNT_OFFSET_BALANCES: usize = 72;
const ACCOUNT_NUM_BALANCES: usize = 16;
const ACCOUNT_BALANCE_SIZE: usize = 104;
const ACCOUNT_MIN_LEN: usize =
    ACCOUNT_OFFSET_BALANCES + ACCOUNT_NUM_BALANCES * ACCOUNT_BALANCE_SIZE;

const BALANCE_OFFSET_ACTIVE: usize = 0;
const BALANCE_OFFSET_BANK_PK: usize = 1;
const BALANCE_OFFSET_ASSET_SHARES: usize = 40;
const BALANCE_OFFSET_LIABILITY_SHARES: usize = 56;

// ─── Bank layout ──────────────────────────────────────────────────────────
//
// Bank is ~1856 B. Fields we need:
//     8..40      mint:               Pubkey
//     40..41     mint_decimals:      u8
//     ...        padding + group + auth + ...
//     ~88..104   asset_share_value:  WrappedI80F48
//
// TODO(NAV-MARGINFI-OFFSET): the byte offset for `asset_share_value` is
// the most volatile field — it has shifted in the past as marginfi added
// emissions / liquidator config. Confirm against:
//
//     solana account <USDC_BANK_PDA> --output json
//
// then byte-walk to verify the I80F48 lands at offset 88.
const BANK_OFFSET_MINT: usize = 8;
// Verified live against mainnet Bank `HKHvcCZKJzWPycqQdgCCT5oxt7GWdbPHrg9HSdxpdsEL`
// (USDC) on 2026-04-23:
//   @80  = 1.337187 (I80F48) → asset_share_value (deposit appreciation)
//   @96  = 1.559244 (I80F48) → liability_share_value (borrow > deposit ✓)
// `_pad0[7]` lives AFTER mint_decimals + group:Pubkey, pushing
// asset_share_value to disk offset 80 (not 88 as naive sequential layout
// would suggest); liability_share_value follows 16 bytes later at 96.
const BANK_OFFSET_ASSET_SHARE_VALUE: usize = 80;
const BANK_OFFSET_LIABILITY_SHARE_VALUE: usize = 96;
const BANK_MIN_LEN: usize = BANK_OFFSET_LIABILITY_SHARE_VALUE + 16;

/// I80F48 fractional bits — multiplying two I80F48s and shifting right
/// by this brings the result back into I80F48 magnitude (i.e. directly
/// into mint base units, since `asset_share_value` starts at 1 token-base
/// unit per share = `1 << 48` in I80F48 form).
const I80F48_FRAC_BITS: u32 = 48;

pub struct MarginfiAccountReader;

impl PositionReader for MarginfiAccountReader {
    /// Single-account fallback — marginfi requires multi-account
    /// dispatch. Returning `NotEnoughAccountKeys` here forces the caller
    /// (`update_nav`) to use `value_in_quote_multi`.
    fn value_in_quote(
        position_account: &AccountView,
        _holding_amount: u64,
    ) -> Result<u64, ProgramError> {
        if !position_account.owned_by(&MARGINFI_PROGRAM_ID) {
            return Err(ProgramError::IllegalOwner);
        }
        Err(ProgramError::NotEnoughAccountKeys)
    }

    fn value_in_quote_multi(
        state_accs: &[AccountView],
        _holding_amount: u64,
    ) -> Result<u64, ProgramError> {
        if state_accs.is_empty() {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let account_acc = &state_accs[0];
        if !account_acc.owned_by(&MARGINFI_PROGRAM_ID) {
            return Err(ProgramError::IllegalOwner);
        }

        let acc_data = account_acc.try_borrow()?;
        if acc_data.len() < ACCOUNT_MIN_LEN {
            return Err(ProgramError::InvalidAccountData);
        }

        let aux = &state_accs[1..];

        let mut total_assets: u128 = 0;
        let mut total_liabilities: u128 = 0;

        for slot in 0..ACCOUNT_NUM_BALANCES {
            let base = ACCOUNT_OFFSET_BALANCES + slot * ACCOUNT_BALANCE_SIZE;

            // Skip inactive balances. marginfi stores `active` as a u8
            // (0 = empty slot, non-zero = active).
            if acc_data[base + BALANCE_OFFSET_ACTIVE] == 0 {
                continue;
            }

            let bank_pk: [u8; 32] = acc_data
                [base + BALANCE_OFFSET_BANK_PK..base + BALANCE_OFFSET_BANK_PK + 32]
                .try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?;

            let asset_shares = i128::from_le_bytes(
                acc_data
                    [base + BALANCE_OFFSET_ASSET_SHARES..base + BALANCE_OFFSET_ASSET_SHARES + 16]
                    .try_into()
                    .map_err(|_| ProgramError::InvalidAccountData)?,
            );
            let liability_shares = i128::from_le_bytes(
                acc_data[base + BALANCE_OFFSET_LIABILITY_SHARES
                    ..base + BALANCE_OFFSET_LIABILITY_SHARES + 16]
                    .try_into()
                    .map_err(|_| ProgramError::InvalidAccountData)?,
            );
            // Empty slot — neither side has shares.
            if asset_shares <= 0 && liability_shares <= 0 {
                continue;
            }

            // Find the matching Bank in `aux` by address. Filter for USDC
            // mint to enforce the realistic-scope path.
            let mut asset_value: u128 = 0;
            let mut liability_value: u128 = 0;
            let mut matched = false;
            for bank_acc in aux.iter() {
                if bank_acc.address().as_array() != &bank_pk {
                    continue;
                }
                if !bank_acc.owned_by(&MARGINFI_PROGRAM_ID) {
                    continue;
                }
                let bank_data = bank_acc.try_borrow()?;
                if bank_data.len() < BANK_MIN_LEN {
                    continue;
                }
                let mint_bytes: [u8; 32] = bank_data[BANK_OFFSET_MINT..BANK_OFFSET_MINT + 32]
                    .try_into()
                    .map_err(|_| ProgramError::InvalidAccountData)?;
                if mint_bytes != *USDC_MINT.as_array() {
                    // TODO(NAV-MARGINFI-MULTI-ASSET): handle non-USDC
                    // banks via Pyth conversion. Needs a per-bank oracle
                    // binding (read bank.oracle Pubkey, match aux Pyth).
                    break;
                }

                if asset_shares > 0 {
                    let asset_share_value = i128::from_le_bytes(
                        bank_data
                            [BANK_OFFSET_ASSET_SHARE_VALUE..BANK_OFFSET_ASSET_SHARE_VALUE + 16]
                            .try_into()
                            .map_err(|_| ProgramError::InvalidAccountData)?,
                    );
                    if asset_share_value > 0 {
                        let product = (asset_shares as u128)
                            .checked_mul(asset_share_value as u128)
                            .ok_or(ProgramError::ArithmeticOverflow)?;
                        asset_value = product >> I80F48_FRAC_BITS;
                    }
                }
                if liability_shares > 0 {
                    let liability_share_value = i128::from_le_bytes(
                        bank_data[BANK_OFFSET_LIABILITY_SHARE_VALUE
                            ..BANK_OFFSET_LIABILITY_SHARE_VALUE + 16]
                            .try_into()
                            .map_err(|_| ProgramError::InvalidAccountData)?,
                    );
                    if liability_share_value > 0 {
                        let product = (liability_shares as u128)
                            .checked_mul(liability_share_value as u128)
                            .ok_or(ProgramError::ArithmeticOverflow)?;
                        liability_value = product >> I80F48_FRAC_BITS;
                    }
                }
                matched = true;
                break;
            }

            if matched {
                total_assets = total_assets
                    .checked_add(asset_value)
                    .ok_or(ProgramError::ArithmeticOverflow)?;
                total_liabilities = total_liabilities
                    .checked_add(liability_value)
                    .ok_or(ProgramError::ArithmeticOverflow)?;
            }
            // else: bank for this balance not in aux — skip silently.
        }

        // Net NAV = assets − liabilities, saturating at 0 to avoid wrapping
        // an over-leveraged account into a huge u64.
        let net = total_assets.saturating_sub(total_liabilities);
        if net > u64::MAX as u128 {
            return Err(ProgramError::ArithmeticOverflow);
        }
        Ok(net as u64)
    }
}
