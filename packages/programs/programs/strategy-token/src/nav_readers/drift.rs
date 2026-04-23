//! Drift user-account reader — values a Drift sub-account in USDC.
//!
//! Layout source: drift-labs/protocol-v2,
//! programs/drift/src/state/user.rs (`User` account, ~4376 bytes) and
//! programs/drift/src/state/spot_market.rs (`SpotMarket`).
//!
//! ## Why multi-account
//!
//! The Drift `User` account stores 8 `SpotPosition` slots. Each slot
//! carries a `scaled_balance: u64` plus a `market_index: u16` that points
//! at a `SpotMarket` PDA. To convert `scaled_balance` into a number of
//! underlying tokens we need that market's
//! `cumulative_deposit_interest: u128` (Q-formatted), which lives on the
//! `SpotMarket` account — *not* on `User`.
//!
//! The reader therefore takes a slice `state_accs: &[AccountView]` where
//! `state_accs[0]` is the `User` account and `state_accs[1..]` are
//! `SpotMarket` accounts (caller-supplied, ordered however the keeper
//! likes — we match by mint).
//!
//! ## Realistic scope (USDC-only path)
//!
//! Drift positions can be denominated in many tokens (SOL, BTC, USDC, …).
//! Multi-asset NAV needs an oracle conversion step we haven't wired yet.
//! For now we sum **USDC-only** positions: for each `SpotPosition` whose
//! matched `SpotMarket.mint == USDC_MINT` and whose `balance_type` is
//! Deposit, accumulate `scaled_balance * cumulative_deposit_interest`
//! into the USDC total. Non-USDC positions are skipped with a
//! TODO(NAV-DRIFT-MULTI-ASSET) comment.
//!
//! ## Defensive posture
//!
//! Drift state is consensus-trusted, but a malformed / wrong-program
//! account passed here would silently return 0 or read garbage. We:
//!   - owner-check `state_accs[0]` (must be the Drift program)
//!   - owner-check every aux acc in `state_accs[1..]`
//!   - length-check before slicing each position / market
//!   - skip slots whose `market_index` we can't find in aux accs
//!     (rather than erroring — a keeper might validly omit unused ones)
//!
//! Offsets are hard-coded from drift-labs/protocol-v2 master at the time
//! of writing (Apr 2026). They MUST be re-verified against a live devnet
//! `SpotMarket` PDA before this is trusted on mainnet — see
//! TODO(NAV-DRIFT-OFFSET) markers.

use pinocchio::{account::AccountView, error::ProgramError};

use super::{PositionReader, USDC_MINT};

/// Drift v2 program ID (`dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH`).
pub const DRIFT_PROGRAM_ID: pinocchio::address::Address =
    pinocchio::address::Address::new_from_array([
        9, 84, 219, 190, 158, 201, 96, 201, 138, 122, 41, 63, 226, 19, 54, 150, 111, 225, 128, 209,
        81, 174, 75, 129, 121, 86, 31, 137, 133, 74, 83, 246,
    ]);

// ─── User account layout ──────────────────────────────────────────────────
//
// drift-labs/protocol-v2 programs/drift/src/state/user.rs:
//
//     0..8       Anchor discriminator
//     8..40      authority: Pubkey
//     40..72     delegate:  Pubkey
//     72..104    name:      [u8; 32]
//     104..424   spot_positions: [SpotPosition; 8]   (40 B each)
//     424.....   perp_positions: [PerpPosition; 8]
//     ...
//
// SpotPosition layout (40 B):
//     0..8       scaled_balance:        u64
//     8..16      open_bids:             i64
//     16..24     open_asks:             i64
//     24..32     cumulative_deposits:   i64
//     32..34     market_index:          u16
//     34..35     balance_type:          u8   (0 = Deposit, 1 = Borrow)
//     35..36     open_orders:           u8
//     36..40     padding
//
// TODO(NAV-DRIFT-OFFSET): verify against current master + a live devnet
// User PDA (e.g. via `solana account` decode). Drift has reshuffled
// SpotPosition fields between minor versions in the past.
const USER_OFFSET_SPOT_POSITIONS: usize = 104;
const USER_NUM_SPOT_POSITIONS: usize = 8;
const USER_SPOT_POSITION_SIZE: usize = 40;
const USER_MIN_LEN: usize =
    USER_OFFSET_SPOT_POSITIONS + USER_NUM_SPOT_POSITIONS * USER_SPOT_POSITION_SIZE;

