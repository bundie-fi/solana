/// Strategy account type constants
pub const STRATEGY_TYPE_YIELD: u8 = 0;
pub const STRATEGY_TYPE_AGENT: u8 = 1;

pub const STATUS_ACTIVE: u8 = 0;
pub const STATUS_PAUSED: u8 = 1;
pub const STATUS_CLOSED: u8 = 2;

pub const STRATEGY_DISCRIMINATOR: [u8; 8] = [0xd0, 0x82, 0x35, 0xce, 0x9a, 0x7f, 0x5b, 0x11];
pub const STRATEGY_LEN: usize = 330;

// Field offsets
const OFF_DISCRIMINATOR: usize = 0;
const OFF_AUTHORITY: usize = 8;
const OFF_MINT: usize = 40;
const OFF_WALLET: usize = 72;
const OFF_DEPOSIT_MINT: usize = 104;
const OFF_PROTOCOL: usize = 136;
const OFF_RESERVE: usize = 168;
const OFF_NAME: usize = 200;
const OFF_STRATEGY_TYPE: usize = 232;
const OFF_STATUS: usize = 233;
const OFF_FEE_BPS: usize = 234;
const OFF_TOTAL_DEPOSITS: usize = 236;
const OFF_CURRENT_NAV: usize = 244;
const OFF_TOTAL_SHARES: usize = 252;
const OFF_TOTAL_INVESTORS: usize = 260;
const OFF_HIGH_WATER_MARK: usize = 264;
const OFF_MIN_DEPOSIT: usize = 272;
const OFF_LAST_NAV_SLOT: usize = 280;
const OFF_NAV_TWAP_ACCUMULATOR: usize = 288;
const OFF_TWAP_LAST_SLOT: usize = 304;
const OFF_CREATED_AT: usize = 312;
const OFF_BUMP: usize = 320;
const OFF_WALLET_BUMP: usize = 321;

pub struct Strategy;

impl Strategy {
    // ---------- Discriminator ----------

    #[inline(always)]
    pub fn check_discriminator(data: &[u8]) -> bool {
        data[OFF_DISCRIMINATOR..OFF_DISCRIMINATOR + 8] == STRATEGY_DISCRIMINATOR
    }

    #[inline(always)]
    pub fn set_discriminator(data: &mut [u8]) {
        data[OFF_DISCRIMINATOR..OFF_DISCRIMINATOR + 8]
            .copy_from_slice(&STRATEGY_DISCRIMINATOR);
    }

    // ---------- authority (Pubkey, 32 bytes) ----------

    #[inline(always)]
    pub fn authority(data: &[u8]) -> &[u8; 32] {
        data[OFF_AUTHORITY..OFF_AUTHORITY + 32].try_into().unwrap()
    }

    #[inline(always)]
    pub fn set_authority(data: &mut [u8], v: &[u8; 32]) {
        data[OFF_AUTHORITY..OFF_AUTHORITY + 32].copy_from_slice(v);
    }

    // ---------- mint (Pubkey, 32 bytes) ----------

    #[inline(always)]
    pub fn mint(data: &[u8]) -> &[u8; 32] {
        data[OFF_MINT..OFF_MINT + 32].try_into().unwrap()
    }

    #[inline(always)]
    pub fn set_mint(data: &mut [u8], v: &[u8; 32]) {
        data[OFF_MINT..OFF_MINT + 32].copy_from_slice(v);
    }

    // ---------- wallet (Pubkey, 32 bytes) ----------

    #[inline(always)]
    pub fn wallet(data: &[u8]) -> &[u8; 32] {
        data[OFF_WALLET..OFF_WALLET + 32].try_into().unwrap()
    }

    #[inline(always)]
    pub fn set_wallet(data: &mut [u8], v: &[u8; 32]) {
        data[OFF_WALLET..OFF_WALLET + 32].copy_from_slice(v);
    }

    // ---------- deposit_mint (Pubkey, 32 bytes) ----------

    #[inline(always)]
    pub fn deposit_mint(data: &[u8]) -> &[u8; 32] {
        data[OFF_DEPOSIT_MINT..OFF_DEPOSIT_MINT + 32].try_into().unwrap()
    }

