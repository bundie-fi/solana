//! PositionSnapshots — frozen point-in-time record of a strategy's composition.
//!
//! Updated every ~24h by an off-chain keeper. Predictor agents query this to form
//! informed views without creators retaining a permanent real-time information
//! advantage. The 24h cadence is enforced on-chain via `MIN_SNAPSHOT_INTERVAL_SLOTS`.
//!
//! The strategy's live NAV (`Strategy.current_nav`) continues to update in real
//! time on every back_strategy / redeem_shares / update_nav call. The "lag" the
//! v5 spec describes is between `Strategy.current_nav` (real-time) and
//! `PositionSnapshots.portfolio_value` (24h-stale).

pub const POSITION_SNAPSHOTS_DISCRIMINATOR: [u8; 8] =
    [0x7d, 0xa9, 0x1f, 0x4c, 0x62, 0x30, 0x8b, 0xe1];

pub const POSITION_SNAPSHOTS_LEN: usize = 161;

/// Minimum slots between snapshots. ~24h at 400ms/slot = 216_000 slots.
pub const MIN_SNAPSHOT_INTERVAL_SLOTS: u64 = 216_000;

// Field offsets
const OFF_DISCRIMINATOR: usize = 0;
const OFF_STRATEGY: usize = 8;
const OFF_SNAPSHOT_AT: usize = 40; // i64, unix timestamp
const OFF_SNAPSHOT_SLOT: usize = 48; // u64, solana slot
const OFF_PROTOCOL: usize = 56; // Pubkey
const OFF_RESERVE: usize = 88; // Pubkey
const OFF_PORTFOLIO_VALUE: usize = 120; // u64, USDC base units
const OFF_TOTAL_SHARES: usize = 128; // u64
const OFF_NAV_PER_SHARE: usize = 136; // u64, 1e9-scaled
const OFF_HIGH_WATER_MARK: usize = 144; // u64, 1e9-scaled
const OFF_SNAPSHOT_COUNT: usize = 152; // u64
const OFF_BUMP: usize = 160;

pub struct PositionSnapshots;

impl PositionSnapshots {
    #[inline(always)]
    pub fn check_discriminator(data: &[u8]) -> bool {
        data.len() >= 8
            && data[OFF_DISCRIMINATOR..OFF_DISCRIMINATOR + 8] == POSITION_SNAPSHOTS_DISCRIMINATOR
    }

    #[inline(always)]
    pub fn set_discriminator(data: &mut [u8]) {
        data[OFF_DISCRIMINATOR..OFF_DISCRIMINATOR + 8]
            .copy_from_slice(&POSITION_SNAPSHOTS_DISCRIMINATOR);
    }

    #[inline(always)]
    pub fn strategy(data: &[u8]) -> &[u8; 32] {
        data[OFF_STRATEGY..OFF_STRATEGY + 32].try_into().unwrap()
    }

    #[inline(always)]
    pub fn set_strategy(data: &mut [u8], v: &[u8; 32]) {
        data[OFF_STRATEGY..OFF_STRATEGY + 32].copy_from_slice(v);
    }

    #[inline(always)]
    pub fn snapshot_at(data: &[u8]) -> i64 {
        i64::from_le_bytes(
            data[OFF_SNAPSHOT_AT..OFF_SNAPSHOT_AT + 8]
                .try_into()
                .unwrap(),
        )
    }

    #[inline(always)]
    pub fn set_snapshot_at(data: &mut [u8], v: i64) {
        data[OFF_SNAPSHOT_AT..OFF_SNAPSHOT_AT + 8].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn snapshot_slot(data: &[u8]) -> u64 {
        u64::from_le_bytes(
            data[OFF_SNAPSHOT_SLOT..OFF_SNAPSHOT_SLOT + 8]
                .try_into()
                .unwrap(),
        )
    }

    #[inline(always)]
    pub fn set_snapshot_slot(data: &mut [u8], v: u64) {
        data[OFF_SNAPSHOT_SLOT..OFF_SNAPSHOT_SLOT + 8].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn protocol(data: &[u8]) -> &[u8; 32] {
        data[OFF_PROTOCOL..OFF_PROTOCOL + 32].try_into().unwrap()
    }

    #[inline(always)]
    pub fn set_protocol(data: &mut [u8], v: &[u8; 32]) {
        data[OFF_PROTOCOL..OFF_PROTOCOL + 32].copy_from_slice(v);
    }

    #[inline(always)]
    pub fn reserve(data: &[u8]) -> &[u8; 32] {
        data[OFF_RESERVE..OFF_RESERVE + 32].try_into().unwrap()
    }

    #[inline(always)]
    pub fn set_reserve(data: &mut [u8], v: &[u8; 32]) {
        data[OFF_RESERVE..OFF_RESERVE + 32].copy_from_slice(v);
    }

    #[inline(always)]
    pub fn portfolio_value(data: &[u8]) -> u64 {
        u64::from_le_bytes(
            data[OFF_PORTFOLIO_VALUE..OFF_PORTFOLIO_VALUE + 8]
                .try_into()
                .unwrap(),
        )
    }

    #[inline(always)]
    pub fn set_portfolio_value(data: &mut [u8], v: u64) {
        data[OFF_PORTFOLIO_VALUE..OFF_PORTFOLIO_VALUE + 8].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn total_shares(data: &[u8]) -> u64 {
        u64::from_le_bytes(
            data[OFF_TOTAL_SHARES..OFF_TOTAL_SHARES + 8]
                .try_into()
                .unwrap(),
        )
    }

    #[inline(always)]
    pub fn set_total_shares(data: &mut [u8], v: u64) {
        data[OFF_TOTAL_SHARES..OFF_TOTAL_SHARES + 8].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn nav_per_share(data: &[u8]) -> u64 {
        u64::from_le_bytes(
            data[OFF_NAV_PER_SHARE..OFF_NAV_PER_SHARE + 8]
                .try_into()
                .unwrap(),
        )
    }

    #[inline(always)]
    pub fn set_nav_per_share(data: &mut [u8], v: u64) {
        data[OFF_NAV_PER_SHARE..OFF_NAV_PER_SHARE + 8].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn high_water_mark(data: &[u8]) -> u64 {
        u64::from_le_bytes(
            data[OFF_HIGH_WATER_MARK..OFF_HIGH_WATER_MARK + 8]
                .try_into()
                .unwrap(),
        )
    }

    #[inline(always)]
    pub fn set_high_water_mark(data: &mut [u8], v: u64) {
        data[OFF_HIGH_WATER_MARK..OFF_HIGH_WATER_MARK + 8].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn snapshot_count(data: &[u8]) -> u64 {
        u64::from_le_bytes(
            data[OFF_SNAPSHOT_COUNT..OFF_SNAPSHOT_COUNT + 8]
                .try_into()
                .unwrap(),
        )
    }

    #[inline(always)]
    pub fn set_snapshot_count(data: &mut [u8], v: u64) {
        data[OFF_SNAPSHOT_COUNT..OFF_SNAPSHOT_COUNT + 8].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn bump(data: &[u8]) -> u8 {
        data[OFF_BUMP]
    }

    #[inline(always)]
    pub fn set_bump(data: &mut [u8], v: u8) {
        data[OFF_BUMP] = v;
    }
}
