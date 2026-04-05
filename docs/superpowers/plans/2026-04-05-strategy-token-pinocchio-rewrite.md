# Strategy Token Pinocchio + Beethoven Rewrite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the strategy-token Anchor program in pinocchio with inline Beethoven integration for Kamino deposit/withdraw and Jupiter Perps NAV reads.

**Architecture:** Single pinocchio `#![no_std]` program with 1-byte instruction discriminator dispatch. Beethoven's `kamino-deposit` crate compiles directly into the program for zero-overhead CPI routing. State accounts use manual fixed-offset serialization with 8-byte type discriminators. CPI helpers for SPL Token and System Program are hand-rolled using `MaybeUninit` + `invoke_signed`.

**Tech Stack:** pinocchio 0.10, beethoven (git, kamino-deposit feature), Solana SBF toolchain 3.1.12, LiteSVM for tests

**Spec:** `docs/superpowers/specs/2026-04-05-strategy-token-pinocchio-rewrite-design.md`

**Build command:** `PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH" cargo-build-sbf --manifest-path programs/strategy-token/Cargo.toml`

**Check command:** `cargo check --lib -p strategy-token`

---

## File Structure

```
programs/strategy-token/
  Cargo.toml                        — REPLACE: pinocchio + beethoven deps, cdylib crate
  Xargo.toml                        — KEEP as-is
  src/
    lib.rs                          — REPLACE: pinocchio entrypoint + discriminator dispatch
    error.rs                        — REPLACE: u32 error constants
    state/
      mod.rs                        — REPLACE: re-exports
      strategy.rs                   — REPLACE: Strategy struct with manual serialization
      nav_oracle.rs                 — REPLACE: NavOracle struct with manual serialization
    instructions/
      mod.rs                        — REPLACE: re-exports (remove Allocation struct)
      create_strategy.rs            — REPLACE: pinocchio account creation + init
      buy_shares.rs                 — REPLACE: Beethoven deposit + share mint
      redeem_shares.rs              — REPLACE: share burn + Kamino withdraw
      update_nav.rs                 — REPLACE: protocol NAV reads + TWAP
      rebalance.rs                  — REPLACE: multi-step Beethoven routing
    cpi/
      mod.rs                        — CREATE: re-exports
      spl_token.rs                  — CREATE: mint_to, burn, transfer, init_mint2
      system.rs                     — CREATE: create_account, transfer
      associated_token.rs           — CREATE: create_idempotent
      kamino_withdraw.rs            — CREATE: direct Kamino withdraw CPI
    util.rs                         — CREATE: assert_signer, assert_writable, verify_pda
```

---

## Task 1: Replace Cargo.toml and Entrypoint Skeleton

**Files:**
- Modify: `programs/strategy-token/Cargo.toml`
- Replace: `programs/strategy-token/src/lib.rs`
- Replace: `programs/strategy-token/src/error.rs`
- Replace: `programs/strategy-token/src/state/mod.rs`
- Replace: `programs/strategy-token/src/state/strategy.rs`
- Replace: `programs/strategy-token/src/state/nav_oracle.rs`
- Replace: `programs/strategy-token/src/instructions/mod.rs`
- Create: `programs/strategy-token/src/util.rs`
- Create: `programs/strategy-token/src/cpi/mod.rs`

This task sets up the skeleton that compiles but does nothing — all instruction handlers return `Ok(())`.

- [ ] **Step 1: Replace Cargo.toml**

```toml
[package]
name = "strategy-token"
version = "0.1.0"
description = "Yields.so Strategy Token Program — pinocchio + Beethoven"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "strategy_token"

[features]
no-entrypoint = []
default = []

[dependencies]
pinocchio = { version = "0.10", default-features = false }
beethoven = { git = "https://github.com/blueshift-gg/beethoven", features = ["kamino-deposit"] }
```

- [ ] **Step 2: Replace lib.rs with pinocchio entrypoint**

```rust
#![no_std]

mod error;
mod instructions;
mod state;
mod cpi;
mod util;

use pinocchio::{
    program_error::ProgramError, AccountView, ProgramResult,
    pubkey::Pubkey,
};

pinocchio::no_allocator!();
pinocchio::nostd_panic_handler!();
pinocchio::program_entrypoint!(process_instruction);

/// Strategy Token Program ID
pub const ID: Pubkey = pinocchio::pubkey!("Y13kaQZ6NJgyfLiL5VjZ9k5QaFJnw4REM4A5Gsfg9VV");

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    let (disc, rest) = data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;
    match disc {
        0 => instructions::create_strategy::process(program_id, accounts, rest),
        1 => instructions::buy_shares::process(program_id, accounts, rest),
        2 => instructions::redeem_shares::process(program_id, accounts, rest),
        3 => instructions::update_nav::process(program_id, accounts, rest),
        4 => instructions::rebalance::process(program_id, accounts, rest),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
```

- [ ] **Step 3: Replace error.rs**

```rust
use pinocchio::program_error::ProgramError;

pub const ERROR_STRATEGY_NOT_ACTIVE: u32    = 0x1770_0000;
pub const ERROR_DEPOSIT_BELOW_MIN: u32      = 0x1770_0001;
pub const ERROR_INSUFFICIENT_SHARES: u32    = 0x1770_0002;
pub const ERROR_NAV_OVERFLOW: u32           = 0x1770_0003;
pub const ERROR_INVALID_ALLOCATIONS: u32    = 0x1770_0004;
pub const ERROR_SNAPSHOT_TOO_SOON: u32      = 0x1770_0005;
pub const ERROR_ZERO_SHARES: u32            = 0x1770_0006;
pub const ERROR_ZERO_AMOUNT: u32            = 0x1770_0007;
pub const ERROR_INVALID_AUTHORITY: u32      = 0x1770_0008;
pub const ERROR_INVALID_MINT: u32           = 0x1770_0009;
pub const ERROR_INVALID_STRATEGY_TYPE: u32  = 0x1770_000A;
pub const ERROR_INVALID_DISCRIMINATOR: u32  = 0x1770_000B;
pub const ERROR_INVALID_PDA: u32            = 0x1770_000C;
pub const ERROR_INVALID_PROTOCOL: u32       = 0x1770_000D;
pub const ERROR_ACCOUNT_NOT_WRITABLE: u32   = 0x1770_000E;
pub const ERROR_ACCOUNT_NOT_SIGNER: u32     = 0x1770_000F;

#[inline(always)]
pub fn err(code: u32) -> ProgramError {
    ProgramError::Custom(code)
}
```

- [ ] **Step 4: Replace state/mod.rs, strategy.rs, nav_oracle.rs with stubs**

`state/mod.rs`:
```rust
pub mod strategy;
pub mod nav_oracle;

pub use strategy::*;
pub use nav_oracle::*;
```