    #[inline(always)]
    pub fn set_deposit_mint(data: &mut [u8], v: &[u8; 32]) {
        data[OFF_DEPOSIT_MINT..OFF_DEPOSIT_MINT + 32].copy_from_slice(v);
    }

    // ---------- protocol (Pubkey, 32 bytes) ----------

    #[inline(always)]
    pub fn protocol(data: &[u8]) -> &[u8; 32] {
        data[OFF_PROTOCOL..OFF_PROTOCOL + 32].try_into().unwrap()
    }

    #[inline(always)]
    pub fn set_protocol(data: &mut [u8], v: &[u8; 32]) {
        data[OFF_PROTOCOL..OFF_PROTOCOL + 32].copy_from_slice(v);
    }

    // ---------- reserve (Pubkey, 32 bytes) ----------

    #[inline(always)]
    pub fn reserve(data: &[u8]) -> &[u8; 32] {
        data[OFF_RESERVE..OFF_RESERVE + 32].try_into().unwrap()
    }

    #[inline(always)]
    pub fn set_reserve(data: &mut [u8], v: &[u8; 32]) {
        data[OFF_RESERVE..OFF_RESERVE + 32].copy_from_slice(v);
    }

    // ---------- name (32 bytes) ----------

    #[inline(always)]
    pub fn name(data: &[u8]) -> &[u8; 32] {
        data[OFF_NAME..OFF_NAME + 32].try_into().unwrap()
    }

    #[inline(always)]
    pub fn set_name(data: &mut [u8], v: &[u8; 32]) {
        data[OFF_NAME..OFF_NAME + 32].copy_from_slice(v);
    }

    // ---------- strategy_type (u8) ----------

    #[inline(always)]
    pub fn strategy_type(data: &[u8]) -> u8 {
        data[OFF_STRATEGY_TYPE]
    }

    #[inline(always)]
    pub fn set_strategy_type(data: &mut [u8], v: u8) {
        data[OFF_STRATEGY_TYPE] = v;
    }

    // ---------- status (u8) ----------

    #[inline(always)]
    pub fn status(data: &[u8]) -> u8 {
        data[OFF_STATUS]
    }

    #[inline(always)]
    pub fn set_status(data: &mut [u8], v: u8) {
        data[OFF_STATUS] = v;
    }

    // ---------- fee_bps (u16) ----------

    #[inline(always)]
    pub fn fee_bps(data: &[u8]) -> u16 {
        u16::from_le_bytes(data[OFF_FEE_BPS..OFF_FEE_BPS + 2].try_into().unwrap())
    }

    #[inline(always)]
    pub fn set_fee_bps(data: &mut [u8], v: u16) {
        data[OFF_FEE_BPS..OFF_FEE_BPS + 2].copy_from_slice(&v.to_le_bytes());
    }

    // ---------- total_deposits (u64) ----------

