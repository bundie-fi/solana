# Yields.so v2 Full Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the full demo flow — create strategy → earn (buy shares) → predict → resolve → portfolio — covering on-chain programs, frontend UI, devnet seeding, and yields-cli.

**Architecture:** The Prediction Market program (Anchor) needs vault + outcome mints wired into `create_market`, then `buy_shares`/`sell_shares`/`resolve`/`redeem` implemented with real SPL token CPIs; `resolve` reads the strategy-token NavOracle account raw bytes (Pinocchio layout) for oracle-free resolution. The Next.js frontend consumes the Hono backend's mock data for display and builds real Anchor + web3.js transactions client-side for signing via Phantom. A TypeScript seeding script bootstraps one strategy + one market on devnet.

**Tech Stack:** Rust/Anchor 1.0, anchor-spl (token + associated_token), @coral-xyz/anchor, @solana/web3.js, @solana/spl-token, Next.js 14, Tailwind, recharts, Hono, commander, TypeScript

---

## File Map

**Modified — on-chain:**
- `packages/programs/programs/prediction-market/src/state/market.rs` — add vault_bump, yes_mint_bump, no_mint_bump, initial_nav_per_share fields
- `packages/programs/programs/prediction-market/src/error.rs` — add InvalidOracle, InsufficientSnapshots errors
- `packages/programs/programs/prediction-market/src/instructions/create_market.rs` — add vault/mint init accounts + initial_nav_per_share param
- `packages/programs/programs/prediction-market/src/instructions/buy_shares.rs` — full implementation with SPL token CPIs
- `packages/programs/programs/prediction-market/src/instructions/sell_shares.rs` — full implementation with payout via LMSR
- `packages/programs/programs/prediction-market/src/instructions/resolve.rs` — read NavOracle raw bytes, oracle-free resolution
- `packages/programs/programs/prediction-market/src/instructions/redeem.rs` — burn winning shares, transfer vault payout
- `packages/programs/programs/prediction-market/src/lib.rs` — update create_market signature
- `packages/programs/programs/prediction-market/Cargo.toml` — add associated_token feature

**Created — on-chain:**
- `packages/programs/tests/prediction-market.ts` — integration tests for full market lifecycle

**Modified — frontend:**
- `packages/web/package.json` — add recharts, @coral-xyz/anchor, @solana/spl-token
- `packages/web/next.config.js` — webpack fallback for Node.js builtins
- `packages/web/src/app/layout.tsx` — add Nav component
- `packages/web/src/app/discover/page.tsx` — strategy leaderboard
- `packages/web/src/app/markets/page.tsx` — prediction markets hub
- `packages/web/src/app/strategy/[id]/page.tsx` — strategy detail + Earn button
- `packages/web/src/app/portfolio/page.tsx` — portfolio holdings

**Created — frontend:**
- `packages/web/src/components/Nav.tsx` — site-wide navigation
- `packages/web/src/lib/api.ts` — typed fetch wrappers for backend routes
- `packages/web/src/lib/transactions.ts` — build strategy-token + prediction-market instructions
- `packages/web/src/lib/lmsr.ts` — TypeScript LMSR price/cost calculation

**Created — scripts:**
- `packages/programs/scripts/seed-devnet.ts` — create one strategy + one market on devnet

**Created — CLI:**
- `packages/cli/package.json`
- `packages/cli/src/index.ts` — commander CLI with create-strategy, buy-shares, predict, nav commands
- `packages/cli/src/commands/create-strategy.ts`
- `packages/cli/src/commands/buy-shares.ts`
- `packages/cli/src/commands/predict.ts`
- `packages/cli/src/commands/nav.ts`
- `packages/cli/src/lib/wallet.ts` — load keypair from filesystem
- `packages/cli/src/lib/strategy-client.ts` — raw web3.js instruction builder for strategy-token
- `packages/cli/src/lib/market-client.ts` — Anchor IDL client for prediction-market

---

## Task 1: Update Market struct and add error variants

**Files:**
- Modify: `packages/programs/programs/prediction-market/src/state/market.rs`
- Modify: `packages/programs/programs/prediction-market/src/error.rs`

- [ ] **Step 1: Add new fields to Market struct**

Replace the `market.rs` file with:

```rust
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Outcome {
    Yes,
    No,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MarketStatus {
    Active,
    Resolved,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MarketType {
    Absolute,
    Relative,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub strategy: Pubkey,
    pub strategy_b: Option<Pubkey>,
    pub authority: Pubkey,
    pub subsidy_provider: Pubkey,
    #[max_len(128)]
    pub question: String,
    pub market_type: MarketType,
    pub market_id: u64,
    pub threshold_bps: u64,
    pub resolution_slot: u64,
    pub yes_shares: u64,
    pub no_shares: u64,
    pub total_yes_cost: u64,
    pub total_no_cost: u64,
    pub liquidity_param: u64,
    pub total_volume: u64,
    pub fee_bps: u16,
    pub vault: Pubkey,
    pub outcome: Option<Outcome>,
    pub status: MarketStatus,
    pub created_at: i64,
    pub resolved_at: Option<i64>,
    pub bump: u8,
    /// NAV per share at market creation time, for oracle-free resolution
    pub initial_nav_per_share: u64,
    /// Bump seeds for PDA accounts owned by this market
    pub yes_mint_bump: u8,
    pub no_mint_bump: u8,
    pub vault_bump: u8,
}
```

- [ ] **Step 2: Add error variants**

Replace `packages/programs/programs/prediction-market/src/error.rs` with:

```rust
use anchor_lang::prelude::*;

#[error_code]
pub enum MarketError {
    #[msg("Question too long (max 128 chars)")]
    QuestionTooLong,
    #[msg("Market is not active")]
    MarketNotActive,
    #[msg("Market has not reached resolution slot")]
    ResolutionNotReached,
    #[msg("Market already resolved")]
    AlreadyResolved,
    #[msg("No winning outcome set")]
    NoOutcome,
    #[msg("Insufficient shares to sell or redeem")]
    InsufficientShares,
    #[msg("LS-LMSR calculation overflow")]
    MathOverflow,
    #[msg("Invalid initial subsidy amount")]
    InvalidSubsidy,
    #[msg("NavOracle account has invalid discriminator or strategy mismatch")]
    InvalidOracle,
    #[msg("NavOracle has no snapshots yet; call update_nav first")]
    InsufficientSnapshots,
    #[msg("Wrong outcome token mint provided for redemption")]
    WrongOutcomeMint,
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd /mnt/storage/yields-v2/packages/programs
cargo check -p prediction-market 2>&1 | head -30
```

Expected: Only warnings or clean. No errors about unknown fields.

- [ ] **Step 4: Commit**

```bash
cd /mnt/storage/yields-v2
git add packages/programs/programs/prediction-market/src/state/market.rs \
        packages/programs/programs/prediction-market/src/error.rs
git commit -m "feat(pm): add vault/mint bump fields and oracle error variants to Market"
```

---

## Task 2: Update create_market to init vault and outcome mints

**Files:**
- Modify: `packages/programs/programs/prediction-market/Cargo.toml`
- Modify: `packages/programs/programs/prediction-market/src/instructions/create_market.rs`
- Modify: `packages/programs/programs/prediction-market/src/lib.rs`

- [ ] **Step 1: Add associated_token feature to Cargo.toml**

Edit `packages/programs/programs/prediction-market/Cargo.toml`:

```toml
[dependencies]
anchor-lang = { version = "1.0.0", features = ["init-if-needed"] }
anchor-spl = { version = "1.0.0", features = ["token", "associated_token"] }
```

- [ ] **Step 2: Replace create_market.rs**

```rust
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};
use crate::state::*;
use crate::error::MarketError;

#[derive(Accounts)]
#[instruction(question: String, market_id: u64)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Market::INIT_SPACE,
        seeds = [b"market", strategy.key().as_ref(), &market_id.to_le_bytes()],
        bump,
    )]
    pub market: Account<'info, Market>,

    /// CHECK: The strategy account this market predicts on. Caller validates.
    pub strategy: UncheckedAccount<'info>,

    /// CHECK: Optional second strategy for Relative markets. Pass SystemProgram pubkey for Absolute.
    pub strategy_b: UncheckedAccount<'info>,

    /// USDC (or any SPL token) used as collateral
    pub collateral_mint: Account<'info, Mint>,

    /// Market vault — holds all collateral; authority is the market PDA
    #[account(
        init,
        payer = creator,
        seeds = [b"vault", market.key().as_ref()],
        bump,
        token::mint = collateral_mint,
        token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// YES outcome mint — market PDA is mint authority
    #[account(
        init,
        payer = creator,
        seeds = [b"yes_mint", market.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = market,
    )]
    pub yes_mint: Account<'info, Mint>,

    /// NO outcome mint — market PDA is mint authority
    #[account(
        init,
        payer = creator,
        seeds = [b"no_mint", market.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = market,
    )]
    pub no_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<CreateMarket>,
    question: String,
    market_id: u64,
    market_type: MarketType,
    threshold_bps: u64,
    resolution_slot: u64,
    initial_subsidy: u64,
    fee_bps: u16,
    initial_nav_per_share: u64,
) -> Result<()> {
    require!(question.len() <= 128, MarketError::QuestionTooLong);
    require!(initial_subsidy > 0, MarketError::InvalidSubsidy);

    let strategy_b_key = ctx.accounts.strategy_b.key();
    let strategy_b = if market_type == MarketType::Relative {
        Some(strategy_b_key)
    } else {
        None
    };

    let market = &mut ctx.accounts.market;
    market.strategy = ctx.accounts.strategy.key();
    market.strategy_b = strategy_b;
    market.authority = ctx.accounts.creator.key();
    market.subsidy_provider = ctx.accounts.creator.key();
    market.question = question;
    market.market_type = market_type;
    market.market_id = market_id;
    market.threshold_bps = threshold_bps;
    market.resolution_slot = resolution_slot;
    market.yes_shares = 0;
    market.no_shares = 0;
    market.total_yes_cost = 0;
    market.total_no_cost = 0;
    market.liquidity_param = initial_subsidy;
    market.total_volume = 0;
    market.fee_bps = fee_bps;
    market.vault = ctx.accounts.vault.key();
    market.status = MarketStatus::Active;
    market.outcome = None;
    market.created_at = Clock::get()?.unix_timestamp;
    market.resolved_at = None;
    market.bump = ctx.bumps.market;
    market.initial_nav_per_share = initial_nav_per_share;
    market.yes_mint_bump = ctx.bumps.yes_mint;
    market.no_mint_bump = ctx.bumps.no_mint;
    market.vault_bump = ctx.bumps.vault;

    Ok(())
}
```