`state/strategy.rs`:
```rust
use pinocchio::pubkey::Pubkey;

pub const STRATEGY_TYPE_YIELD: u8 = 0;
pub const STRATEGY_TYPE_AGENT: u8 = 1;

pub const STATUS_ACTIVE: u8 = 0;
pub const STATUS_PAUSED: u8 = 1;
pub const STATUS_CLOSED: u8 = 2;

pub const STRATEGY_DISCRIMINATOR: [u8; 8] = [0xd0, 0x82, 0x35, 0xce, 0x9a, 0x7f, 0x5b, 0x11];
pub const STRATEGY_LEN: usize = 330;

/// Fixed-offset layout for Strategy account data.
/// All reads/writes go through offset constants + helper methods.
pub struct Strategy;

// Byte offsets (after 8-byte discriminator)
impl Strategy {
    pub const OFF_DISCRIMINATOR: usize = 0;
    pub const OFF_AUTHORITY: usize = 8;
    pub const OFF_MINT: usize = 40;
    pub const OFF_WALLET: usize = 72;
    pub const OFF_DEPOSIT_MINT: usize = 104;
    pub const OFF_PROTOCOL: usize = 136;
    pub const OFF_RESERVE: usize = 168;
    pub const OFF_NAME: usize = 200;
    pub const OFF_STRATEGY_TYPE: usize = 232;
    pub const OFF_STATUS: usize = 233;
    pub const OFF_FEE_BPS: usize = 234;
    pub const OFF_TOTAL_DEPOSITS: usize = 236;
    pub const OFF_CURRENT_NAV: usize = 244;
    pub const OFF_TOTAL_SHARES: usize = 252;
    pub const OFF_TOTAL_INVESTORS: usize = 260;
    pub const OFF_HIGH_WATER_MARK: usize = 264;
    pub const OFF_MIN_DEPOSIT: usize = 272;
    pub const OFF_LAST_NAV_SLOT: usize = 280;
    pub const OFF_NAV_TWAP_ACCUMULATOR: usize = 288;
    pub const OFF_TWAP_LAST_SLOT: usize = 304;
    pub const OFF_CREATED_AT: usize = 312;
    pub const OFF_BUMP: usize = 320;
    pub const OFF_WALLET_BUMP: usize = 321;
}

/// Read helpers — operate on raw account data slices
impl Strategy {
    #[inline(always)]
    pub fn check_discriminator(data: &[u8]) -> bool {
        data.len() >= STRATEGY_LEN && data[..8] == STRATEGY_DISCRIMINATOR
    }

    #[inline(always)]
    pub fn authority(data: &[u8]) -> &[u8; 32] {
        data[Self::OFF_AUTHORITY..Self::OFF_AUTHORITY + 32]
            .try_into()
            .unwrap()
    }

    #[inline(always)]
    pub fn mint(data: &[u8]) -> &[u8; 32] {
        data[Self::OFF_MINT..Self::OFF_MINT + 32]
            .try_into()
            .unwrap()
    }

    #[inline(always)]
    pub fn wallet(data: &[u8]) -> &[u8; 32] {
        data[Self::OFF_WALLET..Self::OFF_WALLET + 32]
            .try_into()
            .unwrap()
    }

    #[inline(always)]
    pub fn deposit_mint(data: &[u8]) -> &[u8; 32] {
        data[Self::OFF_DEPOSIT_MINT..Self::OFF_DEPOSIT_MINT + 32]
            .try_into()
            .unwrap()
    }

    #[inline(always)]
    pub fn protocol(data: &[u8]) -> &[u8; 32] {
        data[Self::OFF_PROTOCOL..Self::OFF_PROTOCOL + 32]
            .try_into()
            .unwrap()
    }

    #[inline(always)]
    pub fn reserve(data: &[u8]) -> &[u8; 32] {
        data[Self::OFF_RESERVE..Self::OFF_RESERVE + 32]
            .try_into()
            .unwrap()
    }

    #[inline(always)]
    pub fn name(data: &[u8]) -> &[u8; 32] {
        data[Self::OFF_NAME..Self::OFF_NAME + 32]
            .try_into()
            .unwrap()
    }

    #[inline(always)]
    pub fn strategy_type(data: &[u8]) -> u8 {
        data[Self::OFF_STRATEGY_TYPE]
    }

    #[inline(always)]
    pub fn status(data: &[u8]) -> u8 {
        data[Self::OFF_STATUS]
    }

    #[inline(always)]
    pub fn fee_bps(data: &[u8]) -> u16 {
        u16::from_le_bytes(data[Self::OFF_FEE_BPS..Self::OFF_FEE_BPS + 2].try_into().unwrap())
    }

    #[inline(always)]
    pub fn total_deposits(data: &[u8]) -> u64 {
        u64::from_le_bytes(data[Self::OFF_TOTAL_DEPOSITS..Self::OFF_TOTAL_DEPOSITS + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn current_nav(data: &[u8]) -> u64 {
        u64::from_le_bytes(data[Self::OFF_CURRENT_NAV..Self::OFF_CURRENT_NAV + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn total_shares(data: &[u8]) -> u64 {
        u64::from_le_bytes(data[Self::OFF_TOTAL_SHARES..Self::OFF_TOTAL_SHARES + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn total_investors(data: &[u8]) -> u32 {
        u32::from_le_bytes(data[Self::OFF_TOTAL_INVESTORS..Self::OFF_TOTAL_INVESTORS + 4].try_into().unwrap())
    }

    #[inline(always)]
    pub fn high_water_mark(data: &[u8]) -> u64 {
        u64::from_le_bytes(data[Self::OFF_HIGH_WATER_MARK..Self::OFF_HIGH_WATER_MARK + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn min_deposit(data: &[u8]) -> u64 {
        u64::from_le_bytes(data[Self::OFF_MIN_DEPOSIT..Self::OFF_MIN_DEPOSIT + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn last_nav_slot(data: &[u8]) -> u64 {
        u64::from_le_bytes(data[Self::OFF_LAST_NAV_SLOT..Self::OFF_LAST_NAV_SLOT + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn nav_twap_accumulator(data: &[u8]) -> u128 {
        u128::from_le_bytes(data[Self::OFF_NAV_TWAP_ACCUMULATOR..Self::OFF_NAV_TWAP_ACCUMULATOR + 16].try_into().unwrap())
    }

    #[inline(always)]
    pub fn twap_last_slot(data: &[u8]) -> u64 {
        u64::from_le_bytes(data[Self::OFF_TWAP_LAST_SLOT..Self::OFF_TWAP_LAST_SLOT + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn created_at(data: &[u8]) -> i64 {
        i64::from_le_bytes(data[Self::OFF_CREATED_AT..Self::OFF_CREATED_AT + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn bump(data: &[u8]) -> u8 {
        data[Self::OFF_BUMP]
    }

    #[inline(always)]
    pub fn wallet_bump(data: &[u8]) -> u8 {
        data[Self::OFF_WALLET_BUMP]
    }
}

/// Write helpers — operate on mutable account data slices
impl Strategy {
    #[inline(always)]
    pub fn set_discriminator(data: &mut [u8]) {
        data[..8].copy_from_slice(&STRATEGY_DISCRIMINATOR);
    }

    #[inline(always)]
    pub fn set_authority(data: &mut [u8], v: &[u8; 32]) {
        data[Self::OFF_AUTHORITY..Self::OFF_AUTHORITY + 32].copy_from_slice(v);
    }

    #[inline(always)]
    pub fn set_mint(data: &mut [u8], v: &[u8; 32]) {
        data[Self::OFF_MINT..Self::OFF_MINT + 32].copy_from_slice(v);
    }

    #[inline(always)]
    pub fn set_wallet(data: &mut [u8], v: &[u8; 32]) {
        data[Self::OFF_WALLET..Self::OFF_WALLET + 32].copy_from_slice(v);
    }

    #[inline(always)]
    pub fn set_deposit_mint(data: &mut [u8], v: &[u8; 32]) {
        data[Self::OFF_DEPOSIT_MINT..Self::OFF_DEPOSIT_MINT + 32].copy_from_slice(v);
    }

    #[inline(always)]
    pub fn set_protocol(data: &mut [u8], v: &[u8; 32]) {
        data[Self::OFF_PROTOCOL..Self::OFF_PROTOCOL + 32].copy_from_slice(v);
    }

    #[inline(always)]
    pub fn set_reserve(data: &mut [u8], v: &[u8; 32]) {
        data[Self::OFF_RESERVE..Self::OFF_RESERVE + 32].copy_from_slice(v);
    }

    #[inline(always)]
    pub fn set_name(data: &mut [u8], v: &[u8; 32]) {
        data[Self::OFF_NAME..Self::OFF_NAME + 32].copy_from_slice(v);
    }

    #[inline(always)]
    pub fn set_strategy_type(data: &mut [u8], v: u8) {
        data[Self::OFF_STRATEGY_TYPE] = v;
    }

    #[inline(always)]
    pub fn set_status(data: &mut [u8], v: u8) {
        data[Self::OFF_STATUS] = v;
    }

    #[inline(always)]
    pub fn set_fee_bps(data: &mut [u8], v: u16) {
        data[Self::OFF_FEE_BPS..Self::OFF_FEE_BPS + 2].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn set_total_deposits(data: &mut [u8], v: u64) {
        data[Self::OFF_TOTAL_DEPOSITS..Self::OFF_TOTAL_DEPOSITS + 8].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn set_current_nav(data: &mut [u8], v: u64) {
        data[Self::OFF_CURRENT_NAV..Self::OFF_CURRENT_NAV + 8].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn set_total_shares(data: &mut [u8], v: u64) {
        data[Self::OFF_TOTAL_SHARES..Self::OFF_TOTAL_SHARES + 8].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn set_total_investors(data: &mut [u8], v: u32) {
        data[Self::OFF_TOTAL_INVESTORS..Self::OFF_TOTAL_INVESTORS + 4].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn set_high_water_mark(data: &mut [u8], v: u64) {
        data[Self::OFF_HIGH_WATER_MARK..Self::OFF_HIGH_WATER_MARK + 8].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn set_min_deposit(data: &mut [u8], v: u64) {
        data[Self::OFF_MIN_DEPOSIT..Self::OFF_MIN_DEPOSIT + 8].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn set_last_nav_slot(data: &mut [u8], v: u64) {
        data[Self::OFF_LAST_NAV_SLOT..Self::OFF_LAST_NAV_SLOT + 8].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn set_nav_twap_accumulator(data: &mut [u8], v: u128) {
        data[Self::OFF_NAV_TWAP_ACCUMULATOR..Self::OFF_NAV_TWAP_ACCUMULATOR + 16].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn set_twap_last_slot(data: &mut [u8], v: u64) {
        data[Self::OFF_TWAP_LAST_SLOT..Self::OFF_TWAP_LAST_SLOT + 8].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn set_created_at(data: &mut [u8], v: i64) {
        data[Self::OFF_CREATED_AT..Self::OFF_CREATED_AT + 8].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn set_bump(data: &mut [u8], v: u8) {
        data[Self::OFF_BUMP] = v;
    }

    #[inline(always)]
    pub fn set_wallet_bump(data: &mut [u8], v: u8) {
        data[Self::OFF_WALLET_BUMP] = v;
    }
}
```

