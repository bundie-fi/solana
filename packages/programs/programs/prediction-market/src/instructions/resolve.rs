use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::MarketError;

/// NavOracle discriminator — must match strategy-token/src/state/nav_oracle.rs
const NAV_ORACLE_DISCRIMINATOR: [u8; 8] = [0xa1, 0x4e, 0x73, 0x20, 0xbc, 0x44, 0x61, 0x05];

/// Field byte offsets within the NavOracle account data
const OFF_ORACLE_STRATEGY: usize = 8;   // Pubkey (32 bytes)
const OFF_ORACLE_TWAP: usize = 48;      // twap_value u64 (8 bytes)
const OFF_ORACLE_SNAPSHOTS: usize = 56; // snapshot_count u64 (8 bytes)

const NAV_ORACLE_MIN_LEN: usize = 89;

/// Seconds in a year for APY annualization
const SECONDS_PER_YEAR: u128 = 31_536_000;

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

    /// NavOracle for strategy A.
    /// PDA seeds (strategy-token): ["nav_oracle", market.strategy].
    /// Validated in handler: discriminator + strategy key.
    /// CHECK: Manual validation in handler.
    pub nav_oracle: UncheckedAccount<'info>,

    /// NavOracle for strategy B (Relative markets only).
    /// Pass SystemProgram id for Absolute markets — ignored and not validated.
    /// CHECK: Manual validation in handler.
    pub nav_oracle_b: UncheckedAccount<'info>,
}

/// Read and validate a NavOracle account, returning (twap, snapshot_count, strategy_key).
fn read_oracle(
    oracle: &UncheckedAccount,
    expected_strategy: &Pubkey,
) -> Result<(u64, u64)> {
    let data = oracle.try_borrow_data()?;

    require!(
        data.len() >= NAV_ORACLE_MIN_LEN
            && data[0..8] == NAV_ORACLE_DISCRIMINATOR,
        MarketError::InvalidOracle
    );

    let strategy: [u8; 32] = data[OFF_ORACLE_STRATEGY..OFF_ORACLE_STRATEGY + 32]
        .try_into()
        .unwrap();
    require!(
        strategy == expected_strategy.to_bytes(),
        MarketError::InvalidOracle
    );

    let twap = u64::from_le_bytes(
        data[OFF_ORACLE_TWAP..OFF_ORACLE_TWAP + 8].try_into().unwrap(),
    );
    let snapshots = u64::from_le_bytes(
        data[OFF_ORACLE_SNAPSHOTS..OFF_ORACLE_SNAPSHOTS + 8].try_into().unwrap(),
    );

    require!(snapshots > 0, MarketError::InsufficientSnapshots);

    Ok((twap, snapshots))
}

/// Compute annualized growth in basis points relative to an initial NAV.
/// Returns None if initial_nav is 0 or there's no growth.
fn annualized_growth_bps(twap: u64, initial_nav: u64, elapsed_secs: u128) -> u128 {
    if initial_nav == 0 || twap <= initial_nav {
        return 0;
    }
    let growth_bps = (twap - initial_nav) as u128 * 10_000 / initial_nav as u128;
    growth_bps
        .checked_mul(SECONDS_PER_YEAR)
        .unwrap_or(u128::MAX)
        / elapsed_secs
}

pub fn handler(ctx: Context<ResolveMarket>) -> Result<()> {
    let market_type = ctx.accounts.market.market_type;
    let now = Clock::get()?.unix_timestamp;
    let elapsed_secs = (now - ctx.accounts.market.created_at).max(1) as u128;

    let outcome = match market_type {
        // ── Absolute ──────────────────────────────────────────────────────────
        // YES if strategy A's annualized APY >= threshold_bps.
        MarketType::Absolute => {
            let (twap_a, _) = read_oracle(
                &ctx.accounts.nav_oracle,
                &ctx.accounts.market.strategy,
            )?;

            let initial_a = ctx.accounts.market.initial_nav_per_share;
            let apy_bps = annualized_growth_bps(twap_a, initial_a, elapsed_secs);
            let threshold = ctx.accounts.market.threshold_bps as u128;

            msg!(
                "resolve(Absolute): twap_a={}, initial_a={}, apy_bps={}, threshold_bps={}",
                twap_a,
                initial_a,
                apy_bps,
                threshold,
            );

            if apy_bps >= threshold {
                Outcome::Yes
            } else {
                Outcome::No
            }
        }

        // ── Relative ──────────────────────────────────────────────────────────
        // YES if strategy A's growth rate > strategy B's growth rate.
        // Growth is measured as (twap - initial_nav) / initial_nav so that
        // strategies starting at different share prices are compared fairly.
        MarketType::Relative => {
            let strategy_b = ctx.accounts.market.strategy_b
                .ok_or(MarketError::InvalidOracle)?;

            let (twap_a, _) = read_oracle(
                &ctx.accounts.nav_oracle,
                &ctx.accounts.market.strategy,
            )?;
            let (twap_b, _) = read_oracle(
                &ctx.accounts.nav_oracle_b,
                &strategy_b,
            )?;

            let initial_a = ctx.accounts.market.initial_nav_per_share;
            let initial_b = ctx.accounts.market.initial_nav_per_share_b;

            // Use raw growth bps (not annualized) for relative comparison —
            // both strategies run over the same elapsed window, so annualization
            // cancels out and is unnecessary.
            let growth_a = if initial_a == 0 || twap_a <= initial_a {
                0u128
            } else {
                (twap_a - initial_a) as u128 * 1_000_000 / initial_a as u128
            };
            let growth_b = if initial_b == 0 || twap_b <= initial_b {
                0u128
            } else {
                (twap_b - initial_b) as u128 * 1_000_000 / initial_b as u128
            };

            msg!(
                "resolve(Relative): twap_a={}, initial_a={}, growth_a_ppm={} | twap_b={}, initial_b={}, growth_b_ppm={}",
                twap_a, initial_a, growth_a,
                twap_b, initial_b, growth_b,
            );

            if growth_a > growth_b {
                Outcome::Yes
            } else {
                Outcome::No
            }
        }
    };

    let market = &mut ctx.accounts.market;
    market.outcome = Some(outcome);
    market.status = MarketStatus::Resolved;
    market.resolved_at = Some(now);

    msg!("resolve: outcome={}", outcome == Outcome::Yes);
    Ok(())
}