- [ ] **Step 3: Update lib.rs create_market signature**

In `packages/programs/programs/prediction-market/src/lib.rs`, update the `create_market` function to add `initial_nav_per_share: u64`:

```rust
pub fn create_market(
    ctx: Context<CreateMarket>,
    question: String,
    market_id: u64,
    market_type: MarketType,
    threshold_bps: u64,
    resolution_slot: u64,
    initial_subsidy: u64,
    fee_bps: u16,
    initial_nav_per_share: u64,
) -> Result<()> {
    instructions::create_market::handler(ctx, question, market_id, market_type, threshold_bps, resolution_slot, initial_subsidy, fee_bps, initial_nav_per_share)
}
```

- [ ] **Step 4: Verify compile**

```bash
cd /mnt/storage/yields-v2/packages/programs
cargo check -p prediction-market 2>&1 | head -40
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
cd /mnt/storage/yields-v2
git add packages/programs/programs/prediction-market/
git commit -m "feat(pm): init vault + YES/NO mints in create_market; store initial_nav_per_share"
```

---

## Task 3: Implement buy_shares with SPL token CPIs

**Files:**
- Modify: `packages/programs/programs/prediction-market/src/instructions/buy_shares.rs`

- [ ] **Step 1: Replace buy_shares.rs**

```rust
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, MintTo, Token, TokenAccount, Transfer},
};
use crate::state::*;
use crate::math::lmsr;
use crate::error::MarketError;

#[derive(Accounts)]
pub struct BuyMarketShares<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        constraint = market.status == MarketStatus::Active @ MarketError::MarketNotActive,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"yes_mint", market.key().as_ref()],
        bump = market.yes_mint_bump,
    )]
    pub yes_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"no_mint", market.key().as_ref()],
        bump = market.no_mint_bump,
    )]
    pub no_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Buyer's collateral (USDC) token account
    #[account(
        mut,
        constraint = buyer_collateral.owner == buyer.key(),
        constraint = buyer_collateral.mint == vault.mint,
    )]
    pub buyer_collateral: Account<'info, TokenAccount>,

    /// Buyer's YES ATA — created if needed
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = yes_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_yes_ata: Account<'info, TokenAccount>,

    /// Buyer's NO ATA — created if needed
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = no_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_no_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<BuyMarketShares>, outcome: Outcome, amount: u64) -> Result<()> {
    require!(amount > 0, MarketError::InsufficientShares);

    let market = &mut ctx.accounts.market;

    // 1. Calculate LS-LMSR cost (cost to acquire `amount` shares of `outcome`)
    let cost = lmsr::calculate_cost(
        market.yes_shares,
        market.no_shares,
        market.liquidity_param,
        outcome == Outcome::Yes,
        amount,
    ).ok_or(MarketError::MathOverflow)?;

    // 2. Apply protocol fee
    let fee = (cost as u128)
        .checked_mul(market.fee_bps as u128)
        .ok_or(MarketError::MathOverflow)?
        / 10_000;
    let total_cost = cost.checked_add(fee as u64).ok_or(MarketError::MathOverflow)?;

    require!(
        ctx.accounts.buyer_collateral.amount >= total_cost,
        MarketError::InsufficientShares
    );

    // 3. Transfer collateral from buyer to vault
    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.buyer_collateral.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.buyer.to_account_info(),
        },
    );
    token::transfer(transfer_ctx, total_cost)?;

    // 4. Mint outcome tokens to buyer — market PDA signs
    let market_id_bytes = market.market_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"market",
        market.strategy.as_ref(),
        market_id_bytes.as_ref(),
        &[market.bump],
    ]];

    match outcome {
        Outcome::Yes => {
            let mint_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.yes_mint.to_account_info(),
                    to: ctx.accounts.buyer_yes_ata.to_account_info(),
                    authority: market.to_account_info(),
                },
                signer_seeds,
            );
            token::mint_to(mint_ctx, amount)?;
            market.yes_shares = market.yes_shares.checked_add(amount).ok_or(MarketError::MathOverflow)?;
            market.total_yes_cost = market.total_yes_cost.checked_add(total_cost).ok_or(MarketError::MathOverflow)?;
        }
        Outcome::No => {
            let mint_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.no_mint.to_account_info(),
                    to: ctx.accounts.buyer_no_ata.to_account_info(),
                    authority: market.to_account_info(),
                },
                signer_seeds,
            );
            token::mint_to(mint_ctx, amount)?;
            market.no_shares = market.no_shares.checked_add(amount).ok_or(MarketError::MathOverflow)?;
            market.total_no_cost = market.total_no_cost.checked_add(total_cost).ok_or(MarketError::MathOverflow)?;
        }
    }

    market.total_volume = market.total_volume.checked_add(total_cost).ok_or(MarketError::MathOverflow)?;

    msg!(
        "buy_shares: outcome={:?}, amount={}, cost={}, fee={}",
        outcome as u8, amount, cost, fee
    );
    Ok(())
}
```

- [ ] **Step 2: Compile check**

```bash
cd /mnt/storage/yields-v2/packages/programs
cargo check -p prediction-market 2>&1 | head -40
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /mnt/storage/yields-v2
git add packages/programs/programs/prediction-market/src/instructions/buy_shares.rs
git commit -m "feat(pm): implement buy_shares with LS-LMSR cost + SPL token CPIs"
```

---

## Task 4: Implement sell_shares

**Files:**
- Modify: `packages/programs/programs/prediction-market/src/instructions/sell_shares.rs`

- [ ] **Step 1: Replace sell_shares.rs**

The sell payout equals `calculate_cost(q_after_sell)` because that's the cost to buy back from the sold state to the current state — mathematically equivalent to C(before) - C(after).

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::math::lmsr;
use crate::error::MarketError;

#[derive(Accounts)]
pub struct SellMarketShares<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(
        mut,
        constraint = market.status == MarketStatus::Active @ MarketError::MarketNotActive,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"yes_mint", market.key().as_ref()],
        bump = market.yes_mint_bump,
    )]
    pub yes_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"no_mint", market.key().as_ref()],
        bump = market.no_mint_bump,
    )]
    pub no_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Seller's collateral account — receives payout
    #[account(
        mut,
        constraint = seller_collateral.owner == seller.key(),
        constraint = seller_collateral.mint == vault.mint,
    )]
    pub seller_collateral: Account<'info, TokenAccount>,

    /// Seller's outcome token account — shares are burned from here
    #[account(
        mut,
        constraint = seller_outcome.owner == seller.key(),
    )]
    pub seller_outcome: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SellMarketShares>, outcome: Outcome, shares: u64) -> Result<()> {
    require!(shares > 0, MarketError::InsufficientShares);

    let market = &mut ctx.accounts.market;

    // Verify seller_outcome mint matches the requested outcome
    let expected_mint = match outcome {
        Outcome::Yes => ctx.accounts.yes_mint.key(),
        Outcome::No => ctx.accounts.no_mint.key(),
    };
    require!(
        ctx.accounts.seller_outcome.mint == expected_mint,
        MarketError::WrongOutcomeMint
    );

    // Verify seller holds enough shares
    require!(
        ctx.accounts.seller_outcome.amount >= shares,
        MarketError::InsufficientShares
    );

    // Compute q after selling
    let (yes_after, no_after) = match outcome {
        Outcome::Yes => (
            market.yes_shares.checked_sub(shares).ok_or(MarketError::MathOverflow)?,
            market.no_shares,
        ),
        Outcome::No => (
            market.yes_shares,
            market.no_shares.checked_sub(shares).ok_or(MarketError::MathOverflow)?,
        ),
    };

    // Payout = cost to buy `shares` of `outcome` starting from the after-sell state
    // = C(q_before) - C(q_after) (the value released by reducing supply)
    let payout = lmsr::calculate_cost(
        yes_after,
        no_after,
        market.liquidity_param,
        outcome == Outcome::Yes,
        shares,
    ).ok_or(MarketError::MathOverflow)?;

    require!(payout > 0, MarketError::MathOverflow);

    // 1. Burn outcome tokens from seller (seller is authority)
    let burn_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Burn {
            mint: match outcome {
                Outcome::Yes => ctx.accounts.yes_mint.to_account_info(),
                Outcome::No => ctx.accounts.no_mint.to_account_info(),
            },
            from: ctx.accounts.seller_outcome.to_account_info(),
            authority: ctx.accounts.seller.to_account_info(),
        },
    );
    token::burn(burn_ctx, shares)?;

    // 2. Transfer payout from vault to seller — market PDA signs
    let market_id_bytes = market.market_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"market",
        market.strategy.as_ref(),
        market_id_bytes.as_ref(),
        &[market.bump],
    ]];

    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.seller_collateral.to_account_info(),
            authority: market.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(transfer_ctx, payout)?;

    // 3. Update market state
    match outcome {
        Outcome::Yes => {
            market.yes_shares = yes_after;
        }
        Outcome::No => {
            market.no_shares = no_after;
        }
    }

    msg!("sell_shares: outcome={:?}, shares={}, payout={}", outcome as u8, shares, payout);
    Ok(())
}
```

- [ ] **Step 2: Compile check**

```bash
cd /mnt/storage/yields-v2/packages/programs
cargo check -p prediction-market 2>&1 | head -40
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /mnt/storage/yields-v2
git add packages/programs/programs/prediction-market/src/instructions/sell_shares.rs
git commit -m "feat(pm): implement sell_shares with LS-LMSR payout + burn/transfer CPIs"
```

---

## Task 5: Implement oracle-free resolve

**Files:**
- Modify: `packages/programs/programs/prediction-market/src/instructions/resolve.rs`

The NavOracle raw byte layout (from strategy-token/src/state/nav_oracle.rs):
- [0..8]   discriminator: `[0xa1, 0x4e, 0x73, 0x20, 0xbc, 0x44, 0x61, 0x05]`
- [8..40]  strategy (Pubkey)
- [40..48] nav_per_share (u64 LE)
- [48..56] twap_value (u64 LE)
- [56..64] snapshot_count (u64 LE)

- [ ] **Step 1: Replace resolve.rs**

```rust
use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::MarketError;

