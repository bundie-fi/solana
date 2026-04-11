use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::MarketError;

/// NavOracle discriminator — must match the constant in strategy-token/src/state/nav_oracle.rs
const NAV_ORACLE_DISCRIMINATOR: [u8; 8] = [0xa1, 0x4e, 0x73, 0x20, 0xbc, 0x44, 0x61, 0x05];

/// Field byte offsets within the NavOracle account data
const OFF_ORACLE_STRATEGY: usize = 8;      // Pubkey (32 bytes)
const OFF_ORACLE_TWAP: usize = 48;         // twap_value u64 (8 bytes)
const OFF_ORACLE_SNAPSHOTS: usize = 56;    // snapshot_count u64 (8 bytes)

const NAV_ORACLE_MIN_LEN: usize = 89;

/// Seconds in a year, used for APY annualization
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

    /// NavOracle account from the strategy-token program.
    /// PDA seeds (in strategy-token): ["nav_oracle", market.strategy].
    /// Validated in handler: discriminator check + strategy key match.
    /// CHECK: Manual validation below.
    pub nav_oracle: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<ResolveMarket>) -> Result<()> {
    // --- 1. Read and validate the NavOracle account ---
    let (twap_nav, snapshot_count, oracle_strategy) = {
        let data = ctx.accounts.nav_oracle.try_borrow_data()?;

        require!(
            data.len() >= NAV_ORACLE_MIN_LEN
                && data[0..8] == NAV_ORACLE_DISCRIMINATOR,
            MarketError::InvalidOracle
        );

        let strategy: [u8; 32] = data[OFF_ORACLE_STRATEGY..OFF_ORACLE_STRATEGY + 32]
            .try_into()
            .unwrap();
        let twap = u64::from_le_bytes(
            data[OFF_ORACLE_TWAP..OFF_ORACLE_TWAP + 8].try_into().unwrap(),
        );
        let snapshots = u64::from_le_bytes(
            data[OFF_ORACLE_SNAPSHOTS..OFF_ORACLE_SNAPSHOTS + 8].try_into().unwrap(),
        );

        (twap, snapshots, strategy)
    }; // data borrow dropped here

    require!(
        oracle_strategy == ctx.accounts.market.strategy.to_bytes(),
        MarketError::InvalidOracle
    );
    require!(snapshot_count > 0, MarketError::InsufficientSnapshots);

    // --- 2. Determine outcome ---
    let market = &mut ctx.accounts.market;
    let initial_nav = market.initial_nav_per_share;

    let outcome = if initial_nav == 0 || twap_nav <= initial_nav {
        // No growth — definitely below any threshold
        Outcome::No
    } else {
        let now = Clock::get()?.unix_timestamp;
        let elapsed_secs = (now - market.created_at).max(1) as u128;

        // nav_growth_bps = (twap_nav - initial_nav) * 10_000 / initial_nav
        let nav_growth_bps =
            (twap_nav - initial_nav) as u128 * 10_000 / initial_nav as u128;

        // annualize: bps_per_year = nav_growth_bps * SECONDS_PER_YEAR / elapsed_secs
        let annualized_bps = nav_growth_bps
            .checked_mul(SECONDS_PER_YEAR)
            .unwrap_or(u128::MAX)
            / elapsed_secs;

        if annualized_bps >= market.threshold_bps as u128 {
            Outcome::Yes
        } else {
            Outcome::No
        }
    };

    // --- 3. Finalize ---
    market.outcome = Some(outcome);
    market.status = MarketStatus::Resolved;
    market.resolved_at = Some(Clock::get()?.unix_timestamp);

    msg!(
        "resolve: twap_nav={}, initial_nav={}, threshold_bps={}, outcome={}",
        twap_nav,
        initial_nav,
        market.threshold_bps,
        outcome == Outcome::Yes,
    );

    Ok(())
}