const SPOT_POSITION_OFFSET_SCALED_BALANCE: usize = 0;
const SPOT_POSITION_OFFSET_MARKET_INDEX: usize = 32;
const SPOT_POSITION_OFFSET_BALANCE_TYPE: usize = 34;

const SPOT_BALANCE_TYPE_DEPOSIT: u8 = 0;
const SPOT_BALANCE_TYPE_BORROW: u8 = 1;

// ─── SpotMarket account layout ────────────────────────────────────────────
//
// SpotMarket is 776 B. Fields we need (verified against mainnet USDC
// market_index=0 and SOL market_index=1, working backward from
// `MARKET_INDEX_OFFSET = 684` per drift-labs/protocol-v2 `impl Size for SpotMarket`):
//
//     8..40       pubkey:                       Pubkey
//     40..72      oracle:                       Pubkey
//     72..104     mint:                         Pubkey
//     ...
//     416..432    total_spot_fee:               u128
//     432..448    deposit_balance:              u128
//     448..464    borrow_balance:               u128
//     464..480    cumulative_deposit_interest:  u128 (Q1e10)  ← USE THIS
//     480..496    cumulative_borrow_interest:   u128 (Q1e10)
//     496..512    total_social_loss:            u128
//     ...
//     680..684    decimals:                     u32
//     684..686    market_index:                 u16
//
// Verified 2026-04-23 against mainnet USDC SpotMarket
// (`6gMq3mRCKf8aP3ttTyYhuijVZ2LGi14oDsBbkgubfLB3`):
//   @464 = 12_024_851_424 → 1.2025x deposit
//   @480 = 13_992_308_800 → 1.3992x borrow  (borrow > deposit ✓)
// And mainnet SOL SpotMarket: @464 = 1.0961x deposit, @480 = 1.2338x borrow ✓.
//
// HISTORY: prior commits had this set to 432 (read `total_spot_fee` as junk)
// then 480 (read `cumulative_borrow_interest` instead of deposit, inflating
// NAV by ~16% on every Drift read). Both wrong. The probe at
// packages/programs/scripts/probes/probe-drift-spotmarket.ts now asserts
// `value@464 < value@480` so this can't silently regress.
const SPOT_MARKET_OFFSET_MINT: usize = 72;
const SPOT_MARKET_OFFSET_CUMULATIVE_DEPOSIT_INTEREST: usize = 464;
const SPOT_MARKET_OFFSET_CUMULATIVE_BORROW_INTEREST: usize = 480;
const SPOT_MARKET_MIN_LEN: usize = SPOT_MARKET_OFFSET_CUMULATIVE_BORROW_INTEREST + 16;

/// Drift's `SPOT_CUMULATIVE_INTEREST_PRECISION` = 10^10. `scaled_balance`
/// is in `SPOT_BALANCE_PRECISION` (10^9) and `cumulative_deposit_interest`
/// is in `SPOT_CUMULATIVE_INTEREST_PRECISION` (10^10).
///
/// Token amount = scaled_balance * cumulative_deposit_interest / 10^19,
/// then multiplied by `10^mint_decimals / 10^9` (the precision delta
/// between Drift's internal "balance precision" and the token's mint
/// decimals). For USDC (6 decimals) the mint-decimal correction is
/// /10^3 so the full divisor is `10^22`.
const DRIFT_USDC_DIVISOR: u128 = 10_000_000_000_000_000_000_000u128; // 10^22

pub struct DriftUserReader;

impl PositionReader for DriftUserReader {
    /// Single-account fallback — Drift requires multi-account dispatch.
    /// Returning `InvalidAccountData` here forces callers to use
    /// `value_in_quote_multi`; the dispatcher in `update_nav.rs`
    /// already does this when it sees `PROTOCOL_TAG_DRIFT`.
    fn value_in_quote(
        position_account: &AccountView,
        _holding_amount: u64,
    ) -> Result<u64, ProgramError> {
        if !position_account.owned_by(&DRIFT_PROGRAM_ID) {
            return Err(ProgramError::IllegalOwner);
        }
        // Drift can't be valued from a single account; the caller must
        // route through value_in_quote_multi with SpotMarket aux accs.
        Err(ProgramError::NotEnoughAccountKeys)
    }

