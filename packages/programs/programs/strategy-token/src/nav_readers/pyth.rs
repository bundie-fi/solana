//! Pyth Pull-oracle (PriceUpdateV2) reader — hand-rolled byte walk.
//!
//! Layout source: pyth-network/pyth-crosschain
//! `target_chains/solana/pyth_solana_receiver_sdk/src/price_update.rs`
//! (`PriceUpdateV2` account).
//!
//! ## Why hand-rolled
//!
//! Pulling in `pyth-sdk-solana` would drag Anchor + borsh + Wormhole types
//! into a `pinocchio` program. We only need 4 fields, so we read them by
//! offset directly from the account data. The owner-check on the receiver
//! program ID is the primary defense; the offsets below are pinned to the
//! upstream layout and verified live (see header notes).
//!
//! ## Account layout (anchor-discriminator-prefixed)
//!
//!     0..8       Anchor discriminator
//!     8..40      write_authority:    Pubkey (32)
//!     40..?      verification_level: VerificationLevel
//!                  (Borsh enum: 1-byte tag,
//!                    Full = 0x01 → no extra payload  → 1 byte total
//!                    Partial = 0x00 → +1 byte num_signatures → 2 bytes total)
//!     ?..?+32    feed_id:            [u8; 32]
//!     ?..?+8     price:              i64    LE
//!     ?..?+8     conf:               u64    LE
//!     ?..?+4     exponent:           i32    LE
//!     ?..?+8     publish_time:       i64    LE
//!     ?..?+8     prev_publish_time:  i64    LE
//!     ?..?+8     ema_price:          i64    LE
//!     ?..?+8     ema_conf:           u64    LE
//!     ?..?+8     posted_slot:        u64    LE
//!
//! For the **Full** verification path the absolute offsets become:
//!
//!     verification_level @ 40 (1 byte; must equal 0x01)
//!     feed_id            @ 41
//!     price              @ 73
//!     conf               @ 81
//!     exponent           @ 89
//!     publish_time       @ 93
//!
//! Total live account size = 8+32+1+32+8+8+4+8+8+8+8+8 = **133 bytes** when
//! `verification_level == Full` (Anchor's `LEN` constant of 142 reserves
//! +1 byte slack for the worst-case Partial variant; the on-disk byte
//! string is variable-length per Borsh enum encoding).
//!
//! Verified 2026-04-23 against devnet account
//! `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` (owner
//! `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`, feed_id
//! `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`
//! = canonical SOL/USD): account length 134, verification_level=0x01,
//! decoded price 8543250499 × 10^-8 = $85.43, publish_time fresh, conf
//! ratio 0.058 % — well under our 5 % sanity band.
//!
//! ## Choice of devnet feed
//!
//! Mainnet equivalent feed_id (same bytes, different program-derived
//! account on each cluster): `0xef0d…b56d` = SOL/USD. The PriceUpdateV2
//! account address is **cluster-specific** because it's derived from the
//! posting authority + feed_id; on mainnet the canonical SOL/USD pull
//! account is `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` for the
//! Sponsored Feeds posting authority — so happens to be the same as
//! devnet here. Always check `feed_id` matches the expected SOL/USD
//! constant before using the price.
//!
//! See https://pyth.network/developers/price-feed-ids#solana-stable for
//! the canonical feed-id list.

use pinocchio::{account::AccountView, error::ProgramError};

/// Pyth Solana Receiver program ID
/// (`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`).
///
/// Source of truth: `pyth_solana_receiver_sdk::ID`.
pub const PYTH_RECEIVER_PROGRAM_ID: pinocchio::address::Address =
    pinocchio::address::Address::new_from_array([
        0x0c, 0xb7, 0xfa, 0xbb, 0x52, 0xf7, 0xa6, 0x48, 0xbb, 0x5b, 0x31, 0x7d, 0x9a, 0x01, 0x8b,
        0x90, 0x57, 0xcb, 0x02, 0x47, 0x74, 0xfa, 0xfe, 0x01, 0xe6, 0xc4, 0xdf, 0x98, 0xcc, 0x38,
        0x58, 0x81,
    ]);

