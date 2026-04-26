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

/// Re-derive the canonical BundieVault PDA from the pinned authority and
/// require the supplied vault account match it. This is the substitution
/// guard: a malicious resolver caller cannot pass an attacker-controlled
/// vault to bend the outcome — the only vault that derives to the right
/// address is the one whose authority matches what was snapshotted at
/// create-time.
fn require_vault_matches_pinned_authority(
    vault: &Account<crate::state::BundieVault>,
    pinned_authority: &Pubkey,
    program_id: &Pubkey,
) -> Result<()> {
    require!(
        vault.authority == *pinned_authority,
        MarketError::WrongTargetVault
    );
    let (expected_pda, _bump) =
        Pubkey::find_program_address(&[BUNDIE_VAULT_SEED, pinned_authority.as_ref()], program_id);
    require!(
        vault.key() == expected_pda,
        MarketError::WrongTargetVault
    );
    Ok(())
}

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

    /// Optional BundieVault for strategy A.
    /// Required for kinds 1 (NavTarget), 2 (Relative), and 3 (Drawdown) —
    /// the resolver reads `nav_lamports` to compute the outcome.
    pub target_vault_a: Option<Account<'info, crate::state::BundieVault>>,

    /// Optional BundieVault for strategy B.
    /// Required only for kind=2 (RELATIVE / head-to-head).
    pub target_vault_b: Option<Account<'info, crate::state::BundieVault>>,
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
            // Phase B: read live NAV from BundieVault rather than NavOracle.
            let target_nav = u64::from_le_bytes(payload[0..8].try_into().unwrap());
            let v = ctx
                .accounts
                .target_vault_a
                .as_ref()
                .ok_or(MarketError::MissingTargetVault)?;
            let pinned_a = ctx
                .accounts
                .market
                .target_authority_a
                .ok_or(MarketError::MissingTargetVault)?;
            require_vault_matches_pinned_authority(v, &pinned_a, ctx.program_id)?;
            msg!(
                "resolve_v2(NavTarget): vault_nav={} target={}",
                v.nav_lamports,
                target_nav
            );
            if v.nav_lamports >= target_nav {
                Outcome::Yes
            } else {
                Outcome::No
            }
        }

        MARKET_KIND_RELATIVE => {
            // Phase B: head-to-head NAV delta from BundieVault accounts.
            let a = ctx
                .accounts
                .target_vault_a
                .as_ref()
                .ok_or(MarketError::MissingTargetVault)?;
            let b = ctx
                .accounts
                .target_vault_b
                .as_ref()
                .ok_or(MarketError::MissingTargetVault)?;
            let pinned_a = ctx
                .accounts
                .market
                .target_authority_a
                .ok_or(MarketError::MissingTargetVault)?;
            let pinned_b = ctx
                .accounts
                .market
                .target_authority_b
                .ok_or(MarketError::MissingTargetVault)?;
            require_vault_matches_pinned_authority(a, &pinned_a, ctx.program_id)?;
            require_vault_matches_pinned_authority(b, &pinned_b, ctx.program_id)?;
            let init_a = ctx.accounts.market.initial_nav_a.max(1) as i128;
            let init_b = ctx.accounts.market.initial_nav_b.max(1) as i128;
            let return_a = ((a.nav_lamports as i128) - (ctx.accounts.market.initial_nav_a as i128))
                .checked_mul(10_000)
                .ok_or(MarketError::MathOverflow)?
                .checked_div(init_a)
                .ok_or(MarketError::MathOverflow)?;
            let return_b = ((b.nav_lamports as i128) - (ctx.accounts.market.initial_nav_b as i128))
                .checked_mul(10_000)
                .ok_or(MarketError::MathOverflow)?
                .checked_div(init_b)
                .ok_or(MarketError::MathOverflow)?;
            msg!(
                "resolve_v2(Relative): return_a_bps={} return_b_bps={}",
                return_a,
                return_b
            );
            if return_a > return_b {
                Outcome::Yes
            } else {
                Outcome::No
            }
        }

        MARKET_KIND_DRAWDOWN => {
            // Phase B: drawdown computed from BundieVault NAV vs the
            // create-time snapshot. YES if the NAV dropped by at least
            // `max_drawdown_bps`; NO if NAV is flat or up.
            let max_drawdown_bps = u64::from_le_bytes(payload[0..8].try_into().unwrap());
            let v = ctx
                .accounts
                .target_vault_a
                .as_ref()
                .ok_or(MarketError::MissingTargetVault)?;
            let pinned_a = ctx
                .accounts
                .market
                .target_authority_a
                .ok_or(MarketError::MissingTargetVault)?;
            require_vault_matches_pinned_authority(v, &pinned_a, ctx.program_id)?;
            let initial = ctx.accounts.market.initial_nav_a;
            if v.nav_lamports >= initial {
                Outcome::No
            } else {
                let drop_bps = ((initial - v.nav_lamports) as u128)
                    .checked_mul(10_000)
                    .ok_or(MarketError::MathOverflow)?
                    .checked_div((initial.max(1)) as u128)
                    .ok_or(MarketError::MathOverflow)? as u64;
                msg!(
                    "resolve_v2(Drawdown): drop_bps={} max_bps={}",
                    drop_bps,
                    max_drawdown_bps
                );
                if drop_bps >= max_drawdown_bps {
                    Outcome::Yes
                } else {
                    Outcome::No
                }
            }
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

        _ => return err!(MarketError::DeprecatedMarketKind),
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