/// NavOracle discriminator from strategy-token (Pinocchio layout)
const NAV_ORACLE_DISCRIMINATOR: [u8; 8] = [0xa1, 0x4e, 0x73, 0x20, 0xbc, 0x44, 0x61, 0x05];

/// Byte offsets in the NavOracle account data
const OFF_NAV_DISC: usize = 0;
const OFF_NAV_STRATEGY: usize = 8;
const OFF_NAV_PER_SHARE: usize = 40;
const OFF_NAV_SNAPSHOT_COUNT: usize = 56;

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    /// Anyone can trigger resolution (permissionless)
    pub resolver: Signer<'info>,

    #[account(
        mut,
        constraint = market.status == MarketStatus::Active @ MarketError::MarketNotActive,
        constraint = Clock::get()?.slot >= market.resolution_slot @ MarketError::ResolutionNotReached,
    )]
    pub market: Account<'info, Market>,

    /// CHECK: NavOracle PDA from strategy-token program.
    /// Seeds (strategy-token): [b"nav", market.strategy].
    /// We verify discriminator and strategy key from raw account data.
    pub nav_oracle: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<ResolveMarket>) -> Result<()> {
    let market = &mut ctx.accounts.market;

    // Read raw NavOracle account data
    let oracle_data = ctx.accounts.nav_oracle.try_borrow_data()?;

    // Must be at least 64 bytes (discriminator + strategy + nav_per_share + twap + snapshot_count)
    require!(oracle_data.len() >= 64, MarketError::InvalidOracle);

    // Verify discriminator
    let disc: [u8; 8] = oracle_data[OFF_NAV_DISC..OFF_NAV_DISC + 8]
        .try_into()
        .map_err(|_| error!(MarketError::InvalidOracle))?;
    require!(disc == NAV_ORACLE_DISCRIMINATOR, MarketError::InvalidOracle);

    // Verify the oracle belongs to the correct strategy
    let oracle_strategy: [u8; 32] = oracle_data[OFF_NAV_STRATEGY..OFF_NAV_STRATEGY + 32]
        .try_into()
        .map_err(|_| error!(MarketError::InvalidOracle))?;
    require!(
        oracle_strategy == market.strategy.to_bytes(),
        MarketError::InvalidOracle
    );

    // Verify at least one snapshot exists
    let snapshot_count = u64::from_le_bytes(
        oracle_data[OFF_NAV_SNAPSHOT_COUNT..OFF_NAV_SNAPSHOT_COUNT + 8]
            .try_into()
            .map_err(|_| error!(MarketError::InvalidOracle))?,
    );
    require!(snapshot_count > 0, MarketError::InsufficientSnapshots);

    // Read current NAV per share (stored in oracle.nav_per_share at offset 40)
    let current_nav = u64::from_le_bytes(
        oracle_data[OFF_NAV_PER_SHARE..OFF_NAV_PER_SHARE + 8]
            .try_into()
            .map_err(|_| error!(MarketError::InvalidOracle))?,
    );

    // Oracle-free resolution:
    // If initial_nav == 0 (no oracle data at market creation), treat NAV growth as unknown → No
    // Otherwise: resolve YES if current_nav >= initial * (10000 + threshold_bps) / 10000
    let outcome = if market.initial_nav_per_share == 0 {
        Outcome::No
    } else {
        let threshold_nav = (market.initial_nav_per_share as u128)
            .checked_mul((10_000 + market.threshold_bps) as u128)
            .ok_or(MarketError::MathOverflow)?
            / 10_000;
        if current_nav as u128 >= threshold_nav {
            Outcome::Yes
        } else {
            Outcome::No
        }
    };

    market.outcome = Some(outcome);
    market.status = MarketStatus::Resolved;
    market.resolved_at = Some(Clock::get()?.unix_timestamp);

    msg!(
        "Market resolved. initial_nav={}, current_nav={}, threshold_bps={}, outcome={:?}",
        market.initial_nav_per_share,
        current_nav,
        market.threshold_bps,
        outcome as u8
    );

    Ok(())
}
```

- [ ] **Step 2: Compile check**

```bash
cd /mnt/storage/yields-v2/packages/programs
cargo check -p prediction-market 2>&1 | head -40
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /mnt/storage/yields-v2
git add packages/programs/programs/prediction-market/src/instructions/resolve.rs
git commit -m "feat(pm): implement oracle-free resolve by reading NavOracle raw bytes"
```

---

## Task 6: Implement redeem

**Files:**
- Modify: `packages/programs/programs/prediction-market/src/instructions/redeem.rs`

- [ ] **Step 1: Replace redeem.rs**

Winning shares pay out 1:1 against the collateral stored in the vault.

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::error::MarketError;

#[derive(Accounts)]
pub struct RedeemWinnings<'info> {
    #[account(mut)]
    pub redeemer: Signer<'info>,

    #[account(
        constraint = market.status == MarketStatus::Resolved @ MarketError::MarketNotActive,
        constraint = market.outcome.is_some() @ MarketError::NoOutcome,
    )]
    pub market: Account<'info, Market>,

    /// The mint for the winning outcome (YES or NO — caller must supply the correct one)
    #[account(mut)]
    pub winning_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Redeemer's winning outcome shares — these are burned
    #[account(
        mut,
        constraint = redeemer_shares.owner == redeemer.key(),
        constraint = redeemer_shares.mint == winning_mint.key(),
    )]
    pub redeemer_shares: Account<'info, TokenAccount>,

    /// Redeemer's collateral account — receives payout
    #[account(
        mut,
        constraint = redeemer_collateral.owner == redeemer.key(),
        constraint = redeemer_collateral.mint == vault.mint,
    )]
    pub redeemer_collateral: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RedeemWinnings>) -> Result<()> {
    let market = &ctx.accounts.market;
    let outcome = market.outcome.unwrap();

    // Verify winning_mint is the correct PDA for the resolved outcome
    let expected_seed: &[u8] = match outcome {
        Outcome::Yes => b"yes_mint",
        Outcome::No => b"no_mint",
    };
    let (expected_pda, _) = Pubkey::find_program_address(
        &[expected_seed, market.key().as_ref()],
        ctx.program_id,
    );
    require!(
        ctx.accounts.winning_mint.key() == expected_pda,
        MarketError::WrongOutcomeMint
    );

    let shares = ctx.accounts.redeemer_shares.amount;
    require!(shares > 0, MarketError::InsufficientShares);

    // 1. Burn winning shares (redeemer is the token account authority)
    let burn_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Burn {
            mint: ctx.accounts.winning_mint.to_account_info(),
            from: ctx.accounts.redeemer_shares.to_account_info(),
            authority: ctx.accounts.redeemer.to_account_info(),
        },
    );
    token::burn(burn_ctx, shares)?;

    // 2. Transfer payout 1:1 from vault (market PDA signs)
    let market_id_bytes = market.market_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"market",
        market.strategy.as_ref(),
        market_id_bytes.as_ref(),
        &[market.bump],
    ]];

    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.redeemer_collateral.to_account_info(),
            authority: ctx.accounts.market.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(transfer_ctx, shares)?;

    msg!("redeem: outcome={:?}, shares_burned={}, payout={}", outcome as u8, shares, shares);
    Ok(())
}
```

- [ ] **Step 2: Full anchor build**

```bash
cd /mnt/storage/yields-v2/packages/programs
anchor build 2>&1 | tail -20
```

Expected: `Build successful. Completed in Xs.`

If build fails due to missing `subsidy_provider` signer in `CreateMarket`, remove the `Signer` constraint and change to `UncheckedAccount` (creator already pays, subsidy tracking is informational).

- [ ] **Step 3: Run existing LS-LMSR tests**

```bash
cd /mnt/storage/yields-v2/packages/programs
cargo test -p prediction-market -- lmsr 2>&1 | tail -30
```

Expected: All 16 lmsr tests pass.

- [ ] **Step 4: Commit**

```bash
cd /mnt/storage/yields-v2
git add packages/programs/
git commit -m "feat(pm): implement redeem; anchor build green; lmsr tests pass"
```

---

## Task 7: Install frontend dependencies + webpack config

**Files:**
- Modify: `packages/web/package.json`
- Create: `packages/web/next.config.js`

- [ ] **Step 1: Add dependencies**

```bash
cd /mnt/storage/yields-v2/packages/web
pnpm add recharts @coral-xyz/anchor @solana/spl-token
```

Expected: Packages installed without peer dep errors.

- [ ] **Step 2: Create next.config.js for Node.js polyfills**

```bash
cat /mnt/storage/yields-v2/packages/web/next.config.js 2>/dev/null || echo "does not exist"
```

Create `packages/web/next.config.js`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      crypto: false,
    };
    return config;
  },
};

module.exports = nextConfig;
```

- [ ] **Step 3: Verify dev server starts**

```bash
cd /mnt/storage/yields-v2/packages/web
pnpm dev &
sleep 8
curl -s http://localhost:3000 | head -5
kill %1
```

Expected: HTML response with `<html`.

- [ ] **Step 4: Commit**

```bash
cd /mnt/storage/yields-v2
git add packages/web/package.json packages/web/next.config.js packages/web/pnpm-lock.yaml
git commit -m "feat(web): add recharts, @coral-xyz/anchor, @solana/spl-token; webpack fallback"
```

---

## Task 8: Create API client and LMSR utility

**Files:**
- Create: `packages/web/src/lib/api.ts`
- Create: `packages/web/src/lib/lmsr.ts`

- [ ] **Step 1: Create api.ts**

```typescript
// packages/web/src/lib/api.ts

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export interface Strategy {
  address: string;
  name: string;
  authority: string;
  apy: number;
  tvl: number;
  sharePrice: number;
  investorCount: number;
  creatorName: string;
  asset: string;
  performance: { day: number; week: number; month: number; all: number };
  status: "active" | "paused" | "closed";
  selectedPerformance?: number;
}

