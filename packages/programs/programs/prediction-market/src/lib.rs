use anchor_lang::prelude::*;

pub mod error;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;
use state::*;

declare_id!("Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4");

#[program]
pub mod prediction_market {
    use super::*;

    /// Create a new prediction market on a strategy's performance
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
        initial_nav_per_share_b: u64,
    ) -> Result<()> {
        instructions::create_market::handler(
            ctx,
            question,
            market_id,
            market_type,
            threshold_bps,
            resolution_slot,
            initial_subsidy,
            fee_bps,
            initial_nav_per_share,
            initial_nav_per_share_b,
        )
    }

    /// Buy YES or NO shares using LS-LMSR pricing
    pub fn buy_shares(ctx: Context<BuyMarketShares>, outcome: Outcome, amount: u64) -> Result<()> {
        instructions::buy_shares::handler(ctx, outcome, amount)
    }

    /// Sell YES or NO shares back to the market
    pub fn sell_shares(
        ctx: Context<SellMarketShares>,
        outcome: Outcome,
        shares: u64,
    ) -> Result<()> {
        instructions::sell_shares::handler(ctx, outcome, shares)
    }

    /// Resolve market using strategy's on-chain NAV (oracle-free)
    pub fn resolve(ctx: Context<ResolveMarket>) -> Result<()> {
        instructions::resolve::handler(ctx)
    }

    /// Redeem winning shares for payout
    pub fn redeem(ctx: Context<RedeemWinnings>) -> Result<()> {
        instructions::redeem::handler(ctx)
    }

    /// V2 — open a market of any of the five `MarketKind` variants. v1
    /// `create_market` continues to work and produces ApyThreshold-equivalent
    /// markets that resolve via the v1 `resolve` ix.
    #[allow(clippy::too_many_arguments)]
    pub fn create_market_v2(
        ctx: Context<CreateMarketV2>,
        question: String,
        market_id: u64,
        kind: u8,
        payload: [u8; MARKET_PAYLOAD_LEN],
        resolution_slot: u64,
        initial_subsidy: u64,
        fee_bps: u16,
        initial_nav_a: u64,
        initial_nav_b: u64,
    ) -> Result<()> {
        instructions::create_market_v2::handler(
            ctx,
            question,
            market_id,
            kind,
            payload,
            resolution_slot,
            initial_subsidy,
            fee_bps,
            initial_nav_a,
            initial_nav_b,
        )
    }

    /// V2 — branch on `market.kind` and read the relevant on-chain quantity
    /// (NavOracle TWAP, Strategy.backer_count, ...) to set the outcome.
    pub fn resolve_market_v2(ctx: Context<ResolveMarketV2>) -> Result<()> {
        instructions::resolve_market_v2::handler(ctx)
    }

    /// Initialize a BundieVault PDA at epoch 0 with an initial NAV. The PDA
    /// is derived from `["bundie_vault", authority]` so each authority owns
    /// exactly one vault. Phases B+ read NAV from this account during
    /// market resolution instead of CPIing into protocol-specific readers.
    pub fn init_vault(
        ctx: Context<InitVault>,
        initial_nav: u64,
        owner_wallet: Pubkey,
        treasury_mint: Pubkey,
    ) -> Result<()> {
        instructions::init_vault::handler(ctx, initial_nav, owner_wallet, treasury_mint)
    }

    /// Commit a new NAV value to the vault. Enforces strict monotonic
    /// epoch increment (`new_epoch == prev + 1`) so a stale or replayed
    /// commit cannot regress the vault. The `has_one = authority`
    /// constraint locks writes to the vault owner.
    pub fn commit_nav(
        ctx: Context<CommitNav>,
        new_nav: u64,
        new_epoch: u64,
        commit_digest: [u8; 32],
    ) -> Result<()> {
        instructions::commit_nav::handler(ctx, new_nav, new_epoch, commit_digest)
    }

    /// Transfer `amount` of the vault's treasury mint into its treasury
    /// ATA. Anyone may seed an agent.
    pub fn deposit_to_vault(ctx: Context<DepositToVault>, amount: u64) -> Result<()> {
        instructions::deposit_to_vault::handler(ctx, amount)
    }

    /// Drain the vault treasury back to `owner_wallet`, close the
    /// treasury ATA, and close the BundieVault PDA (rent → owner).
    /// Only the `owner_wallet` recorded at init may call this.
    pub fn close_vault(ctx: Context<CloseVault>) -> Result<()> {
        instructions::close_vault::handler(ctx)
    }

    /// Open a parametric event market (kind 7/8/9) bound to an off-chain
    /// resolver authority. This is the primary market-creation entrypoint
    /// for the Bundie event venue. `create_market_v2` is retained as a
    /// legacy agent-NAV path used by zerion-agent.
    ///
    /// Event markets resolve from off-chain data sources (Pyth feeds,
    /// status pages, on-chain TVL accounts) via a signature from the
    /// resolver recorded in `ResolverAuthority`.
    #[allow(clippy::too_many_arguments)]
    pub fn create_event(
        ctx: Context<CreateEvent>,
        question: String,
        market_id: u64,
        event_id_hash: [u8; 32],
        kind: u8,
        payload: [u8; MARKET_PAYLOAD_LEN],
        resolution_slot: u64,
        initial_subsidy: u64,
        fee_bps: u16,
        resolver: Pubkey,
        config_hash: [u8; 32],
    ) -> Result<()> {
        instructions::create_event::handler(
            ctx,
            question,
            market_id,
            event_id_hash,
            kind,
            payload,
            resolution_slot,
            initial_subsidy,
            fee_bps,
            resolver,
            config_hash,
        )
    }

    /// Settle an event market. The transaction must be signed by the
    /// pubkey recorded in the market's `ResolverAuthority` PDA. The
    /// resolver passes the outcome it observed off-chain; the on-chain
    /// logic only verifies the signer is the registered authority.
    pub fn resolve_event(ctx: Context<ResolveEvent>, outcome: Outcome) -> Result<()> {
        instructions::resolve_event::handler(ctx, outcome)
    }

    /// Buy YES or NO shares in an event market (kinds 7/8/9). Mirrors
    /// `buy_shares` but signs with the `event_market` PDA seed prefix.
    /// `event_id_hash` is the sha256 of the canonical event_id slug from
    /// `scripts/resolvers/sources.json` — clients pass the same hash they
    /// used to derive the market PDA.
    pub fn buy_event_shares(
        ctx: Context<BuyEventShares>,
        event_id_hash: [u8; 32],
        outcome: Outcome,
        amount: u64,
    ) -> Result<()> {
        instructions::buy_event_shares::handler(ctx, event_id_hash, outcome, amount)
    }

    /// Sell YES or NO shares back to an event market.
    pub fn sell_event_shares(
        ctx: Context<SellEventShares>,
        event_id_hash: [u8; 32],
        outcome: Outcome,
        shares: u64,
    ) -> Result<()> {
        instructions::sell_event_shares::handler(ctx, event_id_hash, outcome, shares)
    }

    /// Redeem winning shares in a resolved event market for a pro-rata
    /// claim on the vault.
    pub fn redeem_event(
        ctx: Context<RedeemEvent>,
        event_id_hash: [u8; 32],
    ) -> Result<()> {
        instructions::redeem_event::handler(ctx, event_id_hash)
    }
}
