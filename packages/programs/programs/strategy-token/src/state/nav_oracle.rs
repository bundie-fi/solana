pub const NAV_ORACLE_DISCRIMINATOR: [u8; 8] = [0xa1, 0x4e, 0x73, 0x20, 0xbc, 0x44, 0x61, 0x05];
pub const NAV_ORACLE_LEN: usize = 89;

pub const DEFAULT_MIN_SNAPSHOT_INTERVAL: u64 = 300;
pub const DEFAULT_TWAP_WINDOW: u64 = 9000;

// Field offsets
const OFF_DISCRIMINATOR: usize = 0;
const OFF_STRATEGY: usize = 8;
const OFF_NAV_PER_SHARE: usize = 40;
const OFF_TWAP_VALUE: usize = 48;
const OFF_SNAPSHOT_COUNT: usize = 56;
const OFF_LAST_SNAPSHOT_SLOT: usize = 64;
const OFF_MIN_SNAPSHOT_INTERVAL: usize = 72;
const OFF_TWAP_WINDOW: usize = 80;
const OFF_BUMP: usize = 88;

pub struct NavOracle;

impl NavOracle {
    // ---------- Discriminator ----------

    #[inline(always)]
    pub fn check_discriminator(data: &[u8]) -> bool {
        data[OFF_DISCRIMINATOR..OFF_DISCRIMINATOR + 8] == NAV_ORACLE_DISCRIMINATOR
    }

    #[inline(always)]
    pub fn set_discriminator(data: &mut [u8]) {
        data[OFF_DISCRIMINATOR..OFF_DISCRIMINATOR + 8].copy_from_slice(&NAV_ORACLE_DISCRIMINATOR);
    }

    // ---------- strategy (Pubkey, 32 bytes) ----------

    #[inline(always)]
    pub fn strategy(data: &[u8]) -> &[u8; 32] {
        data[OFF_STRATEGY..OFF_STRATEGY + 32].try_into().unwrap()
    }

    #[inline(always)]
    pub fn set_strategy(data: &mut [u8], v: &[u8; 32]) {
        data[OFF_STRATEGY..OFF_STRATEGY + 32].copy_from_slice(v);
    }

    // ---------- nav_per_share (u64) ----------

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

    // ---------- twap_value (u64) ----------

    #[inline(always)]
    pub fn twap_value(data: &[u8]) -> u64 {
        u64::from_le_bytes(data[OFF_TWAP_VALUE..OFF_TWAP_VALUE + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn set_twap_value(data: &mut [u8], v: u64) {
        data[OFF_TWAP_VALUE..OFF_TWAP_VALUE + 8].copy_from_slice(&v.to_le_bytes());
    }

    // ---------- snapshot_count (u64) ----------

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

    // ---------- last_snapshot_slot (u64) ----------

    #[inline(always)]
    pub fn last_snapshot_slot(data: &[u8]) -> u64 {
        u64::from_le_bytes(
            data[OFF_LAST_SNAPSHOT_SLOT..OFF_LAST_SNAPSHOT_SLOT + 8]
                .try_into()
                .unwrap(),
        )
    }

    #[inline(always)]
    pub fn set_last_snapshot_slot(data: &mut [u8], v: u64) {
        data[OFF_LAST_SNAPSHOT_SLOT..OFF_LAST_SNAPSHOT_SLOT + 8].copy_from_slice(&v.to_le_bytes());
    }

    // ---------- min_snapshot_interval (u64) ----------

    #[inline(always)]
    pub fn min_snapshot_interval(data: &[u8]) -> u64 {
        u64::from_le_bytes(
            data[OFF_MIN_SNAPSHOT_INTERVAL..OFF_MIN_SNAPSHOT_INTERVAL + 8]
                .try_into()
                .unwrap(),
        )
    }

    #[inline(always)]
    pub fn set_min_snapshot_interval(data: &mut [u8], v: u64) {
        data[OFF_MIN_SNAPSHOT_INTERVAL..OFF_MIN_SNAPSHOT_INTERVAL + 8]
            .copy_from_slice(&v.to_le_bytes());
    }

    // ---------- twap_window (u64) ----------

    #[inline(always)]
    pub fn twap_window(data: &[u8]) -> u64 {
        u64::from_le_bytes(
            data[OFF_TWAP_WINDOW..OFF_TWAP_WINDOW + 8]
                .try_into()
                .unwrap(),
        )
    }

    #[inline(always)]
    pub fn set_twap_window(data: &mut [u8], v: u64) {
        data[OFF_TWAP_WINDOW..OFF_TWAP_WINDOW + 8].copy_from_slice(&v.to_le_bytes());
    }

    // ---------- bump (u8) ----------

    #[inline(always)]
    pub fn bump(data: &[u8]) -> u8 {
        data[OFF_BUMP]
    }

    #[inline(always)]
    pub fn set_bump(data: &mut [u8], v: u8) {
        data[OFF_BUMP] = v;
    }
}