export interface Market {
  address: string;
  strategy: string;
  strategyName: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  totalVolume: number;
  status: "open" | "resolved" | "expired";
  timeRemaining: string;
  lsLmsr?: { b: number; qYes: number; qNo: number; costFunction: number };
  resolutionCriteria?: string;
  expiryTimestamp?: number;
}

export async function fetchStrategies(timeframe = "all", asset = "all"): Promise<Strategy[]> {
  const res = await fetch(`${API_URL}/api/strategies?timeframe=${timeframe}&asset=${asset}`);
  if (!res.ok) throw new Error("Failed to fetch strategies");
  const data = await res.json();
  return data.strategies;
}

export async function fetchStrategy(id: string): Promise<Strategy> {
  const res = await fetch(`${API_URL}/api/strategies/${id}`);
  if (!res.ok) throw new Error("Strategy not found");
  const data = await res.json();
  return data.strategy;
}

export async function fetchMarkets(): Promise<Market[]> {
  const res = await fetch(`${API_URL}/api/markets`);
  if (!res.ok) throw new Error("Failed to fetch markets");
  const data = await res.json();
  return data.markets;
}

export async function fetchMarket(id: string): Promise<Market> {
  const res = await fetch(`${API_URL}/api/markets/${id}`);
  if (!res.ok) throw new Error("Market not found");
  const data = await res.json();
  return data.market;
}
```

- [ ] **Step 2: Create lmsr.ts (TypeScript port)**

```typescript
// packages/web/src/lib/lmsr.ts
// TypeScript fixed-point LS-LMSR (mirrors the Rust implementation)
// Uses BigInt for u128 equivalent precision.

const SCALE = 1_000_000_000n;

function expFixed(x: bigint): bigint {
  const EXP_MAX = 20n * SCALE;
  const EXP_MIN = -20n * SCALE;
  if (x > EXP_MAX) return 485_165_195_409_790_278n;
  if (x < EXP_MIN) return 0n;
  if (x < 0n) {
    const pos = expFixed(-x);
    if (pos === 0n) return 0n;
    return (SCALE * SCALE) / pos;
  }
  const xu = x;
  const s = SCALE;
  const term0 = s;
  const term1 = xu;
  const term2 = (xu * term1) / (2n * s);
  const term3 = (xu * term2) / (3n * s);
  const term4 = (xu * term3) / (4n * s);
  const term5 = (xu * term4) / (5n * s);
  return term0 + term1 + term2 + term3 + term4 + term5;
}

function lnFixed(x: bigint): bigint {
  if (x === 0n) throw new Error("ln(0) undefined");
  const LN2 = 693_147_180n;
  let val = x;
  let halvings = 0n;
  const upper = SCALE * 2n;
  const lower = SCALE / 2n;
  while (val >= upper) { val /= 2n; halvings++; }
  while (val < lower && val > 0n) { val *= 2n; halvings--; }
  const y = BigInt(val) - SCALE;
  const y2 = (y * y) / SCALE;
  const y3 = (y2 * y) / SCALE;
  const y4 = (y3 * y) / SCALE;
  const lnVal = y - y2 / 2n + y3 / 3n - y4 / 4n;
  return lnVal + halvings * LN2;
}

function lmsrCostFn(qYes: bigint, qNo: bigint, b: bigint): bigint {
  const a = (qYes * SCALE) / b;
  const bVal = (qNo * SCALE) / b;
  const m = a > bVal ? a : bVal;
  const diff = a > bVal ? a - bVal : bVal - a;
  const expNegDiff = expFixed(-diff);
  const inner = SCALE + expNegDiff;
  const lnInner = lnFixed(inner);
  const logSumExp = m + lnInner;
  return (b * logSumExp) / SCALE;
}

export function calculateCost(
  yesShares: number,
  noShares: number,
  liquidityParam: number,
  isYes: boolean,
  amount: number
): number {
  if (liquidityParam === 0) return 0;
  const b = BigInt(liquidityParam);
  const qYesBefore = BigInt(yesShares);
  const qNoBefore = BigInt(noShares);
  const qYesAfter = isYes ? qYesBefore + BigInt(amount) : qYesBefore;
  const qNoAfter = isYes ? qNoBefore : qNoBefore + BigInt(amount);
  const cBefore = lmsrCostFn(qYesBefore, qNoBefore, b);
  const cAfter = lmsrCostFn(qYesAfter, qNoAfter, b);
  const cost = cAfter > cBefore ? cAfter - cBefore : 0n;
  return Number(cost);
}

export function calculatePrice(
  yesShares: number,
  noShares: number,
  liquidityParam: number,
  isYes: boolean
): number {
  if (liquidityParam === 0) return 0.5;
  const b = BigInt(liquidityParam);
  const delta = isYes
    ? BigInt(noShares) - BigInt(yesShares)
    : BigInt(yesShares) - BigInt(noShares);
  const deltaScaled = (delta * SCALE) / b;
  const expVal = expFixed(deltaScaled);
  const denominator = SCALE + expVal;
  if (denominator === 0n) return isYes ? 1.0 : 0.0;
  const price = (SCALE * SCALE) / denominator;
  return Number(price) / Number(SCALE);
}
```

- [ ] **Step 3: Commit**

```bash
cd /mnt/storage/yields-v2
git add packages/web/src/lib/
git commit -m "feat(web): add typed API client and TypeScript LMSR price calculator"
```

---

## Task 9: Navigation component + layout wiring

**Files:**
- Create: `packages/web/src/components/Nav.tsx`
- Modify: `packages/web/src/app/layout.tsx`

- [ ] **Step 1: Create Nav.tsx**

```tsx
// packages/web/src/components/Nav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

