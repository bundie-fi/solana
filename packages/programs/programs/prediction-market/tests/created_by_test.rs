//! Task 2.1 — verify `created_by: Pubkey` lives on the Market account.
//!
//! We build a `Market` literal with every current field populated (so that
//! if this test compiles it proves the struct still carries all pre-existing
//! fields) and set `created_by` to a random pubkey. The assertion itself is
//! trivial — the point is the compile-time proof of the field's existence
//! and position in the struct.

use anchor_lang::prelude::Pubkey;
use prediction_market::state::{Market, MarketStatus, MarketType, Outcome, MARKET_PAYLOAD_LEN};

#[test]
fn market_carries_created_by_field() {
    let agent_vault = Pubkey::new_unique();

    let m = Market {
        strategy: Pubkey::new_unique(),
        strategy_b: None,
        authority: Pubkey::new_unique(),
        subsidy_provider: Pubkey::new_unique(),
        question: "is this market well-formed?".to_string(),
        market_type: MarketType::Absolute,
        market_id: 0,
        threshold_bps: 0,
        resolution_slot: 0,
        yes_shares: 0,
        no_shares: 0,
        total_yes_cost: 0,
        total_no_cost: 0,
        liquidity_param: 0,
        total_volume: 0,
        fee_bps: 0,
        vault: Pubkey::new_unique(),
        collateral_mint: Pubkey::new_unique(),
        outcome: None::<Outcome>,
        status: MarketStatus::Active,
        created_at: 0,
        resolved_at: None,
        bump: 0,
        initial_nav_per_share: 0,
        initial_nav_per_share_b: 0,
        initial_nav_a: 0,
        initial_nav_b: 0,
        yes_mint_bump: 0,
        no_mint_bump: 0,
        vault_bump: 0,
        kind: 0,
        payload: [0u8; MARKET_PAYLOAD_LEN],
        created_by: agent_vault,
    };

    assert_eq!(m.market_id, 0);
    assert_eq!(m.created_by, agent_vault);
}