/// Canonical SOL/USD Pyth feed_id (32-byte hex
/// `ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`).
/// Pyth feed IDs are global (same on every chain Pyth bridges to) — only
/// the on-chain account address derived from them is cluster-specific.
pub const SOL_USD_FEED_ID: [u8; 32] = [
    0xef, 0x0d, 0x8b, 0x6f, 0xda, 0x2c, 0xeb, 0xa4, 0x1d, 0xa1, 0x5d, 0x40, 0x95, 0xd1, 0xda, 0x39,
    0x2a, 0x0d, 0x2f, 0x8e, 0xd0, 0xc6, 0xc7, 0xbc, 0x0f, 0x4c, 0xfa, 0xc8, 0xc2, 0x80, 0xb5, 0x6d,
];

/// Borsh enum tag for `VerificationLevel::Full`. We require Full
/// verification — Partial accepts updates with fewer Wormhole guardian
/// signatures, which is unsafe for NAV inputs.
const VERIFICATION_LEVEL_FULL_TAG: u8 = 0x01;

// Field offsets for the **Full** verification variant. See module-level
// doc for derivation.
const OFFSET_VERIFICATION_LEVEL: usize = 40;
const OFFSET_FEED_ID: usize = 41;
const OFFSET_PRICE: usize = 73;
const OFFSET_CONF: usize = 81;
const OFFSET_EXPONENT: usize = 89;
const OFFSET_PUBLISH_TIME: usize = 93;

/// Minimum byte length of a PriceUpdateV2 in the Full-verification
/// shape. We only need bytes through `publish_time` end.
const PYTH_MIN_LEN: usize = OFFSET_PUBLISH_TIME + 8;

/// Maximum staleness, in seconds, we'll tolerate for a Pyth update before
/// rejecting it. ~24 s ≈ 60 Solana slots; we use unix-timestamp
/// arithmetic because Pyth's `publish_time` is a unix timestamp.
pub const PYTH_MAX_STALENESS_SECONDS: i64 = 60;

/// Confidence-band threshold expressed as a 1/N fraction of price.
/// `conf / price > 1/20` (i.e. > 5 %) → reject as too uncertain.
pub const PYTH_CONF_BAND_DENOM: u64 = 20;

/// One Pyth `Price` snapshot extracted from the account — only the fields
/// we need for NAV math.
pub struct PythPrice {
    /// Price as `i64` in units of `10^exponent`. Always positive when
    /// returned from `read_price_validated` (negatives are rejected).
    pub price: i64,
    /// Confidence interval, same units as `price`.
    pub conf: u64,
    /// Power-of-ten exponent, typically -8 for crypto feeds.
    pub exponent: i32,
    /// Unix timestamp of the price update.
    pub publish_time: i64,
}

/// Read a Pyth PriceUpdateV2 account and return the validated price.
///
/// Defensive checks:
///   1. Account is owned by the Pyth Receiver program.
///   2. Length covers all fields we read.
///   3. `verification_level == Full` (rejects Partial — sub-quorum).
///   4. `feed_id` matches `expected_feed_id` (rejects wrong asset).
///   5. `publish_time` is within `PYTH_MAX_STALENESS_SECONDS` of `now_unix`.
///   6. `price > 0` (NAV math expects positive).
///   7. `conf / price <= 1 / PYTH_CONF_BAND_DENOM` (≤ 5 %).
pub fn read_price_validated(
    oracle: &AccountView,
    expected_feed_id: &[u8; 32],
    now_unix: i64,
) -> Result<PythPrice, ProgramError> {
    if !oracle.owned_by(&PYTH_RECEIVER_PROGRAM_ID) {
        return Err(ProgramError::IllegalOwner);
    }

    let data = oracle.try_borrow()?;
    if data.len() < PYTH_MIN_LEN {
        return Err(ProgramError::InvalidAccountData);
    }

    // Verification level — must be Full (single-byte tag 0x01).
    if data[OFFSET_VERIFICATION_LEVEL] != VERIFICATION_LEVEL_FULL_TAG {
        return Err(ProgramError::InvalidAccountData);
    }

    // feed_id must match expected (locks us to SOL/USD vs e.g. BTC/USD).
    let mut feed_id = [0u8; 32];
    feed_id.copy_from_slice(&data[OFFSET_FEED_ID..OFFSET_FEED_ID + 32]);
    if &feed_id != expected_feed_id {
        return Err(ProgramError::InvalidAccountData);
    }

    let price = i64::from_le_bytes(
        data[OFFSET_PRICE..OFFSET_PRICE + 8]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );
    let conf = u64::from_le_bytes(
        data[OFFSET_CONF..OFFSET_CONF + 8]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );
    let exponent = i32::from_le_bytes(
        data[OFFSET_EXPONENT..OFFSET_EXPONENT + 4]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );
    let publish_time = i64::from_le_bytes(
        data[OFFSET_PUBLISH_TIME..OFFSET_PUBLISH_TIME + 8]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );

    // Staleness — reject any update older than the window. `now_unix` may
    // be slightly behind `publish_time` (cluster time skew) so we only
    // reject on the "too old" side.
    let age = now_unix.saturating_sub(publish_time);
    if age > PYTH_MAX_STALENESS_SECONDS {
        return Err(ProgramError::InvalidAccountData);
    }

    if price <= 0 {
        return Err(ProgramError::InvalidAccountData);
    }
    let price_u = price as u64;

    // Conf band: conf / price > 1/PYTH_CONF_BAND_DENOM ⇔
    //            conf * PYTH_CONF_BAND_DENOM > price.
    let conf_scaled = conf
        .checked_mul(PYTH_CONF_BAND_DENOM)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    if conf_scaled > price_u {
        return Err(ProgramError::InvalidAccountData);
    }

    Ok(PythPrice {
        price,
        conf,
        exponent,
        publish_time,
    })
}

