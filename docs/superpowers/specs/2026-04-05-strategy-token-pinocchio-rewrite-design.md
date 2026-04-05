# Strategy Token Program — Pinocchio + Beethoven Rewrite

**Date:** 2026-04-05
**Author:** Yudhi
**Status:** Draft
**Scope:** Rewrite strategy-token from Anchor to pinocchio with inline Beethoven integration

---

## 1. Motivation

The Strategy Token Program needs to route user deposits into DeFi protocols (Kamino lending, Jupiter Perps) via Beethoven's CPI routing SDK. Beethoven is built on the Anza SDK v3 crates (`solana-account-view`, `solana-instruction-view`) and is incompatible with Anchor's `AccountInfo` at the library level — the types cannot be converted.

Rather than deploying Beethoven as a separate on-chain router program and adding CPI depth, we rewrite strategy-token in pinocchio so Beethoven compiles directly into our program. This gives us:

- **CPI depth 1** (strategy-token → Kamino) instead of 2 (strategy-token → router → Kamino)
- **Zero overhead** — no Anchor framework cost, no intermediate program
- **Native Beethoven access** — `try_from_deposit_context()`, `deposit_signed()` called inline
- **Lower CU** — pinocchio + zero-alloc patterns
- **Upstream alignment** — our code patterns match Beethoven's, making future PRs natural

