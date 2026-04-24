//! Pure-logic smoke tests for Agent vs Benchmark (kind=6) resolution algebra.

const MARKET_PAYLOAD_LEN: usize = 64;

fn set_payload_u64(p: &mut [u8; MARKET_PAYLOAD_LEN], off: usize, v: u64) {
    p[off..off + 8].copy_from_slice(&v.to_le_bytes());
}

fn payload_u64(p: &[u8; MARKET_PAYLOAD_LEN], off: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&p[off..off + 8]);
    u64::from_le_bytes(b)
}

#[derive(Debug, PartialEq, Eq)]
enum Outcome { Yes, No }

// Pure reproduction of kind=6 decision. Keep in sync with resolve_market_v2.rs.
fn resolve_agent_vs_benchmark(
    current_agent_nav: u64,
    benchmark_apy_bps: u64,
    payload: &[u8; MARKET_PAYLOAD_LEN],
) -> Outcome {
    let spread_bps = payload_u64(payload, 0);
    let initial_agent_nav = payload_u64(payload, 32);

    let agent_return_bps = if initial_agent_nav > 0 {
        ((current_agent_nav.saturating_sub(initial_agent_nav)) as u128 * 10_000u128
            / initial_agent_nav as u128) as u64
    } else {
        0
    };

    if agent_return_bps >= benchmark_apy_bps.saturating_add(spread_bps) {
        Outcome::Yes
    } else {
        Outcome::No
    }
}

fn payload_with(spread_bps: u64, initial_agent_nav: u64) -> [u8; MARKET_PAYLOAD_LEN] {
    let mut p = [0u8; MARKET_PAYLOAD_LEN];
    set_payload_u64(&mut p, 0, spread_bps);
    set_payload_u64(&mut p, 8, 1_000_000);
    set_payload_u64(&mut p, 16, 1_500_000);
    set_payload_u64(&mut p, 24, 1); // benchmark = Kamino USDC
    set_payload_u64(&mut p, 32, initial_agent_nav);
    p
}

#[test]
fn agent_beats_benchmark_by_spread_yes() {
    // Agent grew 500 bps (5%), benchmark is 300 bps, required spread 200.
    // 500 >= 300 + 200 → YES.
    let payload = payload_with(200, 1_000_000);
    let outcome = resolve_agent_vs_benchmark(1_050_000, 300, &payload);
    assert_eq!(outcome, Outcome::Yes);
}

#[test]
fn agent_exactly_matches_spread_yes() {
    // Agent grew 500 bps, benchmark 300, spread 200 → equal → YES.
    let payload = payload_with(200, 1_000_000);
    let outcome = resolve_agent_vs_benchmark(1_050_000, 300, &payload);
    assert_eq!(outcome, Outcome::Yes);
}

#[test]
fn agent_misses_spread_by_one_bp_no() {
    // Agent grew 499 bps, benchmark 300, spread 200 → 499 < 500 → NO.
    // initial=1_000_000 current=1_049_900 gives 499 bps.
    let payload = payload_with(200, 1_000_000);
    let outcome = resolve_agent_vs_benchmark(1_049_900, 300, &payload);
    assert_eq!(outcome, Outcome::No);
}

#[test]
fn agent_loses_money_no() {
    let payload = payload_with(200, 1_000_000);
    let outcome = resolve_agent_vs_benchmark(900_000, 300, &payload);
    assert_eq!(outcome, Outcome::No);
}

#[test]
fn zero_initial_nav_returns_no() {
    // Defensive: should not panic, should resolve to NO.
    let payload = payload_with(200, 0);
    let outcome = resolve_agent_vs_benchmark(1_000_000, 300, &payload);
    assert_eq!(outcome, Outcome::No);
}