`state/nav_oracle.rs`:
```rust
pub const NAV_ORACLE_DISCRIMINATOR: [u8; 8] = [0xa1, 0x4e, 0x73, 0x20, 0xbc, 0x44, 0x61, 0x05];
pub const NAV_ORACLE_LEN: usize = 89;

pub const DEFAULT_MIN_SNAPSHOT_INTERVAL: u64 = 300;
pub const DEFAULT_TWAP_WINDOW: u64 = 9000;

pub struct NavOracle;

impl NavOracle {
    pub const OFF_DISCRIMINATOR: usize = 0;
    pub const OFF_STRATEGY: usize = 8;
    pub const OFF_NAV_PER_SHARE: usize = 40;
    pub const OFF_TWAP_VALUE: usize = 48;
    pub const OFF_SNAPSHOT_COUNT: usize = 56;
    pub const OFF_LAST_SNAPSHOT_SLOT: usize = 64;
    pub const OFF_MIN_SNAPSHOT_INTERVAL: usize = 72;
    pub const OFF_TWAP_WINDOW: usize = 80;
    pub const OFF_BUMP: usize = 88;
}

impl NavOracle {
    #[inline(always)]
    pub fn check_discriminator(data: &[u8]) -> bool {
        data.len() >= NAV_ORACLE_LEN && data[..8] == NAV_ORACLE_DISCRIMINATOR
    }

    #[inline(always)]
    pub fn strategy(data: &[u8]) -> &[u8; 32] {
        data[Self::OFF_STRATEGY..Self::OFF_STRATEGY + 32].try_into().unwrap()
    }

    #[inline(always)]
    pub fn nav_per_share(data: &[u8]) -> u64 {
        u64::from_le_bytes(data[Self::OFF_NAV_PER_SHARE..Self::OFF_NAV_PER_SHARE + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn twap_value(data: &[u8]) -> u64 {
        u64::from_le_bytes(data[Self::OFF_TWAP_VALUE..Self::OFF_TWAP_VALUE + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn snapshot_count(data: &[u8]) -> u64 {
        u64::from_le_bytes(data[Self::OFF_SNAPSHOT_COUNT..Self::OFF_SNAPSHOT_COUNT + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn last_snapshot_slot(data: &[u8]) -> u64 {
        u64::from_le_bytes(data[Self::OFF_LAST_SNAPSHOT_SLOT..Self::OFF_LAST_SNAPSHOT_SLOT + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn min_snapshot_interval(data: &[u8]) -> u64 {
        u64::from_le_bytes(data[Self::OFF_MIN_SNAPSHOT_INTERVAL..Self::OFF_MIN_SNAPSHOT_INTERVAL + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn twap_window(data: &[u8]) -> u64 {
        u64::from_le_bytes(data[Self::OFF_TWAP_WINDOW..Self::OFF_TWAP_WINDOW + 8].try_into().unwrap())
    }

    #[inline(always)]
    pub fn bump(data: &[u8]) -> u8 {
        data[Self::OFF_BUMP]
    }

    // Write helpers
    #[inline(always)]
    pub fn set_discriminator(data: &mut [u8]) {
        data[..8].copy_from_slice(&NAV_ORACLE_DISCRIMINATOR);
    }

    #[inline(always)]
    pub fn set_strategy(data: &mut [u8], v: &[u8; 32]) {
        data[Self::OFF_STRATEGY..Self::OFF_STRATEGY + 32].copy_from_slice(v);
    }

    #[inline(always)]
    pub fn set_nav_per_share(data: &mut [u8], v: u64) {
        data[Self::OFF_NAV_PER_SHARE..Self::OFF_NAV_PER_SHARE + 8].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn set_twap_value(data: &mut [u8], v: u64) {
        data[Self::OFF_TWAP_VALUE..Self::OFF_TWAP_VALUE + 8].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn set_snapshot_count(data: &mut [u8], v: u64) {
        data[Self::OFF_SNAPSHOT_COUNT..Self::OFF_SNAPSHOT_COUNT + 8].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn set_last_snapshot_slot(data: &mut [u8], v: u64) {
        data[Self::OFF_LAST_SNAPSHOT_SLOT..Self::OFF_LAST_SNAPSHOT_SLOT + 8].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn set_min_snapshot_interval(data: &mut [u8], v: u64) {
        data[Self::OFF_MIN_SNAPSHOT_INTERVAL..Self::OFF_MIN_SNAPSHOT_INTERVAL + 8].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn set_twap_window(data: &mut [u8], v: u64) {
        data[Self::OFF_TWAP_WINDOW..Self::OFF_TWAP_WINDOW + 8].copy_from_slice(&v.to_le_bytes());
    }

    #[inline(always)]
    pub fn set_bump(data: &mut [u8], v: u8) {
        data[Self::OFF_BUMP] = v;
    }
}
```

- [ ] **Step 5: Create util.rs with assertion helpers**

```rust
use pinocchio::{program_error::ProgramError, AccountView};
use crate::error;

#[inline(always)]
pub fn assert_signer(account: &AccountView) -> Result<(), ProgramError> {
    if !account.is_signer() {
        return Err(error::err(error::ERROR_ACCOUNT_NOT_SIGNER));
    }
    Ok(())
}

#[inline(always)]
pub fn assert_writable(account: &AccountView) -> Result<(), ProgramError> {
    if !account.is_writable() {
        return Err(error::err(error::ERROR_ACCOUNT_NOT_WRITABLE));
    }
    Ok(())
}

#[inline(always)]
pub fn assert_owned_by(account: &AccountView, owner: &[u8; 32]) -> Result<(), ProgramError> {
    if account.owner() != owner {
        return Err(ProgramError::IllegalOwner);
    }
    Ok(())
}

#[inline(always)]
pub fn assert_keys_equal(a: &[u8; 32], b: &[u8; 32]) -> Result<(), ProgramError> {
    if a != b {
        return Err(ProgramError::InvalidArgument);
    }
    Ok(())
}
```

- [ ] **Step 6: Create cpi/mod.rs stub**

```rust
pub mod spl_token;
pub mod system;
pub mod associated_token;
pub mod kamino_withdraw;
```

Create empty stub files for each CPI module:

`cpi/spl_token.rs`:
```rust
// SPL Token CPI helpers — implemented in Task 2
```

`cpi/system.rs`:
```rust
// System Program CPI helpers — implemented in Task 2
```

`cpi/associated_token.rs`:
```rust
// Associated Token CPI helpers — implemented in Task 2
```

`cpi/kamino_withdraw.rs`:
```rust
// Kamino Withdraw CPI — implemented in Task 6
```

- [ ] **Step 7: Replace instruction stubs**

`instructions/mod.rs`:
```rust
pub mod create_strategy;
pub mod buy_shares;
pub mod redeem_shares;
pub mod update_nav;
pub mod rebalance;
```

`instructions/create_strategy.rs`:
```rust
use pinocchio::{AccountView, ProgramResult, pubkey::Pubkey};

pub fn process(
    _program_id: &Pubkey,
    _accounts: &[AccountView],
    _data: &[u8],
) -> ProgramResult {
    // Implemented in Task 3
    Ok(())
}
```

`instructions/buy_shares.rs`:
```rust
use pinocchio::{AccountView, ProgramResult, pubkey::Pubkey};

pub fn process(
    _program_id: &Pubkey,
    _accounts: &[AccountView],
    _data: &[u8],
) -> ProgramResult {
    // Implemented in Task 4
    Ok(())
}
```

`instructions/redeem_shares.rs`:
```rust
use pinocchio::{AccountView, ProgramResult, pubkey::Pubkey};

pub fn process(
    _program_id: &Pubkey,
    _accounts: &[AccountView],
    _data: &[u8],
) -> ProgramResult {
    // Implemented in Task 5
    Ok(())
}
```

`instructions/update_nav.rs`:
```rust
use pinocchio::{AccountView, ProgramResult, pubkey::Pubkey};

pub fn process(
    _program_id: &Pubkey,
    _accounts: &[AccountView],
    _data: &[u8],
) -> ProgramResult {
    // Implemented in Task 7
    Ok(())
}
```

`instructions/rebalance.rs`:
```rust
use pinocchio::{AccountView, ProgramResult, pubkey::Pubkey};

pub fn process(
    _program_id: &Pubkey,
    _accounts: &[AccountView],
    _data: &[u8],
) -> ProgramResult {
    // Implemented in Task 8
    Ok(())
}
```

- [ ] **Step 8: Verify compilation**

Run: `cd /mnt/storage/yields-v2/packages/programs && cargo check --lib -p strategy-token`
Expected: Compiles with possibly some unused warnings, zero errors.

- [ ] **Step 9: Commit**

```bash
git add programs/strategy-token/
git commit -m "refactor: replace Anchor strategy-token with pinocchio skeleton

Replaces the Anchor framework with pinocchio for direct Beethoven
integration. All instruction handlers are stubs returning Ok(()).
State structs use manual fixed-offset serialization."
```

---

## Task 2: CPI Helper Module

**Files:**
- Replace: `programs/strategy-token/src/cpi/spl_token.rs`
- Replace: `programs/strategy-token/src/cpi/system.rs`
- Replace: `programs/strategy-token/src/cpi/associated_token.rs`

These helpers are used by every instruction. They must compile before any instruction implementation.

- [ ] **Step 1: Implement system.rs**

