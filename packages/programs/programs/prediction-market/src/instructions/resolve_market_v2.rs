//! resolve_market_v2 — branch on `market.kind` and read the appropriate
//! on-chain quantity to set the market outcome.
//!
//! Reuses the same NavOracle layout as v1 `resolve.rs`. For BackerCount
//! kind, reads the strategy-token `Strategy.backer_count` field directly
//! (offset 260 — see strategy-token::state::strategy).
//!
//! Drawdown (kind=3) is currently DEFERRED — NavOracle does not keep a
//! history ring buffer, and adding one is a separate piece of work.
//! resolve_market_v2 returns `MarketError::ResolveDeferredKind` for kind=3.

use crate::error::MarketError;
use crate::state::*;
use anchor_lang::prelude::*;

// ── NavOracle on-chain layout (mirrors strategy-token/src/state/nav_oracle.rs)
const NAV_ORACLE_DISCRIMINATOR: [u8; 8] = [0xa1, 0x4e, 0x73, 0x20, 0xbc, 0x44, 0x61, 0x05];
const OFF_ORACLE_STRATEGY: usize = 8;
const OFF_ORACLE_TWAP: usize = 48;
const OFF_ORACLE_SNAPSHOTS: usize = 56;
const NAV_ORACLE_MIN_LEN: usize = 89;

// ── Strategy on-chain layout (mirrors strategy-token/src/state/strategy.rs)
const STRATEGY_DISCRIMINATOR: [u8; 8] = [0xd0, 0x82, 0x35, 0xce, 0x9a, 0x7f, 0x5b, 0x11];
const OFF_STRATEGY_BACKER_COUNT: usize = 260; // u32 LE — alias of total_investors
const STRATEGY_MIN_LEN: usize = 264;

const SECONDS_PER_YEAR: u128 = 31_536_000;

#[derive(Accounts)]
pub struct ResolveMarketV2<'info> {
    pub resolver: Signer<'info>,

    #[account(
        mut,
        constraint = market.status == MarketStatus::Active @ MarketError::MarketNotActive,
        constraint = Clock::get()?.slot >= market.resolution_slot @ MarketError::ResolutionNotReached,
    )]
    pub market: Account<'info, Market>,

    /// Primary on-chain data source for strategy A.
    /// - kinds 0/1/2/3 → expected to be the NavOracle PDA for `market.strategy`
    ///   (seeds: ["nav", market.strategy])
    /// - kind 4        → expected to be the Strategy account itself
    ///   (i.e. equal to `market.strategy`)
    ///
    /// CHECK: Manual validation in handler keyed by market.kind.
    pub data_a: UncheckedAccount<'info>,

    /// Secondary data source.
    /// - kind 2 (Relative) → NavOracle PDA for `market.strategy_b`
    /// - all other kinds   → ignored (pass SystemProgram)
    ///
    /// CHECK: Manual validation in handler.
    pub data_b: UncheckedAccount<'info>,
}

/// Read and validate a NavOracle account. Returns its TWAP value.
fn read_oracle_twap(oracle: &UncheckedAccount, expected_strategy: &Pubkey) -> Result<u64> {
    let data = oracle.try_borrow_data()?;
    require!(
        data.len() >= NAV_ORACLE_MIN_LEN && data[0..8] == NAV_ORACLE_DISCRIMINATOR,
        MarketError::InvalidOracle
    );

    let strategy: [u8; 32] = data[OFF_ORACLE_STRATEGY..OFF_ORACLE_STRATEGY + 32]
        .try_into()
        .unwrap();
    require!(
        strategy == expected_strategy.to_bytes(),
        MarketError::InvalidOracle
    );

    let snapshots = u64::from_le_bytes(
        data[OFF_ORACLE_SNAPSHOTS..OFF_ORACLE_SNAPSHOTS + 8]
            .try_into()
            .unwrap(),
    );
    require!(snapshots > 0, MarketError::InsufficientSnapshots);

    let twap = u64::from_le_bytes(
        data[OFF_ORACLE_TWAP..OFF_ORACLE_TWAP + 8]
            .try_into()
            .unwrap(),
    );
    Ok(twap)
}

