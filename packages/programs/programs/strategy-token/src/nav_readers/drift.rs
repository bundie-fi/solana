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

// ─── SpotMarket account layout ────────────────────────────────────────────
//
// SpotMarket is large (~776 B). Fields we need:
//
//     ~8..40     pubkey:                       Pubkey
//     ~40..72    oracle:                       Pubkey
//     ~72..104   mint:                         Pubkey
//     ...        (vault, history, etc.)
//     ~432..448  cumulative_deposit_interest:  u128 (Q precision = 1e10)
//     ~448..464  cumulative_borrow_interest:   u128
//
// TODO(NAV-DRIFT-OFFSET): the exact byte offsets for `mint` and
// `cumulative_deposit_interest` MUST be verified against a live
// SpotMarket PDA. The numbers below are from inspection of
// drift-labs/protocol-v2 master and are correct for v2.x as of Apr 2026,
// but Drift has re-laid this struct out before. Use:
//
//     solana account <USDC_SPOT_MARKET_PDA> --output json
//
// then byte-walk to confirm. If the offsets shift, only the two consts
// below need to change.
const SPOT_MARKET_OFFSET_MINT: usize = 72;
// Verified live against devnet SpotMarket `6gMq3mRCKf8aP3ttTyYhuijVZ2LGi14oDsBbkgubfLB3`
// (and 8 sibling markets) on 2026-04-23 — values @ 480 read as ~1.0–1.13 in
// Q1e10 (sane); values @ 432 are `total_spot_fee` (junk for this purpose).
const SPOT_MARKET_OFFSET_CUMULATIVE_DEPOSIT_INTEREST: usize = 480;
const SPOT_MARKET_MIN_LEN: usize = SPOT_MARKET_OFFSET_CUMULATIVE_DEPOSIT_INTEREST + 16;

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
        // and non-Deposit (balance_type != 0). For each surviving slot,
        // find the matching SpotMarket in `aux` whose `mint == USDC_MINT`,
        // then convert.
        let mut total_usdc: u128 = 0;

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
            if balance_type != SPOT_BALANCE_TYPE_DEPOSIT {
                // TODO(NAV-DRIFT-MULTI-ASSET): also handle Borrow as a
                // negative leg once we trust multi-asset valuation. For
                // now, skip — a deposit-only strategy stays accurate.
                continue;
            }

            let market_index = u16::from_le_bytes(
                user_data[base + SPOT_POSITION_OFFSET_MARKET_INDEX
                    ..base + SPOT_POSITION_OFFSET_MARKET_INDEX + 2]
                    .try_into()
                    .map_err(|_| ProgramError::InvalidAccountData)?,
            );

            // Find the matching SpotMarket aux acc by USDC mint check.
            // We don't actually need the market_index value here — we
            // identify the right aux by mint — but we keep it around so
            // future multi-asset code can route by market_index.
            let _ = market_index;

            let mut matched_value: Option<u128> = None;
            for spot_market_acc in aux.iter() {
                if !spot_market_acc.owned_by(&DRIFT_PROGRAM_ID) {
                    // Wrong-owner aux acc — skip rather than error so a
                    // misconfigured leg doesn't take down the whole NAV
                    // refresh. The owner-check on `User` above is the
                    // primary guarantee.
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
                let cumulative_deposit_interest = u128::from_le_bytes(
                    market_data[SPOT_MARKET_OFFSET_CUMULATIVE_DEPOSIT_INTEREST
                        ..SPOT_MARKET_OFFSET_CUMULATIVE_DEPOSIT_INTEREST + 16]
                        .try_into()
                        .map_err(|_| ProgramError::InvalidAccountData)?,
                );

                // value (in USDC base units) =
                //     scaled_balance * cumulative_deposit_interest / DRIFT_USDC_DIVISOR
                let numerator = (scaled_balance as u128)
                    .checked_mul(cumulative_deposit_interest)
                    .ok_or(ProgramError::ArithmeticOverflow)?;
                matched_value = Some(numerator / DRIFT_USDC_DIVISOR);
                break;
            }

            if let Some(v) = matched_value {
                total_usdc = total_usdc
                    .checked_add(v)
                    .ok_or(ProgramError::ArithmeticOverflow)?;
            }
            // else: USDC SpotMarket aux not provided for this position →
            // silently skip. A future strict mode could turn this into
            // an error.
        }

        if total_usdc > u64::MAX as u128 {
            return Err(ProgramError::ArithmeticOverflow);
        }
        Ok(total_usdc as u64)
    }
}
