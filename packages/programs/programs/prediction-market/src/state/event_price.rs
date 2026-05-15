//! EventPrice — CPI-readable, Pyth-style price feed account for Bundie
//! event markets.
//!
//! Other Solana programs (Aave-style lenders, perp DEXes, vaults that
//! want depeg insurance, etc.) consume Bundie's consensus price by
//! deserialising this account directly — the same way they read a Pyth
//! price feed. No CPI call is required: the consumer derives the PDA
//! from `event_id_hash`, reads `AccountInfo.data`, and parses the
//! fixed-layout struct.
//!
//! Writers:
//!   - `update_event_price` (off-chain resolver, same authority as
//!     `resolve_event`) bumps `price`, `confidence`, `depth_usd_u64`,
//!     and the two `updated_at_*` fields each resolver tick.
//!   - `resolve_event` flips `status` to `STATUS_RESOLVED` and freezes
//!     `price` at the final outcome (0 for NO, `PRICE_SCALE` for YES).
//!
//! Scale (Pyth-style):
//!   - `exponent = -9`. Probabilities are encoded as fixed-point Q9:
//!     0.5 → 500_000_000, 1.0 → 1_000_000_000.
//!   - `confidence` uses the same scale. Wider = less certain.
//!   - `depth_usd_u64` is USDC base units (6 dp), NOT Q9-scaled.
//!
//! Status:
//!   - 0 (`STATUS_ACTIVE`)   — live market, price is current
//!   - 1 (`STATUS_RESOLVED`) — settled, price is frozen at outcome
//!
//! The 64-byte `_reserved` tail lets us add fields (TWAP, decimals,
//! confidence_lo/hi, etc.) without reallocating consumer-facing accounts.

use anchor_lang::prelude::*;

/// PDA seed prefix for EventPrice. Concatenated with the event_id_hash:
/// `[b"event_price", event_id_hash.as_ref()]`.
///
/// Deliberately keyed on `event_id_hash` (not `market.key()`) so any
/// program can derive the price PDA from just the event slug —
/// identical to how Pyth keys feeds on a stable symbol rather than a
/// per-deployment market account.
pub const EVENT_PRICE_SEED: &[u8] = b"event_price";

/// Fixed-point exponent for `price` and `confidence`. Pyth convention:
/// negative exponent means the on-chain value is scaled UP by
/// 10^|exponent|. A probability of 0.5 with exponent=-9 is stored as
/// 500_000_000.
pub const EVENT_PRICE_EXPONENT: i32 = -9;

/// 10^9 — the Q9 scale factor. A YES outcome freezes `price` at this
/// value; a NO outcome freezes it at 0.
pub const PRICE_SCALE: u64 = 1_000_000_000;

/// `EventPrice.status` values. Stable on-chain ABI — do not renumber.
pub const STATUS_ACTIVE: u8 = 0;
pub const STATUS_RESOLVED: u8 = 1;

/// CPI-readable price feed for a single event market.
///
/// Layout is intentionally flat + fixed-size: every consumer can parse
/// it with a single `borsh::from_slice(&data[8..])` after the Anchor
/// discriminator. No `Option`s, no `Vec`s, no `String`s — the field
/// order is the wire format and is part of Bundie's published ABI.
#[account]
#[derive(InitSpace)]
pub struct EventPrice {
    /// blake3 hash of the canonical event_id slug from
    /// `scripts/resolvers/sources.json`. Same hash used as the market
    /// PDA seed; consumers verify the price feed matches the event
    /// they expect.
    pub event_id_hash: [u8; 32],
    /// The Market account this price tracks. Defence-in-depth — a
    /// consumer that already has the market pubkey can cross-check.
    pub market: Pubkey,
    /// YES-share probability in Q9 fixed-point (exponent = -9).
    /// Range: [0, PRICE_SCALE]. After resolution this is frozen at
    /// either 0 (NO won) or PRICE_SCALE (YES won).
    pub price: u64,
    /// Fixed-point exponent for `price` and `confidence`. Always
    /// `EVENT_PRICE_EXPONENT` for v1, but stored explicitly so
    /// consumers can parse without hardcoding the scale.
    pub exponent: i32,
    /// Confidence interval (Q9). Smaller = higher confidence.
    /// Computed off-chain from LMSR depth + spread; see
    /// `packages/backend/src/v1/lmsr.ts::confidenceScore`.
    pub confidence: u64,
    /// Market depth in USDC base units (6 decimals). NOT Q9-scaled —
    /// matches the collateral mint's native units. Consumers use this
    /// to weight the price (thin markets ⇒ low trust).
    pub depth_usd_u64: u64,
    /// Solana slot of the last `update_event_price` call. Consumers
    /// reject feeds older than their staleness threshold.
    pub updated_at_slot: u64,
    /// `Clock::unix_timestamp` of the last update. Mirrors
    /// `updated_at_slot` in wall-clock domain for off-chain consumers.
    pub updated_at_ts: i64,
    /// `STATUS_ACTIVE` (0) while the market is live; `STATUS_RESOLVED`
    /// (1) once `resolve_event` has settled. Once resolved, `price` is
    /// frozen and consumers can treat it as a terminal value.
    pub status: u8,
    /// PDA bump.
    pub bump: u8,
    /// Reserved for forward-compatible additions (TWAP, decimals,
    /// confidence_lo/hi, ...). Zero-initialised; consumers ignore.
    pub _reserved: [u8; 64],
}