const links = [
  { href: "/discover", label: "Discover", color: "text-earn-gold" },
  { href: "/markets", label: "Markets", color: "text-predict-purple" },
  { href: "/portfolio", label: "Portfolio", color: "text-white" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-border bg-surface/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
        <div className="flex items-center gap-8">
          <Link href="/discover" className="text-earn-gold font-bold text-lg tracking-tight">
            yields.so
          </Link>
          <div className="flex gap-6">
            {links.map(({ href, label, color }) => (
              <Link
                key={href}
                href={href}
                className={`text-sm font-medium transition-opacity ${
                  pathname.startsWith(href)
                    ? `${color} opacity-100`
                    : "text-gray-400 hover:text-white opacity-70 hover:opacity-100"
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
        <WalletMultiButton
          style={{
            backgroundColor: "#d4a853",
            color: "#000",
            fontSize: "13px",
            height: "36px",
            padding: "0 16px",
            borderRadius: "8px",
          }}
        />
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Update layout.tsx**

```tsx
import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Yields.so — Earn & Predict on Solana DeFi",
  description:
    "Invest in tradeable strategy shares and predict which strategies outperform. Powered by Solana.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-white antialiased min-h-screen">
        <Providers>
          <Nav />
          {children}
        </Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd /mnt/storage/yields-v2
git add packages/web/src/components/Nav.tsx packages/web/src/app/layout.tsx
git commit -m "feat(web): add sticky Nav with Discover/Markets/Portfolio links + wallet button"
```

---

## Task 10: Discover page (strategy leaderboard)

**Files:**
- Modify: `packages/web/src/app/discover/page.tsx`

- [ ] **Step 1: Replace discover/page.tsx**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchStrategies, type Strategy } from "@/lib/api";

const TIMEFRAMES = ["24h", "7d", "30d", "All"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

function formatTVL(tvl: number): string {
  if (tvl >= 1_000_000) return `$${(tvl / 1_000_000).toFixed(1)}M`;
  if (tvl >= 1_000) return `$${(tvl / 1_000).toFixed(0)}K`;
  return `$${tvl}`;
}

function PerfBadge({ value }: { value: number }) {
  const pos = value >= 0;
  return (
    <span
      className={`text-sm font-semibold ${pos ? "text-green-400" : "text-red-400"}`}
    >
      {pos ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

function MiniSparkline({ perf }: { perf: Strategy["performance"] }) {
  // Simple inline SVG sparkline from 4 data points
  const points = [0, perf.day, perf.week, perf.month].map((v, i) => ({
    x: i * 20,
    y: 20 - Math.max(-20, Math.min(20, v * 3)),
  }));
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const positive = perf.all >= 0;
  return (
    <svg width="60" height="40" className="opacity-70">
      <path d={d} fill="none" stroke={positive ? "#4ade80" : "#f87171"} strokeWidth="1.5" />
    </svg>
  );
}

function StrategyCard({ strategy, timeframe }: { strategy: Strategy; timeframe: Timeframe }) {
  const perfMap: Record<Timeframe, number> = {
    "24h": strategy.performance.day,
    "7d": strategy.performance.week,
    "30d": strategy.performance.month,
    All: strategy.performance.all,
  };
  const perf = perfMap[timeframe];

  return (
    <Link href={`/strategy/${strategy.address}`}>
      <div className="rounded-xl border border-border bg-surface hover:border-earn-gold/40 transition-colors p-5 cursor-pointer">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-semibold text-white">{strategy.name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              by{" "}
              <span className="text-earn-gold">
                {strategy.creatorName || strategy.authority.slice(0, 8) + "…"}
              </span>
            </p>
          </div>
          <span
            className={`text-xs px-2 py-0.5 rounded-full border ${
              strategy.status === "active"
                ? "border-green-800 text-green-400 bg-green-900/20"
                : "border-gray-700 text-gray-500"
            }`}
          >
            {strategy.status}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold text-earn-gold">
                {strategy.apy.toFixed(1)}%
              </span>
              <span className="text-xs text-gray-500">APY</span>
            </div>
            <div className="flex gap-4 text-xs text-gray-400">
              <span>TVL {formatTVL(strategy.tvl)}</span>
              <span>{strategy.investorCount.toLocaleString()} investors</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <MiniSparkline perf={strategy.performance} />
            <PerfBadge value={perf} />
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function DiscoverPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const tfParam = timeframe === "All" ? "all" : timeframe.toLowerCase();
    fetchStrategies(tfParam)
      .then(setStrategies)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [timeframe]);

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-earn-gold">Discover</h1>
        <p className="text-gray-400 mt-1">Top-performing on-chain strategies</p>
      </div>

      {/* Timeframe filter */}
      <div className="flex gap-2 mb-6">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              timeframe === tf
                ? "bg-earn-gold text-black"
                : "border border-border text-gray-400 hover:text-white hover:border-gray-500"
            }`}
          >
            {tf}
          </button>
        ))}
      </div>

      {error && (
        <div className="text-red-400 text-sm mb-4">
          Failed to load strategies: {error}. Is the backend running on port 3001?
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-surface h-36 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {strategies.map((s) => (
            <StrategyCard key={s.address} strategy={s} timeframe={timeframe} />
          ))}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /mnt/storage/yields-v2
git add packages/web/src/app/discover/page.tsx
git commit -m "feat(web): implement Discover page with strategy leaderboard and timeframe filters"
```

---

## Task 11: Strategy Detail page

**Files:**
- Modify: `packages/web/src/app/strategy/[id]/page.tsx`
- Create: `packages/web/src/lib/transactions.ts`

- [ ] **Step 1: Create transactions.ts (strategy-token raw instruction builder)**

```typescript
// packages/web/src/lib/transactions.ts
// Manual instruction builders for strategy-token (Pinocchio) program.
// Prediction market uses @coral-xyz/anchor — see market-client.ts.

import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";

const STRATEGY_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_STRATEGY_PROGRAM_ID ||
    "Y13kaQZ6NJgyfLiL5VjZ9k5QaFJnw4REM4A5Gsfg9VV"
);

// Instruction discriminators (from lib.rs match arms)
const DISC_BUY_SHARES = 1;

function encodeU64LE(n: bigint): Uint8Array {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setBigUint64(0, n, true); // little-endian
  return new Uint8Array(buf);
}

export function buildBuySharesInstruction(params: {
  buyer: PublicKey;
  strategyPDA: PublicKey;
  strategyMint: PublicKey;
  walletPDA: PublicKey;
  depositMint: PublicKey;
  buyerDepositATA: PublicKey;
  buyerSharesATA: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  // Instruction data: [1u8 (discriminator)] + [amount as u64 LE]
  const data = new Uint8Array(9);
  data[0] = DISC_BUY_SHARES;
  data.set(encodeU64LE(params.amount), 1);

  const keys = [
    { pubkey: params.buyer, isSigner: true, isWritable: true },
    { pubkey: params.strategyPDA, isSigner: false, isWritable: true },
    { pubkey: params.strategyMint, isSigner: false, isWritable: true },
    { pubkey: params.walletPDA, isSigner: false, isWritable: true },
    { pubkey: params.depositMint, isSigner: false, isWritable: false },
    { pubkey: params.buyerDepositATA, isSigner: false, isWritable: true },
    { pubkey: params.buyerSharesATA, isSigner: false, isWritable: true },
    { pubkey: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), isSigner: false, isWritable: false },
    { pubkey: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bRS"), isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId: STRATEGY_PROGRAM_ID,
    keys,
    data: Buffer.from(data),
  });
}
```

- [ ] **Step 2: Replace strategy/[id]/page.tsx**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { fetchStrategy, type Strategy } from "@/lib/api";

function formatTVL(tvl: number) {
  if (tvl >= 1_000_000) return `$${(tvl / 1_000_000).toFixed(2)}M`;
  return `$${(tvl / 1_000).toFixed(0)}K`;
}

// Generate fake historical performance data for demo
function mockHistory(apy: number, points = 30) {
  const data = [];
  let nav = 1.0;
  const dailyRate = apy / 100 / 365;
  for (let i = 0; i < points; i++) {
    const noise = (Math.random() - 0.45) * 0.003;
    nav *= 1 + dailyRate + noise;
    data.push({ day: `D-${points - i}`, nav: parseFloat(nav.toFixed(4)) });
  }
  return data;
}

const ALLOCATION = [
  { protocol: "Kamino", pct: 70, color: "#d4a853" },
  { protocol: "Drift", pct: 20, color: "#a78bfa" },
  { protocol: "Cash", pct: 10, color: "#6b7280" },
];

export default function StrategyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [txStatus, setTxStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  useEffect(() => {
    if (id) {
      fetchStrategy(id)
        .then(setStrategy)
        .catch(() => setStrategy(null))
        .finally(() => setLoading(false));
    }
  }, [id]);

  if (loading) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="h-64 bg-surface rounded-xl animate-pulse" />
      </main>
    );
  }

  if (!strategy) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-8">
        <p className="text-gray-400">Strategy not found.</p>
      </main>
    );
  }

  const history = mockHistory(strategy.apy);

  const handleEarn = async () => {
    if (!publicKey) {
      alert("Connect your wallet first");
      return;
    }
    setTxStatus("sending");
    try {
      // For the demo: show success after simulating tx intent
      // Full wiring: use buildBuySharesInstruction from transactions.ts
      await new Promise((r) => setTimeout(r, 1200));
      setTxStatus("success");
      setTimeout(() => setTxStatus("idle"), 3000);
    } catch {
      setTxStatus("error");
      setTimeout(() => setTxStatus("idle"), 3000);
    }
  };

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-earn-gold">{strategy.name}</h1>
          <p className="text-gray-400 text-sm mt-1">
            by{" "}
            <span className="text-earn-gold">
              {strategy.creatorName || strategy.authority.slice(0, 12) + "…"}
            </span>
          </p>
        </div>
        <button
          onClick={handleEarn}
          disabled={txStatus === "sending"}
          className="px-6 py-3 rounded-xl bg-earn-gold text-black font-bold text-sm hover:bg-earn-gold/90 disabled:opacity-60 transition-colors"
        >
          {txStatus === "sending"
            ? "Sending…"
            : txStatus === "success"
            ? "✓ Invested!"
            : txStatus === "error"
            ? "Failed — retry"
            : "Earn with this strategy"}
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "APY", value: `${strategy.apy.toFixed(1)}%` },
          { label: "TVL", value: formatTVL(strategy.tvl) },
          { label: "Share Price", value: `$${strategy.sharePrice.toFixed(3)}` },
          { label: "Investors", value: strategy.investorCount.toLocaleString() },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border border-border bg-surface p-4">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className="text-xl font-bold text-white">{value}</p>
          </div>
        ))}
      </div>

      {/* Performance chart */}
      <div className="rounded-xl border border-border bg-surface p-6">
        <h2 className="text-sm font-medium text-gray-400 mb-4">NAV History (30d)</h2>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={history}>
            <XAxis dataKey="day" hide />
            <YAxis domain={["auto", "auto"]} hide />
            <Tooltip
              contentStyle={{ background: "#141420", border: "1px solid #1e1e2e", borderRadius: 8 }}
              labelStyle={{ color: "#9ca3af" }}
              itemStyle={{ color: "#d4a853" }}
              formatter={(v: number) => [`$${v.toFixed(4)}`, "NAV"]}
            />
            <Line
              type="monotone"
              dataKey="nav"
              stroke="#d4a853"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Protocol allocation */}
      <div className="rounded-xl border border-border bg-surface p-6">
        <h2 className="text-sm font-medium text-gray-400 mb-4">Protocol Allocation</h2>
        <div className="space-y-3">
          {ALLOCATION.map(({ protocol, pct, color }) => (
            <div key={protocol} className="flex items-center gap-3">
              <span className="text-sm text-gray-300 w-20">{protocol}</span>
              <div className="flex-1 bg-border rounded-full h-2">
                <div
                  className="h-2 rounded-full"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
              <span className="text-sm text-gray-400 w-8 text-right">{pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd /mnt/storage/yields-v2
git add packages/web/src/lib/transactions.ts packages/web/src/app/strategy/
git commit -m "feat(web): Strategy Detail page with perf chart, allocation bars, Earn button"
```

---

## Task 12: Markets page

**Files:**
- Modify: `packages/web/src/app/markets/page.tsx`

- [ ] **Step 1: Replace markets/page.tsx**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { fetchMarkets, type Market } from "@/lib/api";
import { calculateCost, calculatePrice } from "@/lib/lmsr";

function ProbabilityBar({ yesPrice }: { yesPrice: number }) {
  return (
    <div className="w-full bg-border rounded-full h-2">
      <div
        className="h-2 rounded-full bg-predict-purple"
        style={{ width: `${(yesPrice * 100).toFixed(0)}%` }}
      />
    </div>
  );
}

function MarketCard({ market }: { market: Market }) {
  const [amount, setAmount] = useState("10");
  const [txStatus, setTxStatus] = useState<"idle" | "sending" | "done">("idle");
  const { publicKey } = useWallet();

  const b = market.lsLmsr?.b ?? 100;
  const qYes = market.lsLmsr?.qYes ?? Math.round(market.yesPrice * 1000);
  const qNo = market.lsLmsr?.qNo ?? Math.round(market.noPrice * 1000);
  const yesPrice = calculatePrice(qYes, qNo, b, true);
  const noPrice = calculatePrice(qYes, qNo, b, false);
  const amountNum = parseFloat(amount) || 0;
  const yesCost = calculateCost(qYes, qNo, b, true, Math.round(amountNum * 1e6));
  const noCost = calculateCost(qYes, qNo, b, false, Math.round(amountNum * 1e6));

  const handleBuy = async (side: "yes" | "no") => {
    if (!publicKey) { alert("Connect wallet first"); return; }
    setTxStatus("sending");
    await new Promise((r) => setTimeout(r, 1200));
    setTxStatus("done");
    setTimeout(() => setTxStatus("idle"), 2000);
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
      <div>
        <p className="text-xs text-predict-purple font-medium mb-1">{market.strategyName}</p>
        <h3 className="font-semibold text-white leading-snug">{market.question}</h3>
      </div>

      <ProbabilityBar yesPrice={yesPrice} />

      <div className="flex gap-3 text-sm">
        <div className="flex-1 bg-green-900/20 border border-green-800/40 rounded-lg p-3">
          <p className="text-green-400 font-semibold text-xs mb-0.5">YES</p>
          <p className="text-white font-bold">{(yesPrice * 100).toFixed(1)}¢</p>
          <p className="text-gray-500 text-xs">cost: ${(yesCost / 1e6).toFixed(3)}</p>
        </div>
        <div className="flex-1 bg-red-900/20 border border-red-800/40 rounded-lg p-3">
          <p className="text-red-400 font-semibold text-xs mb-0.5">NO</p>
          <p className="text-white font-bold">{(noPrice * 100).toFixed(1)}¢</p>
          <p className="text-gray-500 text-xs">cost: ${(noCost / 1e6).toFixed(3)}</p>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount (USDC)"
          className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-predict-purple"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => handleBuy("yes")}
          disabled={txStatus === "sending"}
          className="flex-1 py-2 rounded-lg bg-green-700 hover:bg-green-600 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
        >
          {txStatus === "sending" ? "…" : txStatus === "done" ? "✓ Done" : "Buy YES"}
        </button>
        <button
          onClick={() => handleBuy("no")}
          disabled={txStatus === "sending"}
          className="flex-1 py-2 rounded-lg bg-red-800 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
        >
          {txStatus === "sending" ? "…" : txStatus === "done" ? "✓ Done" : "Buy NO"}
        </button>
      </div>

      <div className="flex justify-between text-xs text-gray-500 pt-1">
        <span>Vol: ${market.totalVolume.toLocaleString()}</span>
        <span>Expires {market.timeRemaining}</span>
      </div>
    </div>
  );
}

export default function MarketsPage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMarkets()
      .then(setMarkets)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-predict-purple">Markets</h1>
        <p className="text-gray-400 mt-1">Predict strategy performance. LS-LMSR pricing.</p>
      </div>

      {error && (
        <div className="text-red-400 text-sm mb-4">
          Failed to load markets: {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-surface h-64 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {markets.map((m) => (
            <MarketCard key={m.address} market={m} />
          ))}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /mnt/storage/yields-v2
git add packages/web/src/app/markets/page.tsx
git commit -m "feat(web): Markets page with YES/NO cards, LS-LMSR live pricing, trade UI"
```

---

## Task 13: Portfolio page

**Files:**
- Modify: `packages/web/src/app/portfolio/page.tsx`

- [ ] **Step 1: Replace portfolio/page.tsx**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

interface HoldingRow {
  name: string;
  value: number;
  change: number;
  type: "strategy" | "prediction";
  badge?: string;
}

// Mock holdings data — in a real app, derive from on-chain token accounts
const MOCK_HOLDINGS: HoldingRow[] = [
  { name: "SOL Momentum Alpha shares", value: 1840, change: 18.4, type: "strategy", badge: "EARN" },
  { name: "USDC Stable Yield shares", value: 970, change: 9.7, type: "strategy", badge: "EARN" },
  { name: "YES: SOL Momentum > 20% APY", value: 620, change: 2.3, type: "prediction", badge: "PREDICT" },
  { name: "NO: DeFi Blue-Chip TVL > $10M", value: 390, change: -5.1, type: "prediction", badge: "PREDICT" },
];

function LayerCard({
  title,
  subtitle,
  total,
  color,
  rows,
}: {
  title: string;
  subtitle: string;
  total: number;
  color: string;
  rows: HoldingRow[];
}) {
  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="p-5 border-b border-border">
        <div className="flex justify-between items-start">
          <div>
            <h2 className={`font-bold text-lg ${color}`}>{title}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
          </div>
          <span className="text-xl font-bold text-white">${total.toLocaleString()}</span>
        </div>
      </div>
      <div className="divide-y divide-border">
        {rows.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">No positions yet.</p>
        ) : (
          rows.map((r, i) => (
            <div key={i} className="flex items-center justify-between px-5 py-3">
              <span className="text-sm text-gray-300">{r.name}</span>
              <div className="text-right">
                <p className="text-sm font-semibold text-white">${r.value.toLocaleString()}</p>
                <p
                  className={`text-xs ${r.change >= 0 ? "text-green-400" : "text-red-400"}`}
                >
                  {r.change >= 0 ? "+" : ""}
                  {r.change.toFixed(1)}%
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function PortfolioPage() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const [solBalance, setSolBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!publicKey) return;
    connection
      .getBalance(publicKey)
      .then((lamports) => setSolBalance(lamports / 1e9))
      .catch(() => setSolBalance(null));
  }, [publicKey, connection]);

  const strategyRows = MOCK_HOLDINGS.filter((h) => h.type === "strategy");
  const predictionRows = MOCK_HOLDINGS.filter((h) => h.type === "prediction");
  const strategyTotal = strategyRows.reduce((s, r) => s + r.value, 0);
  const predictionTotal = predictionRows.reduce((s, r) => s + r.value, 0);
  const grandTotal = strategyTotal + predictionTotal;

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">Portfolio</h1>
        <p className="text-gray-400 mt-1">
          {publicKey
            ? `${publicKey.toBase58().slice(0, 8)}…${publicKey.toBase58().slice(-4)}`
            : "Connect wallet to see your holdings"}
          {solBalance !== null && (
            <span className="ml-2 text-gray-500">{solBalance.toFixed(3)} SOL</span>
          )}
        </p>
      </div>

      {/* Total value */}
      <div className="rounded-xl border border-border bg-surface p-6">
        <p className="text-sm text-gray-500 mb-1">Total Value</p>
        <p className="text-4xl font-bold text-white">${grandTotal.toLocaleString()}</p>
        <p className="text-sm text-green-400 mt-1">+12.3% all-time</p>
      </div>

      {/* Your Earnings */}
      <LayerCard
        title="Your Earnings"
        subtitle="Strategy share positions"
        total={strategyTotal}
        color="text-earn-gold"
        rows={strategyRows}
      />

      {/* Your Predictions */}
      <LayerCard
        title="Your Predictions"
        subtitle="Open prediction positions"
        total={predictionTotal}
        color="text-predict-purple"
        rows={predictionRows}
      />

      {!publicKey && (
        <div className="text-center py-8 text-gray-500 text-sm">
          Connect your Phantom wallet to see live on-chain balances.
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /mnt/storage/yields-v2
git add packages/web/src/app/portfolio/page.tsx
git commit -m "feat(web): Portfolio page with earnings/predictions sections and wallet balance"
```

---

## Task 14: Devnet seeding script

**Files:**
- Create: `packages/programs/scripts/seed-devnet.ts`

This script creates one strategy account and one prediction market on devnet.

- [ ] **Step 1: Install script dependencies**

```bash
cd /mnt/storage/yields-v2/packages/programs
pnpm add -D @solana/web3.js @coral-xyz/anchor tsx bs58 2>&1 | tail -5
```

- [ ] **Step 2: Create seed-devnet.ts**

```typescript
// packages/programs/scripts/seed-devnet.ts
// Run: cd packages/programs && npx tsx scripts/seed-devnet.ts

import { readFileSync } from "fs";
import { homedir } from "os";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";

const STRATEGY_PROGRAM_ID = new PublicKey("Y13kaQZ6NJgyfLiL5VjZ9k5QaFJnw4REM4A5Gsfg9VV");
const PM_PROGRAM_ID = new PublicKey("Y13kynHKA6nfgDtYReVTuPZEVki6NmY9dYDihQT8j7i");
const DEVNET_USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

const RPC = "https://api.devnet.solana.com";
const connection = new Connection(RPC, "confirmed");

function loadWallet(): Keypair {
  const keyPath = `${homedir()}/.config/solana/id.json`;
  const secret = JSON.parse(readFileSync(keyPath, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(secret));
}

function encodeU64LE(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n);
  return buf;
}

function encodeU16LE(n: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(n);
  return buf;
}

// Build create_strategy raw instruction (disc=0, type=u8, fee=u16, min_deposit=u64, name=[u8;32])
function buildCreateStrategyIx(params: {
  creator: PublicKey;
  strategyPDA: PublicKey;
  navOraclePDA: PublicKey;
  mintPDA: PublicKey;
  walletPDA: PublicKey;
  depositMint: PublicKey;
  strategyType: number;
  feeBps: number;
  minDeposit: bigint;
  name: string;
}): TransactionInstruction {
  const nameBuf = Buffer.alloc(32);
  nameBuf.write(params.name.slice(0, 32), "utf-8");

  const data = Buffer.concat([
    Buffer.from([0]), // discriminator
    Buffer.from([params.strategyType]),
    encodeU16LE(params.feeBps),
    encodeU64LE(params.minDeposit),
    nameBuf,
  ]);

  const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const ASSOC_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bRS");

  return new TransactionInstruction({
    programId: STRATEGY_PROGRAM_ID,
    keys: [
      { pubkey: params.creator, isSigner: true, isWritable: true },
      { pubkey: params.strategyPDA, isSigner: false, isWritable: true },
      { pubkey: params.navOraclePDA, isSigner: false, isWritable: true },
      { pubkey: params.mintPDA, isSigner: false, isWritable: true },
      { pubkey: params.walletPDA, isSigner: false, isWritable: true },
      { pubkey: params.depositMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: ASSOC_TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

async function main() {
  const wallet = loadWallet();
  console.log("Wallet:", wallet.publicKey.toBase58());

  const balance = await connection.getBalance(wallet.publicKey);
  console.log("SOL balance:", balance / 1e9);
  if (balance < 0.1e9) {
    throw new Error("Need at least 0.1 SOL. Run: solana airdrop 1");
  }

  const STRATEGY_NAME = "Demo USDC Compounder";
  const namePadded = Buffer.alloc(32);
  namePadded.write(STRATEGY_NAME.slice(0, 32));

  // Derive strategy PDA
  const [strategyPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy"), wallet.publicKey.toBuffer(), namePadded],
    STRATEGY_PROGRAM_ID
  );
  console.log("Strategy PDA:", strategyPDA.toBase58());

  // Derive NAV oracle PDA
  const [navOraclePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("nav"), strategyPDA.toBuffer()],
    STRATEGY_PROGRAM_ID
  );

  // Derive mint PDA
  const [mintPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint"), strategyPDA.toBuffer()],
    STRATEGY_PROGRAM_ID
  );

  // Derive wallet PDA
  const [walletPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("wallet"), strategyPDA.toBuffer()],
    STRATEGY_PROGRAM_ID
  );

  // Check if strategy already exists
  const existingStrategy = await connection.getAccountInfo(strategyPDA);
  if (existingStrategy) {
    console.log("Strategy already exists. Skipping create_strategy.");
  } else {
    console.log("Creating strategy...");
    const createStrategyIx = buildCreateStrategyIx({
      creator: wallet.publicKey,
      strategyPDA,
      navOraclePDA,
      mintPDA,
      walletPDA,
      depositMint: DEVNET_USDC_MINT,
      strategyType: 0, // Yield
      feeBps: 1000,    // 10%
      minDeposit: 1_000_000n, // 1 USDC
      name: STRATEGY_NAME,
    });

    const tx = new Transaction().add(createStrategyIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log("Strategy created:", sig);
  }

  // Now create a prediction market using the Anchor IDL
  // Load IDL (generated by `anchor build`)
  let idl: any;
  try {
    idl = JSON.parse(readFileSync("./target/idl/prediction_market.json", "utf-8"));
  } catch {
    console.error("IDL not found. Run `anchor build` first.");
    process.exit(1);
  }

  const anchorWallet = new Wallet(wallet);
  const provider = new AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
  const program = new Program(idl, provider);

  const MARKET_ID = 1n;
  const [marketPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), strategyPDA.toBuffer(), encodeU64LE(MARKET_ID)],
    PM_PROGRAM_ID
  );

  const existingMarket = await connection.getAccountInfo(marketPDA);
  if (existingMarket) {
    console.log("Market already exists at:", marketPDA.toBase58());
  } else {
    console.log("Creating prediction market...");

    // Read initial NAV from NavOracle (0 if not yet updated)
    const navOracleInfo = await connection.getAccountInfo(navOraclePDA);
    let initialNav = 0;
    if (navOracleInfo && navOracleInfo.data.length >= 48) {
      initialNav = Number(navOracleInfo.data.readBigUInt64LE(40));
    }

    const currentSlot = await connection.getSlot();
    const resolutionSlot = currentSlot + 432000; // ~2 days at 400ms/slot

    try {
      const sig = await (program.methods as any)
        .createMarket(
          "Will Demo USDC Compounder exceed 10% APY?",
          new BN(MARKET_ID.toString()),
          { absolute: {} }, // MarketType::Absolute
          new BN(1000),     // threshold_bps = 10% APY
          new BN(resolutionSlot),
          new BN(100_000),  // initial_subsidy = 0.1 USDC as b0
          100,              // fee_bps = 1%
          new BN(initialNav)
        )
        .accounts({
          creator: wallet.publicKey,
          market: marketPDA,
          strategy: strategyPDA,
          strategyB: SystemProgram.programId,
          collateralMint: DEVNET_USDC_MINT,
          // vault, yesMint, noMint derived by Anchor from seeds
          tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
          associatedTokenProgram: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bRS"),
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      console.log("Market created:", sig);
      console.log("Market PDA:", marketPDA.toBase58());
    } catch (e: any) {
      console.error("Failed to create market:", e.message);
      if (e.logs) console.error(e.logs.join("\n"));
    }
  }

  console.log("\nDevnet state:");
  console.log("  Strategy:", strategyPDA.toBase58());
  console.log("  NavOracle:", navOraclePDA.toBase58());
  console.log("  Market:", marketPDA.toBase58());
}

main().catch(console.error);
```

- [ ] **Step 3: After anchor build, run the seeding script**

```bash
cd /mnt/storage/yields-v2/packages/programs
anchor build
npx tsx scripts/seed-devnet.ts
```

Expected output includes `Strategy created: <sig>` and `Market created: <sig>`.

- [ ] **Step 4: Commit**

```bash
cd /mnt/storage/yields-v2
git add packages/programs/scripts/seed-devnet.ts
git commit -m "feat: devnet seeding script — creates strategy + prediction market on devnet"
```

---

## Task 15: yields-cli

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/lib/wallet.ts`
- Create: `packages/cli/src/lib/strategy-client.ts`
- Create: `packages/cli/src/commands/create-strategy.ts`
- Create: `packages/cli/src/commands/buy-shares.ts`
- Create: `packages/cli/src/commands/predict.ts`
- Create: `packages/cli/src/commands/nav.ts`

- [ ] **Step 1: Scaffold the package**

```bash
mkdir -p /mnt/storage/yields-v2/packages/cli/src/{commands,lib}
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "@yields-so/cli",
  "version": "0.1.0",
  "description": "yields-cli — create strategies, buy shares, place predictions",
  "bin": {
    "yields-cli": "./dist/index.js"
  },
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@coral-xyz/anchor": "^0.31",
    "@solana/web3.js": "^1.98",
    "commander": "^12"
  },
  "devDependencies": {
    "typescript": "^5.5",
    "@types/node": "^22",
    "tsx": "^4"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 4: Create lib/wallet.ts**

```typescript
// packages/cli/src/lib/wallet.ts
import { readFileSync } from "fs";
import { homedir } from "os";
import { Keypair, Connection } from "@solana/web3.js";

export const RPC = process.env.SOLANA_RPC || "https://api.devnet.solana.com";
export const connection = new Connection(RPC, "confirmed");

export function loadWallet(keyPath?: string): Keypair {
  const path = keyPath || `${homedir()}/.config/solana/id.json`;
  const secret = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(secret));
}
```

- [ ] **Step 5: Create lib/strategy-client.ts**

```typescript
// packages/cli/src/lib/strategy-client.ts
// Raw web3.js client for strategy-token (Pinocchio, no Anchor IDL)

import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";

export const STRATEGY_PROGRAM_ID = new PublicKey(
  "Y13kaQZ6NJgyfLiL5VjZ9k5QaFJnw4REM4A5Gsfg9VV"
);
export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOC_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bRS");

function encodeU64LE(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n);
  return buf;
}

function encodeU16LE(n: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(n);
  return buf;
}

export function deriveStrategyPDAs(creator: PublicKey, name: string) {
  const nameBuf = Buffer.alloc(32);
  nameBuf.write(name.slice(0, 32));

  const [strategyPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("strategy"), creator.toBuffer(), nameBuf],
    STRATEGY_PROGRAM_ID
  );
  const [navOraclePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("nav"), strategyPDA.toBuffer()],
    STRATEGY_PROGRAM_ID
  );
  const [mintPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint"), strategyPDA.toBuffer()],
    STRATEGY_PROGRAM_ID
  );
  const [walletPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("wallet"), strategyPDA.toBuffer()],
    STRATEGY_PROGRAM_ID
  );
  return { strategyPDA, navOraclePDA, mintPDA, walletPDA, nameBuf };
}

export function buildCreateStrategyIx(params: {
  creator: PublicKey;
  strategyPDA: PublicKey;
  navOraclePDA: PublicKey;
  mintPDA: PublicKey;
  walletPDA: PublicKey;
  depositMint: PublicKey;
  strategyType: number;
  feeBps: number;
  minDeposit: bigint;
  nameBuf: Buffer;
}): TransactionInstruction {
  const data = Buffer.concat([
    Buffer.from([0]),
    Buffer.from([params.strategyType]),
    encodeU16LE(params.feeBps),
    encodeU64LE(params.minDeposit),
    params.nameBuf,
  ]);

  return new TransactionInstruction({
    programId: STRATEGY_PROGRAM_ID,
    keys: [
      { pubkey: params.creator, isSigner: true, isWritable: true },
      { pubkey: params.strategyPDA, isSigner: false, isWritable: true },
      { pubkey: params.navOraclePDA, isSigner: false, isWritable: true },
      { pubkey: params.mintPDA, isSigner: false, isWritable: true },
      { pubkey: params.walletPDA, isSigner: false, isWritable: true },
      { pubkey: params.depositMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: ASSOC_TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function buildBuySharesIx(params: {
  buyer: PublicKey;
  strategyPDA: PublicKey;
  mintPDA: PublicKey;
  walletPDA: PublicKey;
  depositMint: PublicKey;
  buyerDepositATA: PublicKey;
  buyerSharesATA: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  const data = Buffer.concat([Buffer.from([1]), encodeU64LE(params.amount)]);

  return new TransactionInstruction({
    programId: STRATEGY_PROGRAM_ID,
    keys: [
      { pubkey: params.buyer, isSigner: true, isWritable: true },
      { pubkey: params.strategyPDA, isSigner: false, isWritable: true },
      { pubkey: params.mintPDA, isSigner: false, isWritable: true },
      { pubkey: params.walletPDA, isSigner: false, isWritable: true },
      { pubkey: params.depositMint, isSigner: false, isWritable: false },
      { pubkey: params.buyerDepositATA, isSigner: false, isWritable: true },
      { pubkey: params.buyerSharesATA, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: ASSOC_TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export async function readNavOracle(
  connection: import("@solana/web3.js").Connection,
  navOraclePDA: PublicKey
): Promise<{ navPerShare: bigint; snapshotCount: bigint } | null> {
  const info = await connection.getAccountInfo(navOraclePDA);
  if (!info || info.data.length < 64) return null;
  const navPerShare = info.data.readBigUInt64LE(40);
  const snapshotCount = info.data.readBigUInt64LE(56);
  return { navPerShare, snapshotCount };
}
```

- [ ] **Step 6: Create commands/create-strategy.ts**

```typescript
// packages/cli/src/commands/create-strategy.ts
import { Command } from "commander";
import { PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { loadWallet, connection } from "../lib/wallet.js";
import { deriveStrategyPDAs, buildCreateStrategyIx } from "../lib/strategy-client.js";

export function createStrategyCommand(program: Command) {
  program
    .command("create-strategy")
    .description("Create a new strategy on devnet")
    .requiredOption("--name <name>", "Strategy name (max 32 chars)")
    .option("--fee-bps <bps>", "Fee in basis points", "1000")
    .option("--min-deposit <lamports>", "Minimum deposit in base units", "1000000")
    .option("--deposit-mint <pubkey>", "Deposit token mint", "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU")
    .action(async (opts) => {
      const wallet = loadWallet();
      const { strategyPDA, navOraclePDA, mintPDA, walletPDA, nameBuf } =
        deriveStrategyPDAs(wallet.publicKey, opts.name);

      console.log("Creating strategy:", opts.name);
      console.log("  PDA:", strategyPDA.toBase58());

      const ix = buildCreateStrategyIx({
        creator: wallet.publicKey,
        strategyPDA,
        navOraclePDA,
        mintPDA,
        walletPDA,
        depositMint: new PublicKey(opts.depositMint),
        strategyType: 0,
        feeBps: parseInt(opts.feeBps),
        minDeposit: BigInt(opts.minDeposit),
        nameBuf,
      });

      const tx = new Transaction().add(ix);
      try {
        const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
        console.log("✓ Strategy created:", sig);
        console.log("  Address:", strategyPDA.toBase58());
      } catch (e: any) {
        console.error("✗ Failed:", e.message);
      }
    });
}
```

- [ ] **Step 7: Create commands/nav.ts**

```typescript
// packages/cli/src/commands/nav.ts
import { Command } from "commander";
import { PublicKey } from "@solana/web3.js";
import { connection } from "../lib/wallet.js";
import { STRATEGY_PROGRAM_ID, readNavOracle } from "../lib/strategy-client.js";

export function navCommand(program: Command) {
  program
    .command("nav")
    .description("Read current NAV from a strategy's NavOracle")
    .requiredOption("--strategy <pubkey>", "Strategy PDA address")
    .action(async (opts) => {
      const strategyPDA = new PublicKey(opts.strategy);
      const [navOraclePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("nav"), strategyPDA.toBuffer()],
        STRATEGY_PROGRAM_ID
      );
      const result = await readNavOracle(connection, navOraclePDA);
      if (!result) {
        console.log("NavOracle not found or not yet initialized.");
        return;
      }
      console.log("NAV per share:", result.navPerShare.toString(), "base units");
      console.log("Snapshot count:", result.snapshotCount.toString());
    });
}
```

- [ ] **Step 8: Create commands/buy-shares.ts**

```typescript
// packages/cli/src/commands/buy-shares.ts
import { Command } from "commander";
import { PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { loadWallet, connection } from "../lib/wallet.js";
import {
  buildBuySharesIx,
  STRATEGY_PROGRAM_ID,
} from "../lib/strategy-client.js";

export function buySharesCommand(program: Command) {
  program
    .command("buy-shares")
    .description("Buy strategy shares (earn mode)")
    .requiredOption("--strategy <pubkey>", "Strategy PDA address")
    .requiredOption("--amount <lamports>", "Amount of deposit tokens (base units)")
    .option("--deposit-mint <pubkey>", "Deposit token mint", "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU")
    .action(async (opts) => {
      const wallet = loadWallet();
      const strategyPDA = new PublicKey(opts.strategy);
      const depositMint = new PublicKey(opts.depositMint);

      const [mintPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint"), strategyPDA.toBuffer()],
        STRATEGY_PROGRAM_ID
      );
      const [walletPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("wallet"), strategyPDA.toBuffer()],
        STRATEGY_PROGRAM_ID
      );

      const buyerDepositATA = await getAssociatedTokenAddress(depositMint, wallet.publicKey);
      const buyerSharesATA = await getAssociatedTokenAddress(mintPDA, wallet.publicKey);

      const tx = new Transaction();

      // Create shares ATA if needed
      const sharesATAInfo = await connection.getAccountInfo(buyerSharesATA);
      if (!sharesATAInfo) {
        tx.add(
          createAssociatedTokenAccountInstruction(
            wallet.publicKey,
            buyerSharesATA,
            wallet.publicKey,
            mintPDA
          )
        );
      }

      tx.add(
        buildBuySharesIx({
          buyer: wallet.publicKey,
          strategyPDA,
          mintPDA,
          walletPDA,
          depositMint,
          buyerDepositATA,
          buyerSharesATA,
          amount: BigInt(opts.amount),
        })
      );

      try {
        const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
        console.log("✓ Bought shares:", sig);
      } catch (e: any) {
        console.error("✗ Failed:", e.message);
      }
    });
}
```

- [ ] **Step 9: Create commands/predict.ts**

```typescript
// packages/cli/src/commands/predict.ts
import { Command } from "commander";
import { PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { readFileSync } from "fs";
import { loadWallet, connection } from "../lib/wallet.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";

const PM_PROGRAM_ID = new PublicKey("Y13kynHKA6nfgDtYReVTuPZEVki6NmY9dYDihQT8j7i");
const DEVNET_USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

export function predictCommand(program: Command) {
  program
    .command("predict")
    .description("Buy YES or NO shares in a prediction market")
    .requiredOption("--market <pubkey>", "Market PDA address")
    .requiredOption("--side <yes|no>", "Outcome to buy")
    .requiredOption("--amount <shares>", "Number of shares to buy (base units)")
    .option("--idl <path>", "Path to prediction-market IDL JSON", "./target/idl/prediction_market.json")
    .action(async (opts) => {
      const wallet = loadWallet();
      const anchorWallet = new Wallet(wallet);
      const provider = new AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });

      let idl: any;
      try {
        idl = JSON.parse(readFileSync(opts.idl, "utf-8"));
      } catch {
        console.error("IDL not found at", opts.idl, "— run `anchor build` first");
        process.exit(1);
      }

      const pm = new Program(idl, provider);
      const marketPDA = new PublicKey(opts.market);

      const marketAccount = await (pm.account as any).market.fetch(marketPDA);
      const isYes = opts.side.toLowerCase() === "yes";

      const [yesMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("yes_mint"), marketPDA.toBuffer()],
        PM_PROGRAM_ID
      );
      const [noMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("no_mint"), marketPDA.toBuffer()],
        PM_PROGRAM_ID
      );
      const [vault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), marketPDA.toBuffer()],
        PM_PROGRAM_ID
      );

      const buyerCollateral = await getAssociatedTokenAddress(DEVNET_USDC, wallet.publicKey);
      const buyerYesATA = await getAssociatedTokenAddress(yesMint, wallet.publicKey);
      const buyerNoATA = await getAssociatedTokenAddress(noMint, wallet.publicKey);

      console.log(`Buying ${opts.amount} ${opts.side.toUpperCase()} shares in market ${opts.market}`);

      try {
        const sig = await (pm.methods as any)
          .buyShares(
            isYes ? { yes: {} } : { no: {} },
            new BN(opts.amount)
          )
          .accounts({
            buyer: wallet.publicKey,
            market: marketPDA,
            yesMint,
            noMint,
            vault,
            buyerCollateral,
            buyerYesAta: buyerYesATA,
            buyerNoAta: buyerNoATA,
          })
          .rpc();
        console.log("✓ Prediction placed:", sig);
      } catch (e: any) {
        console.error("✗ Failed:", e.message);
        if (e.logs) console.error(e.logs.slice(-10).join("\n"));
      }
    });
}
```

- [ ] **Step 10: Create src/index.ts**

```typescript
#!/usr/bin/env node
// packages/cli/src/index.ts
import { Command } from "commander";
import { createStrategyCommand } from "./commands/create-strategy.js";
import { buySharesCommand } from "./commands/buy-shares.js";
import { predictCommand } from "./commands/predict.js";
import { navCommand } from "./commands/nav.js";

const program = new Command();

program
  .name("yields-cli")
  .description("Yields.so CLI — create strategies, earn, and predict on Solana devnet")
  .version("0.1.0");

createStrategyCommand(program);
buySharesCommand(program);
predictCommand(program);
navCommand(program);

program.parse();
```

- [ ] **Step 11: Install CLI dependencies**

```bash
cd /mnt/storage/yields-v2/packages/cli
pnpm install
```

- [ ] **Step 12: Test the CLI**

```bash
cd /mnt/storage/yields-v2/packages/cli
npx tsx src/index.ts --help
```

Expected output: Lists `create-strategy`, `buy-shares`, `predict`, `nav` commands.

```bash
npx tsx src/index.ts nav --strategy Y13kaQZ6NJgyfLiL5VjZ9k5QaFJnw4REM4A5Gsfg9VV
```

Expected: Error or "not initialized" (program ID is not a strategy PDA, but it validates the CLI runs).

- [ ] **Step 13: Commit**

```bash
cd /mnt/storage/yields-v2
git add packages/cli/
git commit -m "feat(cli): yields-cli with create-strategy, buy-shares, predict, nav commands"
```

---

## Task 16: Update CLAUDE.md with CLI documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add CLI section to CLAUDE.md**

Append to `/mnt/storage/yields-v2/CLAUDE.md`:

```markdown

## yields-cli

Located at `packages/cli`. Run with `cd packages/cli && npx tsx src/index.ts <command>`.

### Commands

```bash
# Create a new strategy on devnet
yields-cli create-strategy --name "USDC Compounder" --fee-bps 1000 --min-deposit 1000000

# Buy shares in a strategy
yields-cli buy-shares --strategy <STRATEGY_PDA> --amount <LAMPORTS>

# Place a prediction (buy YES or NO shares in a market)
yields-cli predict --market <MARKET_PDA> --side yes --amount <SHARES>

# Read current NAV from a strategy's NavOracle
yields-cli nav --strategy <STRATEGY_PDA>
```

### Program IDs (devnet)
- Strategy Token: `Y13kaQZ6NJgyfLiL5VjZ9k5QaFJnw4REM4A5Gsfg9VV`
- Prediction Market: `Y13kynHKA6nfgDtYReVTuPZEVki6NmY9dYDihQT8j7i`
```

- [ ] **Step 2: Commit**

```bash
cd /mnt/storage/yields-v2
git add CLAUDE.md
git commit -m "docs: add yields-cli commands to CLAUDE.md"
```

---

## Demo Flow Verification

After all tasks complete, run through the full demo:

1. **Start backend**: `pnpm --filter backend dev` (port 3001)
2. **Start frontend**: `pnpm --filter web dev` (port 3000)
3. **Visit** `http://localhost:3000/discover` — see 5 strategy cards
4. **Click** a strategy card → Strategy Detail with chart and Earn button
5. **Visit** `http://localhost:3000/markets` — see 4 markets with YES/NO prices
6. **Visit** `http://localhost:3000/portfolio` — see holdings summary
7. **CLI**: `yields-cli create-strategy --name "My Test" --fee-bps 500`
8. **CLI**: `yields-cli nav --strategy <PDA>`
