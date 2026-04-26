//! resolve_market_v2 — branch on `market.kind` and read the appropriate
//! on-chain quantity to set the market outcome.
//!
//! Phase C: only kinds 1 (NavTarget), 2 (Relative), and 3 (Drawdown) are
//! reachable. All resolution flows through BundieVault `nav_lamports`,
//! which agents commit via `commit_nav`. The legacy NavOracle TWAP and
//! Strategy.backer_count code paths have been removed; kinds 0/4/5/6
//! return `DeprecatedMarketKind`.

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
    require!(vault.key() == expected_pda, MarketError::WrongTargetVault);
    Ok(())
}

#[derive(Accounts)]
pub struct ResolveMarketV2<'info> {
    pub resolver: Signer<'info>,

    #[account(
        mut,
        constraint = market.status == MarketStatus::Active @ MarketError::MarketNotActive,
        constraint = Clock::get()?.slot >= market.resolution_slot @ MarketError::ResolutionNotReached,
    )]
    pub market: Account<'info, Market>,

    /// Reserved data slot. Phase C resolution reads vault NAV directly;
    /// the legacy NavOracle / Strategy account paths are gone. Kept in the
    /// account list so existing client transaction layouts (which pass
    /// SystemProgram here as a placeholder) still serialise.
    ///
    /// CHECK: Unused by the current resolver.
    pub data_a: UncheckedAccount<'info>,

    /// Reserved data slot — same rationale as `data_a`.
    ///
    /// CHECK: Unused by the current resolver.
    pub data_b: UncheckedAccount<'info>,

    /// Optional BundieVault for strategy A.
    /// Required for kinds 1 (NavTarget), 2 (Relative), and 3 (Drawdown) —
    /// the resolver reads `nav_lamports` to compute the outcome.
    pub target_vault_a: Option<Account<'info, crate::state::BundieVault>>,

    /// Optional BundieVault for strategy B.
    /// Required only for kind=2 (RELATIVE / head-to-head).
    pub target_vault_b: Option<Account<'info, crate::state::BundieVault>>,
}

pub fn handler(ctx: Context<ResolveMarketV2>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let kind = ctx.accounts.market.kind;
    let payload = ctx.accounts.market.payload;

    let outcome = match kind {
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

        // Kinds 0 (ApyThreshold), 4 (BackerCount), 5 (RateBarrier), and
        // 6 (AgentVsBenchmark) are all create-deprecated by Phase C and
        // also deprecated at resolve time so resolution is internally
        // consistent — only kinds 1/2/3 (BundieVault NAV) are reachable.
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