```rust
use pinocchio::{
    program_error::ProgramError, AccountView, ProgramResult,
    pubkey::Pubkey,
    instruction::{AccountMeta, Instruction},
    sysvars::Sysvar,
    cpi,
};

/// System Program ID
pub const SYSTEM_PROGRAM_ID: Pubkey = pinocchio::pubkey!("11111111111111111111111111111111");

/// CreateAccount instruction (index 0)
pub fn create_account<'a>(
    payer: &'a AccountView,
    new_account: &'a AccountView,
    lamports: u64,
    space: u64,
    owner: &Pubkey,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    let mut data = [0u8; 52]; // 4 (index) + 8 (lamports) + 8 (space) + 32 (owner)
    data[0..4].copy_from_slice(&0u32.to_le_bytes()); // CreateAccount = 0
    data[4..12].copy_from_slice(&lamports.to_le_bytes());
    data[12..20].copy_from_slice(&space.to_le_bytes());
    data[20..52].copy_from_slice(owner);

    let accounts = [
        AccountMeta::writable_signer(payer.key()),
        AccountMeta::writable_signer(new_account.key()),
    ];

    let ix = Instruction {
        program_id: &SYSTEM_PROGRAM_ID,
        accounts: &accounts,
        data: &data,
    };

    cpi::invoke_signed(&ix, &[payer, new_account], &[signer_seeds])
}

/// Transfer instruction (index 2)
pub fn transfer<'a>(
    from: &'a AccountView,
    to: &'a AccountView,
    lamports: u64,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    let mut data = [0u8; 12]; // 4 (index) + 8 (lamports)
    data[0..4].copy_from_slice(&2u32.to_le_bytes()); // Transfer = 2
    data[4..12].copy_from_slice(&lamports.to_le_bytes());

    let accounts = [
        AccountMeta::writable_signer(from.key()),
        AccountMeta::writable(to.key()),
    ];

    let ix = Instruction {
        program_id: &SYSTEM_PROGRAM_ID,
        accounts: &accounts,
        data: &data,
    };

    cpi::invoke_signed(&ix, &[from, to], &[signer_seeds])
}
```

- [ ] **Step 2: Implement spl_token.rs**

```rust
use pinocchio::{
    AccountView, ProgramResult,
    pubkey::Pubkey,
    instruction::{AccountMeta, Instruction},
    cpi,
};

/// SPL Token Program ID
pub const TOKEN_PROGRAM_ID: Pubkey = pinocchio::pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/// InitializeMint2 (index 20) — no rent sysvar needed
pub fn init_mint2<'a>(
    mint: &'a AccountView,
    authority: &Pubkey,
    decimals: u8,
) -> ProgramResult {
    let mut data = [0u8; 67]; // 1 (ix) + 1 (decimals) + 32 (authority) + 1 (has_freeze) + 32 (freeze_authority)
    data[0] = 20; // InitializeMint2
    data[1] = decimals;
    data[2..34].copy_from_slice(authority);
    data[34] = 0; // no freeze authority

    let accounts = [AccountMeta::writable(mint.key())];

    let ix = Instruction {
        program_id: &TOKEN_PROGRAM_ID,
        accounts: &accounts,
        data: &data,
    };

    cpi::invoke(&ix, &[mint])
}

/// MintTo (index 7)
pub fn mint_to<'a>(
    mint: &'a AccountView,
    destination: &'a AccountView,
    authority: &'a AccountView,
    amount: u64,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    let mut data = [0u8; 9]; // 1 (ix) + 8 (amount)
    data[0] = 7; // MintTo
    data[1..9].copy_from_slice(&amount.to_le_bytes());

    let accounts = [
        AccountMeta::writable(mint.key()),
        AccountMeta::writable(destination.key()),
        AccountMeta::readonly_signer(authority.key()),
    ];

    let ix = Instruction {
        program_id: &TOKEN_PROGRAM_ID,
        accounts: &accounts,
        data: &data,
    };

    cpi::invoke_signed(&ix, &[mint, destination, authority], &[signer_seeds])
}

/// Burn (index 8)
pub fn burn<'a>(
    account: &'a AccountView,
    mint: &'a AccountView,
    authority: &'a AccountView,
    amount: u64,
) -> ProgramResult {
    let mut data = [0u8; 9]; // 1 (ix) + 8 (amount)
    data[0] = 8; // Burn
    data[1..9].copy_from_slice(&amount.to_le_bytes());

    let accounts = [
        AccountMeta::writable(account.key()),
        AccountMeta::writable(mint.key()),
        AccountMeta::readonly_signer(authority.key()),
    ];

    let ix = Instruction {
        program_id: &TOKEN_PROGRAM_ID,
        accounts: &accounts,
        data: &data,
    };

    cpi::invoke(&ix, &[account, mint, authority])
}

/// Transfer (index 3)
pub fn transfer<'a>(
    source: &'a AccountView,
    destination: &'a AccountView,
    authority: &'a AccountView,
    amount: u64,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    let mut data = [0u8; 9]; // 1 (ix) + 8 (amount)
    data[0] = 3; // Transfer
    data[1..9].copy_from_slice(&amount.to_le_bytes());

    let accounts = [
        AccountMeta::writable(source.key()),
        AccountMeta::writable(destination.key()),
        AccountMeta::readonly_signer(authority.key()),
    ];

    let ix = Instruction {
        program_id: &TOKEN_PROGRAM_ID,
        accounts: &accounts,
        data: &data,
    };

    cpi::invoke_signed(&ix, &[source, destination, authority], &[signer_seeds])
}

/// Read the amount field from a token account's data (offset 64, 8 bytes LE)
#[inline(always)]
pub fn read_token_amount(data: &[u8]) -> u64 {
    u64::from_le_bytes(data[64..72].try_into().unwrap())
}
```

- [ ] **Step 3: Implement associated_token.rs**

```rust
use pinocchio::{
    AccountView, ProgramResult,
    pubkey::Pubkey,
    instruction::{AccountMeta, Instruction},
    cpi,
};

use crate::cpi::spl_token::TOKEN_PROGRAM_ID;

/// Associated Token Program ID
pub const ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey =
    pinocchio::pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/// CreateIdempotent (index 1) — creates ATA if it doesn't exist, no-ops if it does
pub fn create_idempotent<'a>(
    payer: &'a AccountView,
    ata: &'a AccountView,
    wallet: &'a AccountView,
    mint: &'a AccountView,
    system_program: &'a AccountView,
    token_program: &'a AccountView,
) -> ProgramResult {
    let data = [1u8]; // CreateIdempotent

    let accounts = [
        AccountMeta::writable_signer(payer.key()),
        AccountMeta::writable(ata.key()),
        AccountMeta::readonly(wallet.key()),
        AccountMeta::readonly(mint.key()),
        AccountMeta::readonly(system_program.key()),
        AccountMeta::readonly(token_program.key()),
    ];

    let ix = Instruction {
        program_id: &ASSOCIATED_TOKEN_PROGRAM_ID,
        accounts: &accounts,
        data: &data,
    };

    cpi::invoke(&ix, &[payer, ata, wallet, mint, system_program, token_program])
}
```

- [ ] **Step 4: Verify compilation**

Run: `cd /mnt/storage/yields-v2/packages/programs && cargo check --lib -p strategy-token`
Expected: Compiles clean. The CPI modules may have unused warnings — that's fine.

- [ ] **Step 5: Commit**

```bash
git add programs/strategy-token/src/cpi/
git commit -m "feat: add CPI helpers for SPL Token, System, and Associated Token

Zero-alloc stack-allocated instruction data. Matches Beethoven's
CPI patterns. Helpers: create_account, transfer, init_mint2,
mint_to, burn, spl_transfer, create_idempotent."
```

---

## Task 3: create_strategy Instruction

**Files:**
- Replace: `programs/strategy-token/src/instructions/create_strategy.rs`

- [ ] **Step 1: Implement create_strategy**

