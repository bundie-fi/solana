//! Task 2.3 — verify `MARKET_KIND_AGENT_VS_BENCHMARK` exists with value 6
//! and that its documented payload layout round-trips through
//! `payload_u64` / `set_payload_u64`.
//!
//! Layout reminder (see state/market.rs doc-comment for full table):
//!   payload[0..8]   = spread_bps                (u64 LE) — required annualised excess
//!   payload[8..16]  = window_start_slot         (u64 LE)
//!   payload[16..24] = window_end_slot           (u64 LE)
//!   payload[24..32] = benchmark_reader_selector (u64 LE)
//!   payload[32..64] = target_agent              (Pubkey, 32 bytes)
//!
//! The old `initial_agent_nav` u64 at bytes 32..40 has been displaced by the
//! target_agent Pubkey. The resolver now computes agent return from the
//! current vault balance alone (see resolve_market_v2.rs).

use anchor_lang::prelude::Pubkey;
use prediction_market::state::{
    payload_u64, set_payload_u64, MARKET_KIND_AGENT_VS_BENCHMARK, MARKET_PAYLOAD_LEN,
};

#[test]
fn agent_vs_benchmark_kind_constant_is_six() {
    assert_eq!(MARKET_KIND_AGENT_VS_BENCHMARK, 6u8);
}

#[test]
fn agent_vs_benchmark_payload_roundtrip() {
    let spread_bps: u64 = 200;
    let window_start_slot: u64 = 1_000_000;
    let window_end_slot: u64 = 1_500_000;
    let benchmark_reader_selector: u64 = 1; // Kamino USDC supply APY
    let target_agent = Pubkey::new_unique();

    let mut payload = [0u8; MARKET_PAYLOAD_LEN];
    set_payload_u64(&mut payload, 0, spread_bps);
    set_payload_u64(&mut payload, 8, window_start_slot);
    set_payload_u64(&mut payload, 16, window_end_slot);
    set_payload_u64(&mut payload, 24, benchmark_reader_selector);
    payload[32..64].copy_from_slice(&target_agent.to_bytes());

    assert_eq!(payload_u64(&payload, 0), spread_bps);
    assert_eq!(payload_u64(&payload, 8), window_start_slot);
    assert_eq!(payload_u64(&payload, 16), window_end_slot);
    assert_eq!(payload_u64(&payload, 24), benchmark_reader_selector);

    let decoded_bytes: [u8; 32] = payload[32..64].try_into().unwrap();
    let decoded_target = Pubkey::new_from_array(decoded_bytes);
    assert_eq!(decoded_target, target_agent);
}

/// Pure-logic reproduction of the create-side insider-trading guard.
/// Mirrors the algebra in create_market_v2.rs — see that file for the
/// `require!` pair that enforces this on-chain.
fn create_guard(
    creator: Pubkey,
    payload: &[u8; MARKET_PAYLOAD_LEN],
) -> Result<(), &'static str> {
    let target_bytes: [u8; 32] = payload[32..64].try_into().unwrap();
    let target = Pubkey::new_from_array(target_bytes);
    if target == Pubkey::default() {
        return Err("InvalidPayload");
    }
    if target == creator {
        return Err("InsiderMarketForbidden");
    }
    Ok(())
}

fn valid_payload_targeting(target: Pubkey) -> [u8; MARKET_PAYLOAD_LEN] {
    let mut p = [0u8; MARKET_PAYLOAD_LEN];
    set_payload_u64(&mut p, 0, 200);
    set_payload_u64(&mut p, 8, 1_000_000);
    set_payload_u64(&mut p, 16, 1_500_000);
    set_payload_u64(&mut p, 24, 1);
    p[32..64].copy_from_slice(&target.to_bytes());
    p
}

#[test]
fn create_rejects_self_target() {
    let creator = Pubkey::new_unique();
    // Agent tries to create a kind=6 market targeting its own vault — forbidden.
    let payload = valid_payload_targeting(creator);
    assert_eq!(create_guard(creator, &payload), Err("InsiderMarketForbidden"));
}

#[test]
fn create_rejects_default_target() {
    let creator = Pubkey::new_unique();
    // target_agent left as default Pubkey (32 zero bytes) — rejected as malformed.
    let payload = valid_payload_targeting(Pubkey::default());
    assert_eq!(create_guard(creator, &payload), Err("InvalidPayload"));
}

#[test]
fn create_accepts_cross_agent_market() {
    let creator = Pubkey::new_unique();
    let target = Pubkey::new_unique();
    assert_ne!(creator, target);
    // Different agent targeting — this is the normal case and must be allowed.
    let payload = valid_payload_targeting(target);
    assert!(create_guard(creator, &payload).is_ok());
}