The prediction market program stays Anchor (Sean's domain). It has no Beethoven dependency — it only reads Strategy account data at resolution time, which is framework-agnostic byte reads.

---

## 2. Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | pinocchio v0.10 | Beethoven compatibility, zero overhead, CPI depth reduction |
| Beethoven integration | Direct import (compiled in) | No separate router program, no CPI boundary |
| Strategy config | Fixed at creation (reserve, deposit_mint) | A strategy IS a specific position, not a generic protocol |
| Deposit token | SPL token per strategy (e.g., USDC) | Apples-to-apples share price comparison on leaderboard |
| NAV calculation | Trustless on-chain reads from protocol accounts | Oracle-free narrative, verifiable by prediction markets |
| Prediction market program | Stays Anchor | No Beethoven dependency, auto-IDL for frontend, Sean's domain |
| Protocols | Kamino lending + Jupiter Perps | Covers both yield and agent strategy types for demo |
| Serialization | Manual fixed-offset, no Borsh | Zero-copy compatible, no alloc, matches Beethoven patterns |
| Name field | `[u8; 32]` not String | Fixed size, no Borsh length prefix overhead |
| Discriminators | 8-byte account prefix, 1-byte instruction | Account type safety + minimal instruction overhead |
| Error codes | `u32` starting at `0x1770_0000` | Matches Anchor's 6000 offset convention for ecosystem consistency |

---

## 3. Program Structure

```
programs/strategy-token/
  Cargo.toml
  Xargo.toml
  src/
    lib.rs                          — entrypoint + discriminator dispatch
    error.rs                        — u32 error codes
    state/
      mod.rs
      strategy.rs                   — Strategy account (manual serialization)
      nav_oracle.rs                 — NavOracle account
    instructions/
      mod.rs
      create_strategy.rs            — PDA creation, mint init, config
      buy_shares.rs                 — deposit via Beethoven + mint shares
      redeem_shares.rs              — burn shares + withdraw
      update_nav.rs                 — read protocol state, compute NAV, TWAP
      rebalance.rs                  — Beethoven swap/deposit routing
    cpi/
      mod.rs
      spl_token.rs                  — mint_to, burn, transfer, init_mint
      system.rs                     — create_account, transfer_sol
      associated_token.rs           — create ATA (idempotent)
      kamino_withdraw.rs            — direct Kamino withdraw CPI (pre-Withdraw trait)
      jupiter_perps.rs              — Jupiter Perps position read + close CPI
    util.rs                         — PDA validation, signer checks, assert helpers
```

### Dependencies

```toml
[package]
name = "strategy-token"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
pinocchio = { version = "0.10", default-features = false }
beethoven = { git = "https://github.com/blueshift-gg/beethoven", features = ["kamino-deposit"] }
```

### Entrypoint

```rust
#![no_std]
pinocchio::no_allocator!();
pinocchio::nostd_panic_handler!();
pinocchio::program_entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    let (disc, rest) = data.split_first()
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

---

## 4. State Accounts

### 4.1 Strategy Account

**Size:** 8 (discriminator) + 322 (data) = 330 bytes

**Discriminator:** First 8 bytes of SHA-256(`"account:Strategy"`)

```
Offset  Size  Field                Type       Description
0       8     discriminator        [u8; 8]    Account type discriminator
8       32    authority            Address    Creator pubkey
40      32    mint                 Address    Strategy share token mint
72      32    wallet               Address    PDA holding protocol positions
104     32    deposit_mint         Address    Token users deposit (e.g., USDC mint)
136     32    protocol             Address    Target protocol program ID
168     32    reserve              Address    Specific protocol position (Kamino reserve, Perps market)
200     32    name                 [u8; 32]   Strategy name (UTF-8, null-padded)
232     1     strategy_type        u8         0 = Yield, 1 = Agent
233     1     status               u8         0 = Active, 1 = Paused, 2 = Closed
234     2     fee_bps              u16        Performance fee (10000 = 100%)
236     8     total_deposits       u64        Cumulative deposits in deposit_mint base units
244     8     current_nav          u64        Current portfolio value
252     8     total_shares         u64        Shares outstanding
260     4     total_investors      u32        Unique holder count
264     8     high_water_mark      u64        HWM for performance fee calculation
272     8     min_deposit          u64        Minimum deposit amount
280     8     last_nav_slot        u64        Last NAV update slot
288     16    nav_twap_accumulator u128       TWAP accumulator
304     8     twap_last_slot       u64        TWAP last update slot
312     8     created_at           i64        Unix timestamp
320     1     bump                 u8         Strategy PDA bump
321     1     wallet_bump          u8         Wallet PDA bump
--- total: 322 data bytes + 8 discriminator = 330 bytes
```

**PDA seeds:**
- Strategy: `["strategy", authority, name]`
- Wallet: `["wallet", strategy_key]`

### 4.2 NavOracle Account

**Size:** 8 (discriminator) + 81 (data) = 89 bytes

**Discriminator:** First 8 bytes of SHA-256(`"account:NavOracle"`)

```
Offset  Size  Field                  Type      Description
0       8     discriminator          [u8; 8]   Account type discriminator
8       32    strategy               Address   Strategy this oracle tracks
40      8     nav_per_share          u64       Scaled by 1e9
48      8     twap_value             u64       Scaled by 1e9
56      8     snapshot_count         u64       Number of snapshots
64      8     last_snapshot_slot     u64       Last snapshot slot
72      8     min_snapshot_interval  u64       Default 300 slots (~2 min)
80      8     twap_window            u64       Default 9000 slots (~1 hour)
88      1     bump                   u8        NavOracle PDA bump
--- total: 81 data bytes + 8 discriminator = 89 bytes
```

**PDA seeds:** `["nav", strategy_key]`

### 4.3 Serialization

Manual fixed-offset reads and writes. No Borsh. Each struct provides:

```rust
impl Strategy {
    pub const LEN: usize = 330;
    pub const DISCRIMINATOR: [u8; 8] = [...];

    /// Zero-copy read from account data buffer
    pub fn from_data(data: &[u8]) -> Result<&Self, ProgramError> { ... }

    /// Write all fields to account data buffer
    pub fn write_to(&self, data: &mut [u8]) { ... }
}
```

---

## 5. Instructions

### 5.1 create_strategy (discriminator: 0)

**Instruction data:**
```
[0]     strategy_type    u8         0 = Yield, 1 = Agent
[1..3]  fee_bps          u16 LE     Performance fee
[3..11] min_deposit      u64 LE     Minimum deposit
[11..43] name            [u8; 32]   Strategy name (null-padded)
```

**Accounts:**
```
[0]  creator            — signer, writable, pays rent
[1]  strategy           — writable, PDA (to be created)
[2]  mint               — writable (to be created, 9 decimals)
[3]  wallet             — PDA (derived, not created — just validate seeds)
[4]  nav_oracle         — writable, PDA (to be created)
[5]  deposit_mint       — read-only (the SPL token mint users will deposit)
[6]  protocol           — read-only (target protocol program ID)
[7]  reserve            — read-only (specific protocol position)
[8]  token_program      — SPL Token
[9]  system_program     — System
[10] rent               — Rent sysvar
```

**Logic:**
1. Validate name length, fee_bps <= 10000, strategy_type in {0, 1}
2. Derive and create Strategy PDA (`create_account` with program as owner)
3. Create mint (9 decimals, strategy PDA as mint authority)
4. Derive wallet PDA (validate seeds, store bump — wallet is not created as an account, it's just a PDA address that holds ATAs)
5. Create NavOracle PDA
6. Write all state fields

### 5.2 buy_shares (discriminator: 1)

**Instruction data:**
```
[0..8]  amount    u64 LE    Deposit amount in deposit_mint base units
```

**Accounts:**
```
[0]  buyer              — signer, writable
[1]  strategy           — writable
[2]  mint               — writable
[3]  buyer_shares_ata   — writable (init if needed)
[4]  wallet             — writable (PDA)
[5]  wallet_token_ata   — writable (wallet's ATA for deposit_mint)
[6]  buyer_token_ata    — writable (buyer's deposit_mint ATA, source)
[7]  token_program
[8]  system_program
[9]  ata_program
[10..] remaining        — Kamino/protocol accounts for Beethoven (yield only)
```

**Logic:**
1. Validate signer, strategy Active, amount >= min_deposit
2. Create buyer_shares_ata if needed (idempotent ATA creation)
3. SPL token transfer: buyer_token_ata → wallet_token_ata (amount of deposit_mint)
4. **If Yield strategy**: route deposit via Beethoven
   ```
   deposit_ctx = try_from_deposit_context(&accounts[10..])
   deposit_data = deposit_ctx.try_from_deposit_data(&[])
   DepositContext::deposit_signed(&deposit_ctx, amount, &deposit_data, &[wallet_seeds])
   ```
   Wallet PDA signs. Beethoven → Kamino: refresh reserve → refresh obligation → deposit.
   Wallet now holds Kamino collateral tokens.
5. **If Agent strategy**: no Beethoven call. Tokens remain in wallet_token_ata.
6. Calculate shares:
   - First deposit (total_shares == 0): shares = amount
   - Subsequent: shares = amount * total_shares / current_nav (u128 intermediate)
7. Mint shares to buyer_shares_ata (strategy PDA signs mint_to)
8. Update strategy: total_deposits += amount, current_nav += amount, total_shares += shares

### 5.3 redeem_shares (discriminator: 2)

**Instruction data:**
```
[0..8]  shares    u64 LE    Number of shares to redeem
```

**Accounts:**
```
[0]  redeemer           — signer, writable
[1]  strategy           — writable
[2]  mint               — writable
[3]  redeemer_shares_ata — writable (source of shares to burn)
[4]  wallet             — writable (PDA)
[5]  wallet_token_ata   — writable (source of deposit tokens)
[6]  redeemer_token_ata — writable (receives withdrawal)
[7]  fee_receiver_ata   — writable (authority's ATA for deposit_mint)
[8]  token_program
[9]  system_program
[10..] remaining        — Kamino accounts for withdraw (yield only)
```

**Logic:**
1. Validate: shares > 0, redeemer_shares_ata.amount >= shares, strategy Active
2. Calculate gross_withdrawal = shares * current_nav / total_shares
3. Performance fee calculation:
   ```
   nav_per_share_now = current_nav * 1e9 / total_shares
   hwm_per_share = high_water_mark * 1e9 / total_shares
   if nav_per_share_now > hwm_per_share:
     profit_per_share = nav_per_share_now - hwm_per_share
     total_profit = profit_per_share * shares / 1e9
     fee = total_profit * fee_bps / 10000
   else:
     fee = 0
   net_withdrawal = gross_withdrawal - fee
   ```
4. Burn shares from redeemer_shares_ata
5. **If Yield strategy**: Withdraw from Kamino
   - Call `kamino_withdraw::withdraw_signed()` — our direct CPI implementation
   - 3 CPIs: refresh reserve → refresh obligation → withdraw collateral & redeem
   - Deposit_mint tokens return to wallet_token_ata
6. **If Agent strategy**: skip (tokens already in wallet_token_ata)
7. SPL token transfer: wallet_token_ata → redeemer_token_ata (net_withdrawal, wallet PDA signs)
8. SPL token transfer: wallet_token_ata → fee_receiver_ata (fee, wallet PDA signs, skip if 0)
9. Update strategy: current_nav -= gross_withdrawal, total_shares -= shares, update HWM

### 5.4 update_nav (discriminator: 3)

**Instruction data:** none (0 bytes after discriminator)

**Accounts:**
```
[0]  cranker            — signer (permissionless — anyone can crank)
[1]  strategy           — writable
[2]  nav_oracle         — writable
[3]  wallet_token_ata   — read-only (wallet's deposit_mint balance)
[4..] remaining         — protocol accounts for NAV read (yield only)
```

**Logic:**
1. Enforce min_snapshot_interval: current_slot - last_snapshot_slot >= min_snapshot_interval
2. Calculate portfolio_value based on protocol:

   **Kamino (Yield):**
   ```
   Read Kamino reserve account from remaining_accounts
   Extract exchange_rate from reserve data at known byte offsets
   Read wallet's Kamino collateral token balance (cToken ATA)
   portfolio_value = collateral_balance * exchange_rate / scale_factor
   ```

   **Jupiter Perps (Agent):**
   ```
   Read Jupiter Perps position account from remaining_accounts
   position_value = collateral + unrealized_pnl - cumulative_borrow_fees
   portfolio_value = wallet_token_ata.amount + position_value
   ```

   **No protocol / simple Agent:**
   ```
   portfolio_value = wallet_token_ata.amount
   ```

3. Compute nav_per_share = portfolio_value * 1e9 / total_shares (0 if no shares)
4. TWAP update:
   ```
   slots_elapsed = current_slot - last_snapshot_slot
   accumulator += nav_per_share * slots_elapsed
   effective_window = min(total_slots_tracked, twap_window)
   twap_value = accumulator / effective_window
   ```
5. Update strategy: current_nav = portfolio_value, last_nav_slot
6. Update nav_oracle: nav_per_share, twap_value, snapshot_count, last_snapshot_slot
7. Update high_water_mark if portfolio_value > current HWM

### 5.5 rebalance (discriminator: 4)

**Instruction data:**
```
[0]     num_steps    u8       Number of rebalance steps
Per step:
[0]     action       u8       0 = deposit, 1 = withdraw, 2 = swap
[1..9]  amount       u64 LE   Amount for this step
[9..]   extra_data   [u8]     Protocol-specific data (length determined by protocol)
```

**Accounts:**
```
[0]  authority          — signer (must == strategy.authority)
[1]  strategy           — writable
[2..] remaining         — flat concatenation of accounts for all steps
```

**Logic:**
1. Validate authority == strategy.authority, strategy Active
2. For each step, consume accounts from remaining slice:
   ```
   action 0 (deposit):
     deposit_ctx = try_from_deposit_context(remaining_accounts)
     DepositContext::deposit_signed(&ctx, amount, &data, &[wallet_seeds])
   action 1 (withdraw):
     kamino_withdraw::withdraw_signed(remaining_accounts, amount, &[wallet_seeds])
   action 2 (swap):
     (swap_ctx, next) = try_from_swap_context(remaining_accounts)
     SwapContext::swap_signed(&ctx, amount, min_out, &data, &[wallet_seeds])
     remaining_accounts = next
   ```
3. Log completion

---

## 6. Protocol-Specific NAV Reads

### 6.1 Kamino Lending

The Kamino reserve account contains the exchange rate between collateral tokens (cTokens) and the underlying liquidity. To compute NAV:

```
reserve_data = remaining_accounts[0].data()
// Kamino reserve layout: liquidity.mint_total_supply, collateral.mint_total_supply
// exchange_rate = liquidity_supply / collateral_supply (scaled)
collateral_balance = read_token_account_amount(wallet_collateral_ata)
nav = collateral_balance * exchange_rate / scale
```

The exact byte offsets for the Kamino reserve struct will be derived from Kamino's IDL/source. This is a pure data read — no CPI, no invoke.

### 6.2 Jupiter Perps

Jupiter Perps position accounts (program: `PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu`) contain:

```
position_data = remaining_accounts[0].data()
// Key fields at known offsets:
//   collateral_usd: u64      — deposited collateral
//   size_usd: u64            — position size
//   realised_pnl_usd: i64    — realized PnL
//   cumulative_interest: u64  — borrow fees paid
// Also need Custody account for mark price to compute unrealized PnL
custody_data = remaining_accounts[1].data()
// mark_price from custody oracle data

unrealized_pnl = (mark_price - entry_price) * size  // long
// or (entry_price - mark_price) * size              // short
position_value = collateral + unrealized_pnl - pending_borrow_fees
```

Combined with any idle tokens in wallet_token_ata, the total NAV = position_value + idle_balance.

---

## 7. CPI Helper Module

### 7.1 spl_token.rs (~80 lines)

```rust
pub fn mint_to(token_program, mint, destination, authority, amount, signer_seeds) -> ProgramResult
pub fn burn(token_program, mint, source, authority, amount) -> ProgramResult
pub fn transfer(token_program, source, destination, authority, amount, signer_seeds) -> ProgramResult
pub fn init_mint(token_program, mint, rent, authority, decimals, signer_seeds) -> ProgramResult
```

Each builds instruction data into a stack-allocated buffer (`MaybeUninit<[u8; N]>`) and calls `invoke_signed`. Discriminators:
- MintTo: `[7]`
- Burn: `[8]`
- Transfer: `[3]`
- InitializeMint2: `[20]`

### 7.2 system.rs (~40 lines)

```rust
pub fn create_account(system_program, payer, new_account, lamports, space, owner, signer_seeds) -> ProgramResult
pub fn transfer_sol(system_program, from, to, lamports, signer_seeds) -> ProgramResult
```

### 7.3 associated_token.rs (~30 lines)

```rust
pub fn create_idempotent(ata_program, payer, wallet, mint, token_program, system_program) -> ProgramResult
```

Uses the `CreateIdempotent` instruction (discriminator `[1]`) — creates ATA if it doesn't exist, no-ops if it does.

### 7.4 kamino_withdraw.rs (~120 lines)

Direct Kamino withdraw CPI mirroring Beethoven's deposit adapter pattern. 3 sequential CPIs:

1. Refresh reserve — discriminator from Kamino IDL
2. Refresh obligation — with all reserve accounts
3. `withdraw_obligation_collateral_and_redeem_reserve_collateral` — returns underlying tokens

Same account structure as `KaminoDepositAccounts` (19 fixed + variable reserves). Uses `MaybeUninit` + `invoke_signed` matching Beethoven's zero-alloc pattern.

This code will move almost verbatim into a Beethoven `crates/withdraw/kamino/` PR once validated in production.

### 7.5 jupiter_perps.rs (~80 lines)

Position account data reader (no CPI needed for NAV reads — just byte parsing):

```rust
pub fn read_position_value(position_account, custody_account) -> Result<u64, ProgramError>
```

For close_position CPI (used in rebalance):

```rust
pub fn close_position_signed(accounts, signer_seeds) -> ProgramResult
```

---

## 8. Error Codes

```rust
pub const ERROR_STRATEGY_NOT_ACTIVE: u32    = 0x1770_0000;  // 0x1770 = 6000 decimal, _XXXX = sub-code
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
```

Helper:
```rust
pub fn err(code: u32) -> ProgramError { ProgramError::Custom(code) }
```

---

## 9. Client Side (TypeScript)

No auto-IDL from pinocchio. Manual instruction builders in `packages/common/src/instructions/strategy-token.ts`:

```typescript
export const STRATEGY_TOKEN_PROGRAM_ID = new PublicKey("Y13kaQZ6NJgyfLiL5VjZ9k5QaFJnw4REM4A5Gsfg9VV");

// Instruction discriminators
const IX_CREATE_STRATEGY = 0;
const IX_BUY_SHARES = 1;
const IX_REDEEM_SHARES = 2;
const IX_UPDATE_NAV = 3;
const IX_REBALANCE = 4;

export function buildCreateStrategyIx(args: {
  creator: PublicKey;
  depositMint: PublicKey;
  protocol: PublicKey;
  reserve: PublicKey;
  name: string;
  strategyType: 0 | 1;
  feeBps: number;
  minDeposit: bigint;
}): TransactionInstruction;

export function buildBuySharesIx(args: {
  buyer: PublicKey;
  strategy: PublicKey;
  amount: bigint;
  kaminoAccounts?: AccountMeta[];
}): TransactionInstruction;

export function buildRedeemSharesIx(args: { ... }): TransactionInstruction;
export function buildUpdateNavIx(args: { ... }): TransactionInstruction;
export function buildRebalanceIx(args: { ... }): TransactionInstruction;
```

### Kamino Account Resolution

The client needs to resolve ~19 Kamino accounts for Beethoven deposit/withdraw calls. This uses `@kamino-finance/klend-sdk` or raw RPC calls:

```typescript
export async function resolveKaminoDepositAccounts(
  connection: Connection,
  reserve: PublicKey,
  obligationOwner: PublicKey,
): Promise<AccountMeta[]>;
```

This function fetches the lending market, reserve state, obligation, farm accounts, and scope oracle — returning them in the exact order Beethoven's `KaminoDepositAccounts` expects.

### Account Deserialization

Manual deserializers matching the byte layout from Section 4:

```typescript
export function deserializeStrategy(data: Buffer): Strategy;
export function deserializeNavOracle(data: Buffer): NavOracle;
```

---

## 10. Beethoven Contribution Path

The following will be built inside our program first, validated on devnet, then extracted as upstream PRs:

| Component | Location in our repo | Future Beethoven PR |
|-----------|---------------------|---------------------|
| Kamino withdraw CPI | `cpi/kamino_withdraw.rs` | `crates/withdraw/kamino/` + `Withdraw` trait in `crates/core/` |
| Jupiter Perps position read | `cpi/jupiter_perps.rs` | `crates/perps/jupiter/` + `Perps` trait in `crates/core/` |
| Jupiter Perps close position | `cpi/jupiter_perps.rs` | Same PR as above |

**Withdraw trait** (to be contributed to `crates/core/src/lib.rs`):
```rust
pub trait Withdraw<'info> {
    type Accounts;
    type Data;
    fn withdraw_signed(ctx: &Self::Accounts, amount: u64, data: &Self::Data, signer_seeds: &[Signer]) -> ProgramResult;
    fn withdraw(ctx: &Self::Accounts, amount: u64, data: &Self::Data) -> ProgramResult;
}
```

**Perps trait** (new addition to `crates/core/src/lib.rs`):
```rust
pub trait Perps<'info> {
    type Accounts;
    type PositionData;
    type OpenData;
    fn read_position_value(ctx: &Self::Accounts) -> Result<u64, ProgramError>;
    fn open_position_signed(ctx: &Self::Accounts, data: &Self::OpenData, signer_seeds: &[Signer]) -> ProgramResult;
    fn close_position_signed(ctx: &Self::Accounts, signer_seeds: &[Signer]) -> ProgramResult;
}
```

---

## 11. Cross-Program Integration

### Prediction Market Resolution

The prediction market program (Anchor, Sean's domain) resolves by reading the Strategy account's `current_nav` field. Since this is just a byte read at a known offset, it's framework-agnostic:

```rust
// In prediction market program (Anchor)
let strategy_data = ctx.accounts.strategy.data.borrow();
let current_nav = u64::from_le_bytes(strategy_data[244..252].try_into().unwrap());
```

The prediction market also reads the NavOracle's `twap_value` for TWAP-based resolution:

```rust
let oracle_data = ctx.accounts.nav_oracle.data.borrow();
let twap_value = u64::from_le_bytes(oracle_data[48..56].try_into().unwrap());
```

No CPI between programs. Pure account data reads. This is why the prediction market can stay Anchor without any compatibility issues.

### Wallet PDA Token Accounts

The wallet PDA doesn't hold SOL — it holds SPL token positions:

- `wallet_token_ata` — ATA for `deposit_mint` (e.g., USDC). Receives deposits before Beethoven routes them.
- Kamino collateral token ATA — Created by Kamino during deposit. Holds cTokens.
- Jupiter Perps collateral — Held in the Perps position account (not an ATA).

For agent strategies, only `wallet_token_ata` is relevant. For yield strategies, the NAV is derived from protocol position accounts, not the wallet's deposit_mint ATA (which should be near-zero after Beethoven routes funds).

---

## 12. Testing Strategy

### Unit Tests

Use LiteSVM for fast in-process testing:

```rust
#[test]
fn test_buy_shares_first_deposit() { ... }
#[test]
fn test_buy_shares_proportional() { ... }
#[test]
fn test_redeem_with_performance_fee() { ... }
#[test]
fn test_update_nav_twap() { ... }
#[test]
fn test_snapshot_interval_enforcement() { ... }
```

The share math, TWAP accumulator, and performance fee calculation are pure functions that can be tested independently of account state.

### Integration Tests

Deploy to devnet with real Kamino interactions:
- Create a USDC yield strategy pointing to Kamino's USDC reserve
- Deposit USDC → verify Kamino cTokens received
- Wait for yield accrual → call update_nav → verify NAV increased
- Redeem shares → verify USDC returned with performance fee deducted

### CU Profiling

Measure compute units for each instruction on devnet:
- `buy_shares` with Beethoven deposit (expected: ~200-400K CU)
- `redeem_shares` with Kamino withdraw (expected: ~200-400K CU)
- `update_nav` with protocol read (expected: ~50-100K CU)
- `rebalance` multi-step (expected: varies by step count)

---

## 13. Migration Path

### From Current Anchor Code

The current Anchor strategy-token program is replaced entirely. The prediction market program is unaffected (different crate, different program ID).

Steps:
1. Create new pinocchio strategy-token in `programs/strategy-token/` (replaces existing)
2. Keep the same program ID (`Y13kaQZ6NJgyfLiL5VjZ9k5QaFJnw4REM4A5Gsfg9VV`)
3. The Anchor keypair JSON file still works — program ID is just an address
4. Update `packages/common` instruction builders to match new wire format
5. Prediction market program reads account data by byte offset (add constants for offsets)

### Workspace Cargo.toml

```toml
[workspace]
members = ["programs/strategy-token", "programs/prediction-market"]
resolver = "2"
```

Both programs coexist. Different frameworks, same workspace. The `cargo build` builds both. `anchor build` only builds the prediction market program. Strategy-token builds via `cargo build-sbf -p strategy-token`.

---

## 14. Out of Scope

- Prediction market program changes (stays Anchor, Sean's domain)
- Frontend/mobile screen changes (Junheng's domain)
- Beethoven upstream PRs (build first, PR after validation)
- Token-2022 support (standard SPL Token only for now)
- Multiple positions per strategy (one reserve/position per strategy)
- Governance / strategy parameter updates post-creation