```rust
use pinocchio::{
    program_error::ProgramError, AccountView, ProgramResult,
    pubkey::Pubkey,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
};

use crate::{
    cpi,
    error::{self, err},
    state::{
        strategy::{Strategy, STRATEGY_DISCRIMINATOR, STRATEGY_LEN, STRATEGY_TYPE_YIELD, STRATEGY_TYPE_AGENT, STATUS_ACTIVE},
        nav_oracle::{NavOracle, NAV_ORACLE_DISCRIMINATOR, NAV_ORACLE_LEN, DEFAULT_MIN_SNAPSHOT_INTERVAL, DEFAULT_TWAP_WINDOW},
    },
    util,
    ID,
};

/// Instruction data layout:
/// [0]      strategy_type  u8
/// [1..3]   fee_bps        u16 LE
/// [3..11]  min_deposit    u64 LE
/// [11..43] name           [u8; 32]
const IX_DATA_LEN: usize = 43;

pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    if data.len() < IX_DATA_LEN {
        return Err(ProgramError::InvalidInstructionData);
    }

    // Parse instruction data
    let strategy_type = data[0];
    if strategy_type != STRATEGY_TYPE_YIELD && strategy_type != STRATEGY_TYPE_AGENT {
        return Err(err(error::ERROR_INVALID_STRATEGY_TYPE));
    }
    let fee_bps = u16::from_le_bytes(data[1..3].try_into().unwrap());
    if fee_bps > 10_000 {
        return Err(err(error::ERROR_INVALID_ALLOCATIONS)); // reuse: fee too high
    }
    let min_deposit = u64::from_le_bytes(data[3..11].try_into().unwrap());
    let name: [u8; 32] = data[11..43].try_into().unwrap();

    // Parse accounts
    let [creator, strategy_acc, mint_acc, wallet_acc, nav_oracle_acc,
         deposit_mint, protocol, reserve, token_program, system_program, rent_acc, ..] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    util::assert_signer(creator)?;
    util::assert_writable(creator)?;
    util::assert_writable(strategy_acc)?;
    util::assert_writable(mint_acc)?;
    util::assert_writable(nav_oracle_acc)?;

    let clock = Clock::get()?;

    // Derive Strategy PDA
    let (strategy_pda, strategy_bump) = Pubkey::find_program_address(
        &[b"strategy", creator.key(), &name],
        program_id,
    );
    util::assert_keys_equal(strategy_acc.key(), &strategy_pda)?;

    // Derive Wallet PDA
    let (wallet_pda, wallet_bump) = Pubkey::find_program_address(
        &[b"wallet", strategy_acc.key()],
        program_id,
    );
    util::assert_keys_equal(wallet_acc.key(), &wallet_pda)?;

    // Derive NavOracle PDA
    let (nav_oracle_pda, nav_oracle_bump) = Pubkey::find_program_address(
        &[b"nav", strategy_acc.key()],
        program_id,
    );
    util::assert_keys_equal(nav_oracle_acc.key(), &nav_oracle_pda)?;

    // Create Strategy account
    let rent = Rent::get()?;
    let strategy_lamports = rent.minimum_balance(STRATEGY_LEN);
    let strategy_seeds: &[&[u8]] = &[b"strategy", creator.key(), &name, &[strategy_bump]];
    cpi::system::create_account(
        creator,
        strategy_acc,
        strategy_lamports,
        STRATEGY_LEN as u64,
        program_id,
        strategy_seeds,
    )?;

    // Create Mint account (rent for 82-byte Mint)
    let mint_lamports = rent.minimum_balance(82);
    // Mint needs its own keypair — client generates it and signs the tx
    // We just need to create the account and init it
    cpi::system::create_account(
        creator,
        mint_acc,
        mint_lamports,
        82,
        &cpi::spl_token::TOKEN_PROGRAM_ID,
        &[], // mint is a regular keypair signer, not a PDA
    )?;

    // Initialize mint (9 decimals, strategy PDA as authority)
    cpi::spl_token::init_mint2(mint_acc, &strategy_pda, 9)?;

    // Create NavOracle account
    let oracle_lamports = rent.minimum_balance(NAV_ORACLE_LEN);
    let oracle_seeds: &[&[u8]] = &[b"nav", strategy_acc.key(), &[nav_oracle_bump]];
    cpi::system::create_account(
        creator,
        nav_oracle_acc,
        oracle_lamports,
        NAV_ORACLE_LEN as u64,
        program_id,
        oracle_seeds,
    )?;

    // Write Strategy state
    let strategy_data = &mut strategy_acc.try_borrow_mut_data()?;
    Strategy::set_discriminator(strategy_data);
    Strategy::set_authority(strategy_data, creator.key());
    Strategy::set_mint(strategy_data, mint_acc.key());
    Strategy::set_wallet(strategy_data, &wallet_pda);
    Strategy::set_deposit_mint(strategy_data, deposit_mint.key());
    Strategy::set_protocol(strategy_data, protocol.key());
    Strategy::set_reserve(strategy_data, reserve.key());
    Strategy::set_name(strategy_data, &name);
    Strategy::set_strategy_type(strategy_data, strategy_type);
    Strategy::set_status(strategy_data, STATUS_ACTIVE);
    Strategy::set_fee_bps(strategy_data, fee_bps);
    Strategy::set_total_deposits(strategy_data, 0);
    Strategy::set_current_nav(strategy_data, 0);
    Strategy::set_total_shares(strategy_data, 0);
    Strategy::set_total_investors(strategy_data, 0);
    Strategy::set_high_water_mark(strategy_data, 0);
    Strategy::set_min_deposit(strategy_data, min_deposit);
    Strategy::set_last_nav_slot(strategy_data, clock.slot);
    Strategy::set_nav_twap_accumulator(strategy_data, 0);
    Strategy::set_twap_last_slot(strategy_data, clock.slot);
    Strategy::set_created_at(strategy_data, clock.unix_timestamp);
    Strategy::set_bump(strategy_data, strategy_bump);
    Strategy::set_wallet_bump(strategy_data, wallet_bump);

    // Write NavOracle state
    let oracle_data = &mut nav_oracle_acc.try_borrow_mut_data()?;
    NavOracle::set_discriminator(oracle_data);
    NavOracle::set_strategy(oracle_data, strategy_acc.key());
    NavOracle::set_nav_per_share(oracle_data, 0);
    NavOracle::set_twap_value(oracle_data, 0);
    NavOracle::set_snapshot_count(oracle_data, 0);
    NavOracle::set_last_snapshot_slot(oracle_data, clock.slot);
    NavOracle::set_min_snapshot_interval(oracle_data, DEFAULT_MIN_SNAPSHOT_INTERVAL);
    NavOracle::set_twap_window(oracle_data, DEFAULT_TWAP_WINDOW);
    NavOracle::set_bump(oracle_data, nav_oracle_bump);

    Ok(())
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /mnt/storage/yields-v2/packages/programs && cargo check --lib -p strategy-token`
Expected: Compiles. May need to adjust imports based on exact pinocchio API.

- [ ] **Step 3: Commit**

```bash
git add programs/strategy-token/src/instructions/create_strategy.rs
git commit -m "feat: implement create_strategy in pinocchio

Creates Strategy PDA, SPL Token mint (9 decimals), wallet PDA,
and NavOracle PDA. Supports Yield and Agent strategy types.
Fixed-offset state writes."
```

---

## Task 4: buy_shares Instruction

**Files:**
- Replace: `programs/strategy-token/src/instructions/buy_shares.rs`

- [ ] **Step 1: Implement buy_shares**

```rust
use pinocchio::{
    program_error::ProgramError, AccountView, ProgramResult,
    pubkey::Pubkey,
};

use beethoven::{try_from_deposit_context, Deposit, DepositContext};

use crate::{
    cpi,
    error::{self, err},
    state::strategy::{Strategy, STRATEGY_LEN, STRATEGY_TYPE_YIELD, STATUS_ACTIVE},
    util,
    ID,
};

pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    if data.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let amount = u64::from_le_bytes(data[0..8].try_into().unwrap());
    if amount == 0 {
        return Err(err(error::ERROR_ZERO_AMOUNT));
    }

    // Parse accounts
    let [buyer, strategy_acc, mint_acc, buyer_shares_ata, wallet_acc,
         wallet_token_ata, buyer_token_ata, token_program, system_program,
         ata_program, remaining @ ..] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    util::assert_signer(buyer)?;
    util::assert_writable(buyer)?;
    util::assert_writable(strategy_acc)?;
    util::assert_writable(mint_acc)?;
    util::assert_writable(buyer_shares_ata)?;
    util::assert_writable(wallet_token_ata)?;
    util::assert_writable(buyer_token_ata)?;
    util::assert_owned_by(strategy_acc, program_id)?;

    // Read strategy state
    let strategy_data = strategy_acc.try_borrow_data()?;
    if !Strategy::check_discriminator(&strategy_data) {
        return Err(err(error::ERROR_INVALID_DISCRIMINATOR));
    }
    if Strategy::status(&strategy_data) != STATUS_ACTIVE {
        return Err(err(error::ERROR_STRATEGY_NOT_ACTIVE));
    }
    if amount < Strategy::min_deposit(&strategy_data) {
        return Err(err(error::ERROR_DEPOSIT_BELOW_MIN));
    }

    // Validate mint matches strategy
    util::assert_keys_equal(mint_acc.key(), Strategy::mint(&strategy_data))?;

    let strategy_type = Strategy::strategy_type(&strategy_data);
    let total_shares = Strategy::total_shares(&strategy_data);
    let current_nav = Strategy::current_nav(&strategy_data);
    let authority = *Strategy::authority(&strategy_data);
    let name = *Strategy::name(&strategy_data);
    let bump = Strategy::bump(&strategy_data);
    let wallet_bump = Strategy::wallet_bump(&strategy_data);
    drop(strategy_data); // release borrow before mutation

    // Create buyer's share ATA if needed
    cpi::associated_token::create_idempotent(
        buyer, buyer_shares_ata, buyer, mint_acc, system_program, token_program,
    )?;

    // Transfer deposit tokens from buyer to wallet
    cpi::spl_token::transfer(
        buyer_token_ata, wallet_token_ata, buyer, amount, &[],
    )?;

    // Route to protocol (yield strategies only)
    if strategy_type == STRATEGY_TYPE_YIELD && !remaining.is_empty() {
        let wallet_seeds: &[&[u8]] = &[b"wallet", strategy_acc.key(), &[wallet_bump]];
        let deposit_ctx = try_from_deposit_context(remaining)?;
        let (deposit_data, _) = deposit_ctx.try_from_deposit_data(&[])?;
        DepositContext::deposit_signed(&deposit_ctx, amount, &deposit_data, &[wallet_seeds.into()])?;
    }

    // Calculate shares
    let shares_to_mint = if total_shares == 0 || current_nav == 0 {
        amount
    } else {
        let shares_128 = (amount as u128)
            .checked_mul(total_shares as u128)
            .ok_or(err(error::ERROR_NAV_OVERFLOW))?
            .checked_div(current_nav as u128)
            .ok_or(err(error::ERROR_NAV_OVERFLOW))?;
        shares_128 as u64
    };

    if shares_to_mint == 0 {
        return Err(err(error::ERROR_ZERO_SHARES));
    }

    // Mint shares to buyer (strategy PDA is mint authority)
    let strategy_seeds: &[&[u8]] = &[b"strategy", &authority, &name, &[bump]];
    cpi::spl_token::mint_to(
        mint_acc, buyer_shares_ata, strategy_acc, shares_to_mint, strategy_seeds,
    )?;

    // Update strategy state
    let mut strategy_data = strategy_acc.try_borrow_mut_data()?;
    let new_deposits = Strategy::total_deposits(&strategy_data)
        .checked_add(amount)
        .ok_or(err(error::ERROR_NAV_OVERFLOW))?;
    let new_nav = Strategy::current_nav(&strategy_data)
        .checked_add(amount)
        .ok_or(err(error::ERROR_NAV_OVERFLOW))?;
    let new_shares = Strategy::total_shares(&strategy_data)
        .checked_add(shares_to_mint)
        .ok_or(err(error::ERROR_NAV_OVERFLOW))?;

    Strategy::set_total_deposits(&mut strategy_data, new_deposits);
    Strategy::set_current_nav(&mut strategy_data, new_nav);
    Strategy::set_total_shares(&mut strategy_data, new_shares);

    if Strategy::high_water_mark(&strategy_data) == 0 {
        Strategy::set_high_water_mark(&mut strategy_data, new_nav);
    }

    Ok(())
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /mnt/storage/yields-v2/packages/programs && cargo check --lib -p strategy-token`
Expected: Compiles. The Beethoven imports may need adjustment based on exact crate re-exports.