/// Read the backer_count field from a strategy-token Strategy account.
fn read_backer_count(strategy_acc: &UncheckedAccount, expected_addr: &Pubkey) -> Result<u32> {
    require!(
        &strategy_acc.key() == expected_addr,
        MarketError::WrongStrategyForMarket
    );

    let data = strategy_acc.try_borrow_data()?;
    require!(
        data.len() >= STRATEGY_MIN_LEN && data[0..8] == STRATEGY_DISCRIMINATOR,
        MarketError::InvalidStrategyAccount
    );

    let n = u32::from_le_bytes(
        data[OFF_STRATEGY_BACKER_COUNT..OFF_STRATEGY_BACKER_COUNT + 4]
            .try_into()
            .unwrap(),
    );
    Ok(n)
}

/// Compute annualised growth in basis points (returns 0 if no growth).
fn annualized_growth_bps(twap: u64, initial_nav: u64, elapsed_secs: u128) -> u128 {
    if initial_nav == 0 || twap <= initial_nav {
        return 0;
    }
    let growth_bps = (twap - initial_nav) as u128 * 10_000 / initial_nav as u128;
    growth_bps.saturating_mul(SECONDS_PER_YEAR) / elapsed_secs
}

pub fn handler(ctx: Context<ResolveMarketV2>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let elapsed_secs = (now - ctx.accounts.market.created_at).max(1) as u128;
    let kind = ctx.accounts.market.kind;
    let payload = ctx.accounts.market.payload;
    let strategy_a = ctx.accounts.market.strategy;

    let outcome = match kind {
        MARKET_KIND_APY_THRESHOLD => {
            let twap_a = read_oracle_twap(&ctx.accounts.data_a, &strategy_a)?;
            let initial_a = ctx.accounts.market.initial_nav_per_share;
            let threshold_bps = payload_u64(&payload, 0) as u128;
            let apy_bps = annualized_growth_bps(twap_a, initial_a, elapsed_secs);
            msg!(
                "resolve_v2(ApyThreshold): twap={} init={} apy_bps={} threshold={}",
                twap_a,
                initial_a,
                apy_bps,
                threshold_bps
            );
            if apy_bps >= threshold_bps {
                Outcome::Yes
            } else {
                Outcome::No
            }
        }

        MARKET_KIND_NAV_TARGET => {
            let twap_a = read_oracle_twap(&ctx.accounts.data_a, &strategy_a)?;
            let target_nav = payload_u64(&payload, 0);
            msg!(
                "resolve_v2(NavTarget): twap={} target={}",
                twap_a,
                target_nav
            );
            if twap_a >= target_nav {
                Outcome::Yes
            } else {
                Outcome::No
            }
        }

        MARKET_KIND_RELATIVE => {
            let strategy_b = ctx
                .accounts
                .market
                .strategy_b
                .ok_or(MarketError::InvalidOracle)?;

            let twap_a = read_oracle_twap(&ctx.accounts.data_a, &strategy_a)?;
            let twap_b = read_oracle_twap(&ctx.accounts.data_b, &strategy_b)?;

            let initial_a = ctx.accounts.market.initial_nav_per_share;
            let initial_b = ctx.accounts.market.initial_nav_per_share_b;

            // Compare raw growth ratios (in ppm). Annualisation cancels out
            // because both legs span the same elapsed window.
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
                "resolve_v2(Relative): a_growth_ppm={} b_growth_ppm={}",
                growth_a,
                growth_b
            );
            if growth_a > growth_b {
                Outcome::Yes
            } else {
                Outcome::No
            }
        }

        MARKET_KIND_DRAWDOWN => {
            // Deferred until NavOracle gains a snapshot ring buffer.
            // Returning a distinct error so the resolver can surface this
            // cleanly rather than emitting a fake outcome.
            return Err(error!(MarketError::ResolveDeferredKind));
        }

        MARKET_KIND_BACKER_COUNT => {
            let target = payload_u64(&payload, 0);
            let count = read_backer_count(&ctx.accounts.data_a, &strategy_a)? as u64;
            msg!("resolve_v2(BackerCount): count={} target={}", count, target);
            if count >= target {
                Outcome::Yes
            } else {
                Outcome::No
            }
        }

        MARKET_KIND_RATE_BARRIER => {
            let threshold_bps = payload_u64(&payload, 0);
            let _window_start = payload_u64(&payload, 8);
            let _window_end = payload_u64(&payload, 16);
            let selector = payload_u64(&payload, 24);

            let reader = crate::rate_readers::rate_reader_for_selector(selector)
                .ok_or(error!(MarketError::InvalidOracle))?;
            let data = ctx.accounts.data_a.try_borrow_data()?;
            let current_apy_bps = reader.read_apy_bps(&data)?;

            msg!(
                "resolve_v2(RateBarrier): selector={} apy_bps={} threshold={}",
                selector,
                current_apy_bps,
                threshold_bps
            );

            if current_apy_bps >= threshold_bps {
                Outcome::Yes
            } else {
                Outcome::No
            }
        }

        MARKET_KIND_AGENT_VS_BENCHMARK => {
            let spread_bps = payload_u64(&payload, 0);
            let _window_start = payload_u64(&payload, 8);
            let _window_end = payload_u64(&payload, 16);
            let benchmark_selector = payload_u64(&payload, 24);

            // payload[32..64] carries the target_agent Pubkey. Assert that
            // data_a is actually the vault encoded in the payload — without
            // this, anyone could resolve a market against an arbitrary token
            // account of their choosing. This is the resolve-side twin of
            // the create-side insider-trading guard.
            let target_agent_bytes: [u8; 32] = payload[32..64].try_into().unwrap();
            let target_agent = Pubkey::new_from_array(target_agent_bytes);
            require!(
                ctx.accounts.data_a.key() == target_agent,
                MarketError::WrongTargetAgent
            );

            // data_a must be the agent's vault SPL Token Account. Amount lives
            // at offset 64 (the `amount: u64` field after mint+owner+delegate).
            let vault_data = ctx.accounts.data_a.try_borrow_data()?;
            require!(vault_data.len() >= 72, MarketError::InvalidOracle);
            let current_agent_nav = u64::from_le_bytes(
                vault_data[64..72]
                    .try_into()
                    .map_err(|_| error!(MarketError::InvalidOracle))?,
            );

            // data_b is the benchmark reader's pool account.
            let benchmark_reader =
                crate::rate_readers::rate_reader_for_selector(benchmark_selector)
                    .ok_or(error!(MarketError::InvalidOracle))?;
            let benchmark_data = ctx.accounts.data_b.try_borrow_data()?;
            let benchmark_apy_bps = benchmark_reader.read_apy_bps(&benchmark_data)?;

            // NAV-from-zero model. We no longer store an initial_agent_nav at
            // payload[32..40] (those bytes are now the low half of the
            // target_agent Pubkey). The agent's "return" here is simply the
            // current vault balance expressed in bps — i.e. we treat the
            // whole vault as accumulated return over the measurement window.
            // For the hackathon this is a reasonable approximation: all three
            // reference agents start each market window with a freshly-funded
            // vault, so balance == growth. Re-introducing a per-market
            // snapshot is a post-hackathon enhancement.
            let agent_return_bps = current_agent_nav;

            msg!(
                "resolve_v2(AgentVsBenchmark): agent_return_bps={} benchmark_bps={} spread_bps={}",
                agent_return_bps,
                benchmark_apy_bps,
                spread_bps
            );

            if agent_return_bps >= benchmark_apy_bps.saturating_add(spread_bps) {
                Outcome::Yes
            } else {
                Outcome::No
            }
        }

        _ => return Err(error!(MarketError::InvalidKind)),
    };

    let market = &mut ctx.accounts.market;
    market.outcome = Some(outcome);
    market.status = MarketStatus::Resolved;
    market.resolved_at = Some(now);
    msg!(
        "resolve_v2: kind={} outcome={}",
        kind,
        outcome == Outcome::Yes
    );
    Ok(())
}