    fn value_in_quote_multi(
        state_accs: &[AccountView],
        _holding_amount: u64,
    ) -> Result<u64, ProgramError> {
        // [0] = User account; [1..] = SpotMarket aux accounts.
        if state_accs.is_empty() {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let user_acc = &state_accs[0];
        if !user_acc.owned_by(&DRIFT_PROGRAM_ID) {
            return Err(ProgramError::IllegalOwner);
        }

        let user_data = user_acc.try_borrow()?;
        if user_data.len() < USER_MIN_LEN {
            return Err(ProgramError::InvalidAccountData);
        }

        // Borrow each spot market once, defensively.
        let aux = &state_accs[1..];

        // Walk the 8 spot position slots. Skip empty (scaled_balance == 0)
        // and unknown balance types. For each surviving slot, find the
        // matching USDC SpotMarket in `aux` and convert; deposits add,
        // borrows subtract (saturating at 0 to avoid wrapping).
        // Non-USDC positions are skipped — see TODO(NAV-DRIFT-MULTI-ASSET).
        let mut total_assets: u128 = 0;
        let mut total_liabilities: u128 = 0;

        for slot in 0..USER_NUM_SPOT_POSITIONS {
            let base = USER_OFFSET_SPOT_POSITIONS + slot * USER_SPOT_POSITION_SIZE;
            let scaled_balance = u64::from_le_bytes(
                user_data[base + SPOT_POSITION_OFFSET_SCALED_BALANCE
                    ..base + SPOT_POSITION_OFFSET_SCALED_BALANCE + 8]
                    .try_into()
                    .map_err(|_| ProgramError::InvalidAccountData)?,
            );
            if scaled_balance == 0 {
                continue;
            }

            let balance_type = user_data[base + SPOT_POSITION_OFFSET_BALANCE_TYPE];
            let is_deposit = balance_type == SPOT_BALANCE_TYPE_DEPOSIT;
            let is_borrow = balance_type == SPOT_BALANCE_TYPE_BORROW;
            if !is_deposit && !is_borrow {
                continue;
            }

            let market_index = u16::from_le_bytes(
                user_data[base + SPOT_POSITION_OFFSET_MARKET_INDEX
                    ..base + SPOT_POSITION_OFFSET_MARKET_INDEX + 2]
                    .try_into()
                    .map_err(|_| ProgramError::InvalidAccountData)?,
            );
            // Aux is matched by mint (USDC), not market_index — kept here
            // for future multi-asset routing by market_index.
            let _ = market_index;

            let mut matched_value: Option<u128> = None;
            for spot_market_acc in aux.iter() {
                if !spot_market_acc.owned_by(&DRIFT_PROGRAM_ID) {
                    continue;
                }
                let market_data = spot_market_acc.try_borrow()?;
                if market_data.len() < SPOT_MARKET_MIN_LEN {
                    continue;
                }
                let mint_bytes: [u8; 32] = market_data
                    [SPOT_MARKET_OFFSET_MINT..SPOT_MARKET_OFFSET_MINT + 32]
                    .try_into()
                    .map_err(|_| ProgramError::InvalidAccountData)?;
                if mint_bytes != *USDC_MINT.as_array() {
                    continue;
                }
                // Pick the deposit or borrow rate based on position type.
                let interest_offset = if is_deposit {
                    SPOT_MARKET_OFFSET_CUMULATIVE_DEPOSIT_INTEREST
                } else {
                    SPOT_MARKET_OFFSET_CUMULATIVE_BORROW_INTEREST
                };
                let cumulative_interest = u128::from_le_bytes(
                    market_data[interest_offset..interest_offset + 16]
                        .try_into()
                        .map_err(|_| ProgramError::InvalidAccountData)?,
                );
                let numerator = (scaled_balance as u128)
                    .checked_mul(cumulative_interest)
                    .ok_or(ProgramError::ArithmeticOverflow)?;
                matched_value = Some(numerator / DRIFT_USDC_DIVISOR);
                break;
            }

            if let Some(v) = matched_value {
                if is_deposit {
                    total_assets = total_assets
                        .checked_add(v)
                        .ok_or(ProgramError::ArithmeticOverflow)?;
                } else {
                    total_liabilities = total_liabilities
                        .checked_add(v)
                        .ok_or(ProgramError::ArithmeticOverflow)?;
                }
            }
            // else: USDC SpotMarket aux not supplied → silent skip.
        }

        // Net NAV = assets − liabilities, saturating at 0.
        let net = total_assets.saturating_sub(total_liabilities);
        if net > u64::MAX as u128 {
            return Err(ProgramError::ArithmeticOverflow);
        }
        Ok(net as u64)
    }
}