impl EventPrice {
    /// Total account size including the 8-byte Anchor discriminator.
    pub const ACCOUNT_SIZE: usize = 8 + Self::INIT_SPACE;
}

/// Stack-only view returned by `read_event_price`. Consumer programs
/// pull only the fields they need; the rest of the on-chain layout is
/// abstracted away so future schema additions (within `_reserved`)
/// don't break callers.
#[derive(Clone, Copy, Debug)]
pub struct EventPriceView {
    /// YES probability in Q9 (exponent = -9).
    pub price_q9: u64,
    /// Confidence in Q9.
    pub confidence_q9: u64,
    /// Depth in USDC base units (6 dp).
    pub depth_usd_u64: u64,
    /// Slots elapsed since `updated_at_slot`. Consumers reject feeds
    /// where this exceeds their staleness threshold.
    pub staleness_slots: u64,
    /// `EventPrice.status` — 0 active, 1 resolved.
    pub status: u8,
}

/// Read helper for foreign programs. Deserialises an `EventPrice`
/// account from a raw `AccountInfo` and returns a stack-only view +
/// computed staleness.
///
/// This is the function third-party programs copy-paste into their own
/// codebase to consume Bundie prices. It performs three checks:
///
///   1. The account is owned by the prediction-market program.
///   2. The Anchor discriminator matches `EventPrice`.
///   3. The PDA derivation matches `[b"event_price", event_id_hash]`.
///
/// All three are required — skipping any one lets a malicious caller
/// substitute a forged account. The PDA check is the load-bearing one;
/// the discriminator and owner checks are defence-in-depth.
pub fn read_event_price(
    account: &AccountInfo,
    expected_program_id: &Pubkey,
) -> std::result::Result<EventPriceView, ProgramError> {
    // 1. Owner check — must be the prediction-market program.
    if account.owner != expected_program_id {
        return Err(ProgramError::IllegalOwner);
    }

    // 2. Discriminator + deserialise.
    let data = account.try_borrow_data()?;
    if data.len() < EventPrice::ACCOUNT_SIZE {
        return Err(ProgramError::AccountDataTooSmall);
    }
    let price_account: EventPrice = EventPrice::try_deserialize(&mut data.as_ref())
        .map_err(|_| ProgramError::InvalidAccountData)?;

    // 3. PDA derivation check — proves the account is the canonical
    //    EventPrice PDA for the embedded event_id_hash. Without this
    //    check a malicious caller could pass any program-owned
    //    `EventPrice` with arbitrary contents.
    let (expected_pda, _bump) = Pubkey::find_program_address(
        &[EVENT_PRICE_SEED, price_account.event_id_hash.as_ref()],
        expected_program_id,
    );
    if expected_pda != *account.key {
        return Err(ProgramError::InvalidSeeds);
    }

    let now_slot = Clock::get()?.slot;
    let staleness_slots = now_slot.saturating_sub(price_account.updated_at_slot);

    Ok(EventPriceView {
        price_q9: price_account.price,
        confidence_q9: price_account.confidence,
        depth_usd_u64: price_account.depth_usd_u64,
        staleness_slots,
        status: price_account.status,
    })
}