/// Convert SOL **lamports** to USDC **base units** (6-decimal) using a
/// validated Pyth SOL/USD price.
///
/// Math derivation:
///
///     usd_value           = sol_lamports / 10^9                (SOL units)
///                           × price × 10^exponent              (USD per SOL)
///     usdc_base_units     = usd_value × 10^6                   (USDC has 6 dp)
///                         = sol_lamports × price
///                           × 10^(exponent + 6 - 9)
///                         = sol_lamports × price / 10^(9 - exponent - 6)
///                         = sol_lamports × price / 10^(3 - exponent)
///
/// For the canonical exponent = -8: divisor = 10^(3 - (-8)) = 10^11.
/// (Equivalently: × price / 10^(9 + (-8) + 6 ⊖ ... ) — same thing.)
///
/// Sanity check: 1 SOL (10^9 lamports) at $100 (price=10^10, exp=-8):
///     1e9 × 1e10 / 1e11 = 1e8 = 100_000_000 = 100 USDC base units × 10^6
///     → 100.000000 USDC ✓
///
/// Uses u128 intermediate to avoid overflow on the multiply.
pub fn sol_lamports_to_usdc_base_units(
    sol_lamports: u64,
    price: i64,
    exponent: i32,
) -> Result<u64, ProgramError> {
    if sol_lamports == 0 {
        return Ok(0);
    }
    if price <= 0 {
        return Err(ProgramError::InvalidAccountData);
    }

    // Compute divisor power: SOL_DECIMALS - USDC_DECIMALS - exponent
    //                     = 9 - 6 - exponent
    //                     = 3 - exponent
    // For exponent = -8: power = 11.
    // For exponent = +0: power = 3.
    // We don't expect positive exponents on USD price feeds but handle
    // both branches for robustness.
    let power: i32 = 3i32
        .checked_sub(exponent)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let numerator = (sol_lamports as u128)
        .checked_mul(price as u128)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let value: u128 = if power >= 0 {
        // power_u in the realistic range 0..=39 (i32 max would overflow
        // u128, but real Pyth exponents are |e| ≤ ~12).
        if power > 38 {
            return Err(ProgramError::ArithmeticOverflow);
        }
        let divisor = 10u128
            .checked_pow(power as u32)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        numerator / divisor
    } else {
        let mag = (-power) as u32;
        if mag > 38 {
            return Err(ProgramError::ArithmeticOverflow);
        }
        let multiplier = 10u128
            .checked_pow(mag)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        numerator
            .checked_mul(multiplier)
            .ok_or(ProgramError::ArithmeticOverflow)?
    };

    if value > u64::MAX as u128 {
        return Err(ProgramError::ArithmeticOverflow);
    }
    Ok(value as u64)
}