    #[inline(always)]
    pub fn total_deposits(data: &[u8]) -> u64 {
        u64::from_le_bytes(data[OFF_TOTAL_DEPOSITS..OFF_TOTAL_DEPOSITS + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn set_total_deposits(data: &mut [u8], v: u64) {
        data[OFF_TOTAL_DEPOSITS..OFF_TOTAL_DEPOSITS + 8].copy_from_slice(&v.to_le_bytes());
    }

    // ---------- current_nav (u64) ----------

    #[inline(always)]
    pub fn current_nav(data: &[u8]) -> u64 {
        u64::from_le_bytes(data[OFF_CURRENT_NAV..OFF_CURRENT_NAV + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn set_current_nav(data: &mut [u8], v: u64) {
        data[OFF_CURRENT_NAV..OFF_CURRENT_NAV + 8].copy_from_slice(&v.to_le_bytes());
    }

    // ---------- total_shares (u64) ----------

    #[inline(always)]
    pub fn total_shares(data: &[u8]) -> u64 {
        u64::from_le_bytes(data[OFF_TOTAL_SHARES..OFF_TOTAL_SHARES + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn set_total_shares(data: &mut [u8], v: u64) {
        data[OFF_TOTAL_SHARES..OFF_TOTAL_SHARES + 8].copy_from_slice(&v.to_le_bytes());
    }

    // ---------- total_investors (u32) ----------

    #[inline(always)]
    pub fn total_investors(data: &[u8]) -> u32 {
        u32::from_le_bytes(data[OFF_TOTAL_INVESTORS..OFF_TOTAL_INVESTORS + 4].try_into().unwrap())
    }

    #[inline(always)]
    pub fn set_total_investors(data: &mut [u8], v: u32) {
        data[OFF_TOTAL_INVESTORS..OFF_TOTAL_INVESTORS + 4].copy_from_slice(&v.to_le_bytes());
    }

    // ---------- high_water_mark (u64) ----------

    #[inline(always)]
    pub fn high_water_mark(data: &[u8]) -> u64 {
        u64::from_le_bytes(data[OFF_HIGH_WATER_MARK..OFF_HIGH_WATER_MARK + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn set_high_water_mark(data: &mut [u8], v: u64) {
        data[OFF_HIGH_WATER_MARK..OFF_HIGH_WATER_MARK + 8].copy_from_slice(&v.to_le_bytes());
    }

    // ---------- min_deposit (u64) ----------

    #[inline(always)]
    pub fn min_deposit(data: &[u8]) -> u64 {
        u64::from_le_bytes(data[OFF_MIN_DEPOSIT..OFF_MIN_DEPOSIT + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn set_min_deposit(data: &mut [u8], v: u64) {
        data[OFF_MIN_DEPOSIT..OFF_MIN_DEPOSIT + 8].copy_from_slice(&v.to_le_bytes());
    }

    // ---------- last_nav_slot (u64) ----------

    #[inline(always)]
    pub fn last_nav_slot(data: &[u8]) -> u64 {
        u64::from_le_bytes(data[OFF_LAST_NAV_SLOT..OFF_LAST_NAV_SLOT + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn set_last_nav_slot(data: &mut [u8], v: u64) {
        data[OFF_LAST_NAV_SLOT..OFF_LAST_NAV_SLOT + 8].copy_from_slice(&v.to_le_bytes());
    }

    // ---------- nav_twap_accumulator (u128) ----------

    #[inline(always)]
    pub fn nav_twap_accumulator(data: &[u8]) -> u128 {
        u128::from_le_bytes(data[OFF_NAV_TWAP_ACCUMULATOR..OFF_NAV_TWAP_ACCUMULATOR + 16].try_into().unwrap())
    }

    #[inline(always)]
    pub fn set_nav_twap_accumulator(data: &mut [u8], v: u128) {
        data[OFF_NAV_TWAP_ACCUMULATOR..OFF_NAV_TWAP_ACCUMULATOR + 16].copy_from_slice(&v.to_le_bytes());
    }

    // ---------- twap_last_slot (u64) ----------

    #[inline(always)]
    pub fn twap_last_slot(data: &[u8]) -> u64 {
        u64::from_le_bytes(data[OFF_TWAP_LAST_SLOT..OFF_TWAP_LAST_SLOT + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn set_twap_last_slot(data: &mut [u8], v: u64) {
        data[OFF_TWAP_LAST_SLOT..OFF_TWAP_LAST_SLOT + 8].copy_from_slice(&v.to_le_bytes());
    }

    // ---------- created_at (i64) ----------

    #[inline(always)]
    pub fn created_at(data: &[u8]) -> i64 {
        i64::from_le_bytes(data[OFF_CREATED_AT..OFF_CREATED_AT + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn set_created_at(data: &mut [u8], v: i64) {
        data[OFF_CREATED_AT..OFF_CREATED_AT + 8].copy_from_slice(&v.to_le_bytes());
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

    // ---------- wallet_bump (u8) ----------

    #[inline(always)]
    pub fn wallet_bump(data: &[u8]) -> u8 {
        data[OFF_WALLET_BUMP]
    }

    #[inline(always)]
    pub fn set_wallet_bump(data: &mut [u8], v: u8) {
        data[OFF_WALLET_BUMP] = v;
    }
}