- [ ] **Step 3: Commit**

```bash
git add programs/strategy-token/src/instructions/buy_shares.rs
git commit -m "feat: implement buy_shares with Beethoven deposit

Transfers deposit tokens to wallet, routes via Beethoven for yield
strategies, calculates NAV-proportional shares, mints to buyer.
First deposit gets 1:1 shares."
```

---

## Task 5: redeem_shares Instruction

**Files:**
- Replace: `programs/strategy-token/src/instructions/redeem_shares.rs`

- [ ] **Step 1: Implement redeem_shares**

```rust
use pinocchio::{
    program_error::ProgramError, AccountView, ProgramResult,
    pubkey::Pubkey,
};

use crate::{
    cpi,
    error::{self, err},
    state::strategy::{Strategy, STRATEGY_TYPE_YIELD, STATUS_ACTIVE},
    util,
};

const BPS_DENOMINATOR: u64 = 10_000;
const NAV_SCALE: u128 = 1_000_000_000; // 1e9

pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    if data.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let shares = u64::from_le_bytes(data[0..8].try_into().unwrap());
    if shares == 0 {
        return Err(err(error::ERROR_ZERO_AMOUNT));
    }

    // Parse accounts
    let [redeemer, strategy_acc, mint_acc, redeemer_shares_ata, wallet_acc,
         wallet_token_ata, redeemer_token_ata, fee_receiver_ata,
         token_program, system_program, remaining @ ..] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    util::assert_signer(redeemer)?;
    util::assert_writable(redeemer)?;
    util::assert_writable(strategy_acc)?;
    util::assert_writable(mint_acc)?;
    util::assert_writable(redeemer_shares_ata)?;
    util::assert_writable(wallet_token_ata)?;
    util::assert_writable(redeemer_token_ata)?;
    util::assert_writable(fee_receiver_ata)?;
    util::assert_owned_by(strategy_acc, program_id)?;

    // Read strategy state
    let strategy_data = strategy_acc.try_borrow_data()?;
    if !Strategy::check_discriminator(&strategy_data) {
        return Err(err(error::ERROR_INVALID_DISCRIMINATOR));
    }
    if Strategy::status(&strategy_data) != STATUS_ACTIVE {
        return Err(err(error::ERROR_STRATEGY_NOT_ACTIVE));
    }

    util::assert_keys_equal(mint_acc.key(), Strategy::mint(&strategy_data))?;

    // Check redeemer has enough shares
    let redeemer_ata_data = redeemer_shares_ata.try_borrow_data()?;
    let redeemer_balance = cpi::spl_token::read_token_amount(&redeemer_ata_data);
    drop(redeemer_ata_data);
    if redeemer_balance < shares {
        return Err(err(error::ERROR_INSUFFICIENT_SHARES));
    }

    let total_shares = Strategy::total_shares(&strategy_data);
    let current_nav = Strategy::current_nav(&strategy_data);
    let high_water_mark = Strategy::high_water_mark(&strategy_data);
    let fee_bps = Strategy::fee_bps(&strategy_data) as u64;
    let strategy_type = Strategy::strategy_type(&strategy_data);
    let wallet_bump = Strategy::wallet_bump(&strategy_data);
    drop(strategy_data);

    // Calculate gross withdrawal
    let gross_withdrawal = (shares as u128)
        .checked_mul(current_nav as u128)
        .ok_or(err(error::ERROR_NAV_OVERFLOW))?
        .checked_div(total_shares as u128)
        .ok_or(err(error::ERROR_NAV_OVERFLOW))? as u64;

    // Performance fee (only on profit above HWM)
    let nav_per_share_now = (current_nav as u128)
        .checked_mul(NAV_SCALE)
        .ok_or(err(error::ERROR_NAV_OVERFLOW))?
        .checked_div(total_shares as u128)
        .ok_or(err(error::ERROR_NAV_OVERFLOW))? as u64;

    let hwm_per_share = if total_shares > 0 && high_water_mark > 0 {
        (high_water_mark as u128)
            .checked_mul(NAV_SCALE)
            .ok_or(err(error::ERROR_NAV_OVERFLOW))?
            .checked_div(total_shares as u128)
            .ok_or(err(error::ERROR_NAV_OVERFLOW))? as u64
    } else {
        0
    };

    let performance_fee = if nav_per_share_now > hwm_per_share && fee_bps > 0 {
        let profit_per_share = nav_per_share_now.saturating_sub(hwm_per_share);
        let total_profit = (profit_per_share as u128)
            .checked_mul(shares as u128)
            .ok_or(err(error::ERROR_NAV_OVERFLOW))?
            / (NAV_SCALE as u128);
        (total_profit as u64)
            .checked_mul(fee_bps)
            .ok_or(err(error::ERROR_NAV_OVERFLOW))?
            / BPS_DENOMINATOR
    } else {
        0
    };

    let net_withdrawal = gross_withdrawal.saturating_sub(performance_fee);

    // Burn shares
    cpi::spl_token::burn(redeemer_shares_ata, mint_acc, redeemer, shares)?;

    // Withdraw from protocol (yield strategies only)
    if strategy_type == STRATEGY_TYPE_YIELD && !remaining.is_empty() {
        let wallet_seeds: &[&[u8]] = &[b"wallet", strategy_acc.key(), &[wallet_bump]];
        cpi::kamino_withdraw::withdraw_signed(remaining, net_withdrawal + performance_fee, wallet_seeds)?;
    }

    // Transfer net withdrawal to redeemer
    let wallet_seeds: &[&[u8]] = &[b"wallet", strategy_acc.key(), &[wallet_bump]];
    cpi::spl_token::transfer(
        wallet_token_ata, redeemer_token_ata, wallet_acc, net_withdrawal, wallet_seeds,
    )?;

    // Transfer performance fee to authority
    if performance_fee > 0 {
        cpi::spl_token::transfer(
            wallet_token_ata, fee_receiver_ata, wallet_acc, performance_fee, wallet_seeds,
        )?;
    }

    // Update strategy state
    let mut strategy_data = strategy_acc.try_borrow_mut_data()?;
    Strategy::set_current_nav(&mut strategy_data, current_nav.saturating_sub(gross_withdrawal));
    Strategy::set_total_deposits(&mut strategy_data,
        Strategy::total_deposits(&strategy_data).saturating_sub(net_withdrawal));
    Strategy::set_total_shares(&mut strategy_data, total_shares.saturating_sub(shares));

    let new_shares = Strategy::total_shares(&strategy_data);
    let new_nav = Strategy::current_nav(&strategy_data);
    if new_shares > 0 && new_nav > Strategy::high_water_mark(&strategy_data) {
        Strategy::set_high_water_mark(&mut strategy_data, new_nav);
    }

    Ok(())
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /mnt/storage/yields-v2/packages/programs && cargo check --lib -p strategy-token`
Expected: Compiles. `kamino_withdraw::withdraw_signed` is still a stub — that's fine, we implement it in Task 6.

- [ ] **Step 3: Commit**

```bash
git add programs/strategy-token/src/instructions/redeem_shares.rs
git commit -m "feat: implement redeem_shares with performance fee

Burns shares, calculates proportional withdrawal with HWM-based
performance fee, withdraws from protocol (yield), transfers net
to redeemer and fee to authority."
```

---

## Task 6: Kamino Withdraw CPI

**Files:**
- Replace: `programs/strategy-token/src/cpi/kamino_withdraw.rs`

This implements Kamino's `withdraw_obligation_collateral_and_redeem_reserve_collateral` as a direct CPI, mirroring Beethoven's deposit adapter pattern. The exact discriminator and account ordering come from Kamino's program.

- [ ] **Step 1: Implement kamino_withdraw.rs**

```rust
use pinocchio::{
    program_error::ProgramError, AccountView, ProgramResult,
    pubkey::Pubkey,
    instruction::{AccountMeta, Instruction},
    cpi,
};

/// Kamino Lending Program ID
pub const KAMINO_LEND_PROGRAM_ID: Pubkey =
    pinocchio::pubkey!("KLend2g3cP87ber8p32LuJLuLPzCvXN4KcKr2S8MQek");

/// Discriminator for withdraw_obligation_collateral_and_redeem_reserve_collateral
const WITHDRAW_DISCRIMINATOR: [u8; 8] = [149, 158, 41, 178, 5, 199, 132, 135];

/// Discriminator for refresh_reserve
const REFRESH_RESERVE_DISCRIMINATOR: [u8; 8] = [2, 218, 138, 235, 79, 201, 25, 102];

/// Discriminator for refresh_obligation
const REFRESH_OBLIGATION_DISCRIMINATOR: [u8; 8] = [38, 148, 147, 13, 186, 151, 184, 194];

/// Withdraw from Kamino lending with PDA signing.
///
/// Accounts layout (same as KaminoDepositAccounts):
/// [0]  kamino_lending_program
/// [1]  owner (wallet PDA — signer)
/// [2]  obligation
/// [3]  lending_market
/// [4]  lending_market_authority
/// [5]  reserve
/// [6]  reserve_liquidity_mint
/// [7]  reserve_liquidity_supply
/// [8]  reserve_collateral_mint
/// [9]  reserve_destination_deposit_collateral
/// [10] user_source_liquidity (wallet's deposit_mint ATA — receives withdrawn tokens)
/// [11] placeholder_user_destination_collateral
/// [12] collateral_token_program
/// [13] liquidity_token_program
/// [14] instruction_sysvar_account
/// [15] obligation_farm_user_state
/// [16] reserve_farm_state
/// [17] farms_program
/// [18] scope_oracle
/// [19..] reserve_accounts (for obligation refresh, owned by Kamino)
pub fn withdraw_signed(
    accounts: &[AccountView],
    amount: u64,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    if accounts.len() < 19 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    // Count reserve accounts (owned by Kamino, after index 19)
    let reserve_accounts = &accounts[19..];

    // 1. Refresh reserve for target + all additional reserves
    refresh_reserve(&accounts[0], &accounts[5], signer_seeds)?;
    for reserve_acc in reserve_accounts.iter() {
        if reserve_acc.owner() == &KAMINO_LEND_PROGRAM_ID {
            refresh_reserve(&accounts[0], reserve_acc, signer_seeds)?;
        }
    }

    // 2. Refresh obligation
    refresh_obligation(&accounts[0], &accounts[2], &accounts[3], reserve_accounts, signer_seeds)?;

    // 3. Withdraw
    let mut ix_data = [0u8; 16]; // 8 (discriminator) + 8 (amount)
    ix_data[0..8].copy_from_slice(&WITHDRAW_DISCRIMINATOR);
    ix_data[8..16].copy_from_slice(&amount.to_le_bytes());

    let withdraw_accounts = [
        AccountMeta::readonly_signer(accounts[1].key()),  // owner
        AccountMeta::writable(accounts[2].key()),          // obligation
        AccountMeta::readonly(accounts[3].key()),          // lending_market
        AccountMeta::readonly(accounts[4].key()),          // lending_market_authority
        AccountMeta::writable(accounts[5].key()),          // reserve
        AccountMeta::writable(accounts[6].key()),          // reserve_liquidity_mint
        AccountMeta::writable(accounts[7].key()),          // reserve_liquidity_supply
        AccountMeta::writable(accounts[8].key()),          // reserve_collateral_mint
        AccountMeta::writable(accounts[9].key()),          // reserve_destination_deposit_collateral
        AccountMeta::writable(accounts[10].key()),         // user_source_liquidity
        AccountMeta::writable(accounts[11].key()),         // placeholder
        AccountMeta::readonly(accounts[12].key()),         // collateral_token_program
        AccountMeta::readonly(accounts[13].key()),         // liquidity_token_program
        AccountMeta::readonly(accounts[14].key()),         // instruction_sysvar
        AccountMeta::writable(accounts[15].key()),         // obligation_farm_user_state
        AccountMeta::writable(accounts[16].key()),         // reserve_farm_state
        AccountMeta::readonly(accounts[17].key()),         // farms_program
        AccountMeta::readonly(accounts[18].key()),         // scope_oracle
    ];

    let ix = Instruction {
        program_id: &KAMINO_LEND_PROGRAM_ID,
        accounts: &withdraw_accounts,
        data: &ix_data,
    };

    // Pass all accounts for invoke_signed (runtime needs all referenced accounts)
    cpi::invoke_signed(&ix, &accounts[1..19], &[signer_seeds])
}

fn refresh_reserve(
    kamino_program: &AccountView,
    reserve: &AccountView,
    _signer_seeds: &[&[u8]],
) -> ProgramResult {
    let accounts = [AccountMeta::writable(reserve.key())];

    let ix = Instruction {
        program_id: &KAMINO_LEND_PROGRAM_ID,
        accounts: &accounts,
        data: &REFRESH_RESERVE_DISCRIMINATOR,
    };

    cpi::invoke(&ix, &[reserve])
}

fn refresh_obligation(
    kamino_program: &AccountView,
    obligation: &AccountView,
    lending_market: &AccountView,
    reserve_accounts: &[AccountView],
    _signer_seeds: &[&[u8]],
) -> ProgramResult {
    // Build accounts: obligation (writable) + lending_market (readonly) + reserves (readonly)
    let mut accounts_vec = [AccountMeta::readonly(&[0u8; 32]); 15]; // max 15 accounts
    accounts_vec[0] = AccountMeta::writable(obligation.key());
    accounts_vec[1] = AccountMeta::readonly(lending_market.key());

    let num_reserves = reserve_accounts.len().min(13);
    for i in 0..num_reserves {
        accounts_vec[2 + i] = AccountMeta::readonly(reserve_accounts[i].key());
    }
    let total_accounts = 2 + num_reserves;

    let ix = Instruction {
        program_id: &KAMINO_LEND_PROGRAM_ID,
        accounts: &accounts_vec[..total_accounts],
        data: &REFRESH_OBLIGATION_DISCRIMINATOR,
    };

    // Build account infos slice
    let mut infos = [obligation; 15]; // placeholder, will be overwritten
    infos[0] = obligation;
    infos[1] = lending_market;
    for i in 0..num_reserves {
        infos[2 + i] = &reserve_accounts[i];
    }

    cpi::invoke(&ix, &infos[..total_accounts])
}
```

**Note:** The discriminators above are from Kamino's program. They must be verified against the actual Kamino IDL during integration testing. If they don't match, we update them.

- [ ] **Step 2: Verify compilation**

Run: `cd /mnt/storage/yields-v2/packages/programs && cargo check --lib -p strategy-token`
Expected: Compiles.

- [ ] **Step 3: Commit**

```bash
git add programs/strategy-token/src/cpi/kamino_withdraw.rs
git commit -m "feat: implement Kamino withdraw CPI

Direct CPI to Kamino's withdraw_obligation_collateral. Mirrors
Beethoven's deposit adapter: refresh reserve, refresh obligation,
then withdraw. Will be upstreamed as Beethoven Withdraw trait PR."
```

---

## Task 7: update_nav Instruction

**Files:**
- Replace: `programs/strategy-token/src/instructions/update_nav.rs`

- [ ] **Step 1: Implement update_nav**

```rust
use pinocchio::{
    program_error::ProgramError, AccountView, ProgramResult,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
};

use crate::{
    cpi,
    error::{self, err},
    state::{
        strategy::{Strategy, STRATEGY_TYPE_YIELD, STRATEGY_TYPE_AGENT},
        nav_oracle::NavOracle,
    },
    util,
};

const NAV_SCALE: u128 = 1_000_000_000; // 1e9

pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountView],
    _data: &[u8],
) -> ProgramResult {
    // Parse accounts
    let [cranker, strategy_acc, nav_oracle_acc, wallet_token_ata, remaining @ ..] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    util::assert_signer(cranker)?;
    util::assert_owned_by(strategy_acc, program_id)?;
    util::assert_owned_by(nav_oracle_acc, program_id)?;
    util::assert_writable(strategy_acc)?;
    util::assert_writable(nav_oracle_acc)?;

    let clock = Clock::get()?;
    let current_slot = clock.slot;

    // Check discriminators + relationship
    let strategy_data = strategy_acc.try_borrow_data()?;
    if !Strategy::check_discriminator(&strategy_data) {
        return Err(err(error::ERROR_INVALID_DISCRIMINATOR));
    }

    let oracle_data = nav_oracle_acc.try_borrow_data()?;
    if !NavOracle::check_discriminator(&oracle_data) {
        return Err(err(error::ERROR_INVALID_DISCRIMINATOR));
    }
    util::assert_keys_equal(NavOracle::strategy(&oracle_data), strategy_acc.key())?;

    // Enforce min snapshot interval
    let last_snapshot = NavOracle::last_snapshot_slot(&oracle_data);
    let min_interval = NavOracle::min_snapshot_interval(&oracle_data);
    let slots_elapsed = current_slot.saturating_sub(last_snapshot);
    if slots_elapsed < min_interval {
        return Err(err(error::ERROR_SNAPSHOT_TOO_SOON));
    }

    let total_shares = Strategy::total_shares(&strategy_data);
    let strategy_type = Strategy::strategy_type(&strategy_data);
    let old_accumulator = Strategy::nav_twap_accumulator(&strategy_data);
    let twap_window = NavOracle::twap_window(&oracle_data);

    drop(oracle_data);
    drop(strategy_data);

    // Calculate portfolio value based on strategy type
    let portfolio_value = if strategy_type == STRATEGY_TYPE_YIELD && !remaining.is_empty() {
        // Kamino: read collateral balance * exchange rate
        // For now, read wallet's deposit token balance as fallback
        // Full Kamino reserve read will be added during devnet integration
        let ata_data = wallet_token_ata.try_borrow_data()?;
        let balance = cpi::spl_token::read_token_amount(&ata_data);
        drop(ata_data);
        balance
    } else {
        // Agent or simple: wallet token balance = NAV
        let ata_data = wallet_token_ata.try_borrow_data()?;
        let balance = cpi::spl_token::read_token_amount(&ata_data);
        drop(ata_data);
        balance
    };

    // Compute NAV per share (1e9 scaled)
    let nav_per_share = if total_shares > 0 {
        (portfolio_value as u128)
            .checked_mul(NAV_SCALE)
            .ok_or(err(error::ERROR_NAV_OVERFLOW))?
            .checked_div(total_shares as u128)
            .ok_or(err(error::ERROR_NAV_OVERFLOW))? as u64
    } else {
        0
    };

    // Update TWAP accumulator
    let weighted_value = (nav_per_share as u128)
        .checked_mul(slots_elapsed as u128)
        .ok_or(err(error::ERROR_NAV_OVERFLOW))?;
    let new_accumulator = old_accumulator
        .checked_add(weighted_value)
        .ok_or(err(error::ERROR_NAV_OVERFLOW))?;

    let effective_window = slots_elapsed.min(twap_window);
    let twap_value = if effective_window > 0 {
        (new_accumulator / effective_window as u128) as u64
    } else {
        nav_per_share
    };

    // Write NavOracle
    let mut oracle_data = nav_oracle_acc.try_borrow_mut_data()?;
    NavOracle::set_nav_per_share(&mut oracle_data, nav_per_share);
    NavOracle::set_twap_value(&mut oracle_data, twap_value);
    NavOracle::set_last_snapshot_slot(&mut oracle_data, current_slot);
    NavOracle::set_snapshot_count(&mut oracle_data,
        NavOracle::snapshot_count(&oracle_data) + 1);
    drop(oracle_data);

    // Write Strategy
    let mut strategy_data = strategy_acc.try_borrow_mut_data()?;
    Strategy::set_current_nav(&mut strategy_data, portfolio_value);
    Strategy::set_last_nav_slot(&mut strategy_data, current_slot);
    Strategy::set_nav_twap_accumulator(&mut strategy_data, new_accumulator);
    Strategy::set_twap_last_slot(&mut strategy_data, current_slot);

    if portfolio_value > Strategy::high_water_mark(&strategy_data) {
        Strategy::set_high_water_mark(&mut strategy_data, portfolio_value);
    }

    Ok(())
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /mnt/storage/yields-v2/packages/programs && cargo check --lib -p strategy-token`

- [ ] **Step 3: Commit**

```bash
git add programs/strategy-token/src/instructions/update_nav.rs
git commit -m "feat: implement update_nav with TWAP accumulator

Permissionless NAV cranking. Reads wallet token balance as portfolio
value. Computes 1e9-scaled nav_per_share, updates slot-weighted
TWAP accumulator and high water mark. Kamino reserve exchange rate
read to be added during devnet integration."
```

---

## Task 8: rebalance Instruction

**Files:**
- Replace: `programs/strategy-token/src/instructions/rebalance.rs`

- [ ] **Step 1: Implement rebalance**

```rust
use pinocchio::{
    program_error::ProgramError, AccountView, ProgramResult,
    pubkey::Pubkey,
};

use beethoven::{try_from_deposit_context, try_from_swap_context, Deposit, DepositContext, Swap, SwapContext};

use crate::{
    cpi,
    error::{self, err},
    state::strategy::{Strategy, STATUS_ACTIVE},
    util,
};

/// Instruction data layout:
/// [0]     num_steps    u8
/// Per step:
///   [0]     action       u8  (0=deposit, 1=withdraw, 2=swap)
///   [1..9]  amount       u64 LE
///   [9..]   extra_data   variable (protocol-specific)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    if data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    // Parse accounts
    let [authority, strategy_acc, remaining @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    util::assert_signer(authority)?;
    util::assert_owned_by(strategy_acc, program_id)?;

    let strategy_data = strategy_acc.try_borrow_data()?;
    if !Strategy::check_discriminator(&strategy_data) {
        return Err(err(error::ERROR_INVALID_DISCRIMINATOR));
    }
    if Strategy::status(&strategy_data) != STATUS_ACTIVE {
        return Err(err(error::ERROR_STRATEGY_NOT_ACTIVE));
    }
    util::assert_keys_equal(authority.key(), Strategy::authority(&strategy_data))?;

    let wallet_bump = Strategy::wallet_bump(&strategy_data);
    drop(strategy_data);

    let wallet_seeds: &[&[u8]] = &[b"wallet", strategy_acc.key(), &[wallet_bump]];

    let num_steps = data[0] as usize;
    let mut remaining_data = &data[1..];
    let mut remaining_accounts = remaining;

    for _ in 0..num_steps {
        if remaining_data.len() < 9 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let action = remaining_data[0];
        let amount = u64::from_le_bytes(remaining_data[1..9].try_into().unwrap());
        remaining_data = &remaining_data[9..];

        match action {
            0 => {
                // Deposit via Beethoven
                let deposit_ctx = try_from_deposit_context(remaining_accounts)?;
                let (deposit_data, next_data) = deposit_ctx.try_from_deposit_data(remaining_data)?;
                DepositContext::deposit_signed(
                    &deposit_ctx, amount, &deposit_data, &[wallet_seeds.into()],
                )?;
                remaining_data = next_data;
                // Beethoven deposit consumes all remaining accounts for now
                remaining_accounts = &[];
            }
            1 => {
                // Withdraw via Kamino direct CPI
                cpi::kamino_withdraw::withdraw_signed(
                    remaining_accounts, amount, wallet_seeds,
                )?;
                remaining_accounts = &[];
            }
            2 => {
                // Swap via Beethoven
                if remaining_data.len() < 8 {
                    return Err(ProgramError::InvalidInstructionData);
                }
                let min_out = u64::from_le_bytes(remaining_data[0..8].try_into().unwrap());
                remaining_data = &remaining_data[8..];

                let (swap_ctx, next_accounts) = try_from_swap_context(remaining_accounts)?;
                let (swap_data, next_data) = swap_ctx.try_from_swap_data(remaining_data)?;
                SwapContext::swap_signed(
                    &swap_ctx, amount, min_out, &swap_data, &[wallet_seeds.into()],
                )?;
                remaining_accounts = next_accounts;
                remaining_data = next_data;
            }
            _ => return Err(ProgramError::InvalidInstructionData),
        }
    }

    Ok(())
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /mnt/storage/yields-v2/packages/programs && cargo check --lib -p strategy-token`

- [ ] **Step 3: Commit**

```bash
git add programs/strategy-token/src/instructions/rebalance.rs
git commit -m "feat: implement rebalance with multi-step Beethoven routing

Authority-only instruction. Supports deposit (Beethoven), withdraw
(Kamino direct), and swap (Beethoven) actions in sequence. Accounts
and data consumed progressively per step."
```

---

## Task 9: Full Build + Fix Compilation Errors

This task compiles the entire program with `cargo-build-sbf` and fixes any issues from pinocchio/Beethoven API mismatches.

**Files:**
- Any file that needs fixing based on compilation errors

- [ ] **Step 1: Run cargo check**

Run: `cd /mnt/storage/yields-v2/packages/programs && cargo check --lib -p strategy-token 2>&1`

Fix any type mismatches, missing imports, or API differences between the plan and actual pinocchio/Beethoven APIs.

Common issues to expect:
- `pinocchio::pubkey::Pubkey` might be `pinocchio::Pubkey` or `solana_address::Address`
- `AccountView` method names might differ (`key()` vs `address()`, `is_signer()` vs `signer()`)
- `cpi::invoke_signed` signature might take different types for signer seeds
- `try_borrow_data()` / `try_borrow_mut_data()` might be `data()` / `data_mut()` in pinocchio
- Beethoven's `Signer` type might need conversion from `&[&[u8]]`

- [ ] **Step 2: Run SBF build**

Run: `cd /mnt/storage/yields-v2/packages/programs && PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH" cargo-build-sbf --manifest-path programs/strategy-token/Cargo.toml 2>&1`

Fix any SBF-specific issues (no_std constraints, missing syscalls, etc.)

- [ ] **Step 3: Verify prediction-market still compiles**

Run: `cd /mnt/storage/yields-v2/packages/programs && cargo check --lib -p prediction-market 2>&1`

Both programs must coexist in the workspace.

- [ ] **Step 4: Commit all fixes**

```bash
git add programs/strategy-token/
git commit -m "fix: resolve compilation errors for pinocchio + Beethoven

Fixes API mismatches between plan and actual pinocchio/Beethoven
crate APIs. Both strategy-token and prediction-market compile."
```

---

## Task 10: Verify Workspace Integrity + Clean Up

- [ ] **Step 1: Verify both programs compile**

```bash
cd /mnt/storage/yields-v2/packages/programs
cargo check --lib -p strategy-token
cargo check --lib -p prediction-market
```

- [ ] **Step 2: Remove any dead Anchor artifacts from strategy-token**

Check for any leftover Anchor-specific files that are no longer needed. The `Xargo.toml` should be kept (needed for SBF builds).

- [ ] **Step 3: Final commit**

```bash
git add -A packages/programs/programs/strategy-token/
git commit -m "chore: clean up strategy-token pinocchio rewrite

Remove Anchor artifacts, verify workspace integrity.
Strategy-token: pinocchio + Beethoven.
Prediction-market: Anchor (unchanged)."
```
