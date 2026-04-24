//! Pure-logic smoke tests for Agent vs Benchmark (kind=6) resolution algebra.
//!
//! Post-pivot: payload[32..64] is the target_agent Pubkey (no longer an
//! initial_agent_nav u64). The resolver uses the current vault balance
//! directly as the agent's return-in-bps (NAV-from-zero model).

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
enum Outcome {
    Yes,
    No,
}

#[derive(Debug, PartialEq, Eq)]
enum ResolveError {
    WrongTargetAgent,
}

// Pure reproduction of kind=6 decision. Keep in sync with resolve_market_v2.rs.
//
// `data_a_key` is the address of the account passed as data_a by the resolver;
// it must equal the `target_agent` encoded at payload[32..64] — otherwise we
// return WrongTargetAgent (the resolve-side twin of InsiderMarketForbidden).
fn resolve_agent_vs_benchmark(
    data_a_key: [u8; 32],
    current_agent_nav: u64,
    benchmark_apy_bps: u64,
    payload: &[u8; MARKET_PAYLOAD_LEN],
) -> Result<Outcome, ResolveError> {
    let spread_bps = payload_u64(payload, 0);
    let target_agent_bytes: [u8; 32] = payload[32..64].try_into().unwrap();

    if data_a_key != target_agent_bytes {
        return Err(ResolveError::WrongTargetAgent);
    }

    // NAV-from-zero: the current vault balance IS the return in bps.
    let agent_return_bps = current_agent_nav;

    if agent_return_bps >= benchmark_apy_bps.saturating_add(spread_bps) {
        Ok(Outcome::Yes)
    } else {
        Ok(Outcome::No)
    }
}

fn payload_targeting(spread_bps: u64, target: [u8; 32]) -> [u8; MARKET_PAYLOAD_LEN] {
    let mut p = [0u8; MARKET_PAYLOAD_LEN];
    set_payload_u64(&mut p, 0, spread_bps);
    set_payload_u64(&mut p, 8, 1_000_000);
    set_payload_u64(&mut p, 16, 1_500_000);
    set_payload_u64(&mut p, 24, 1); // benchmark = Kamino USDC
    p[32..64].copy_from_slice(&target);
    p
}

fn fake_vault_key(tag: u8) -> [u8; 32] {
    let mut k = [0u8; 32];
    k[0] = tag;
    k
}

#[test]
fn agent_beats_benchmark_by_spread_yes() {
    // Agent return 500 bps, benchmark 300 bps, required spread 200.
    // 500 >= 300 + 200 → YES.
    let vault = fake_vault_key(1);
    let payload = payload_targeting(200, vault);
    let outcome = resolve_agent_vs_benchmark(vault, 500, 300, &payload).unwrap();
    assert_eq!(outcome, Outcome::Yes);
}

#[test]
fn agent_exactly_matches_spread_yes() {
    let vault = fake_vault_key(2);
    let payload = payload_targeting(200, vault);
    let outcome = resolve_agent_vs_benchmark(vault, 500, 300, &payload).unwrap();
    assert_eq!(outcome, Outcome::Yes);
}

#[test]
fn agent_misses_spread_by_one_bp_no() {
    // Agent 499, benchmark 300, spread 200 → 499 < 500 → NO.
    let vault = fake_vault_key(3);
    let payload = payload_targeting(200, vault);
    let outcome = resolve_agent_vs_benchmark(vault, 499, 300, &payload).unwrap();
    assert_eq!(outcome, Outcome::No);
}

#[test]
fn agent_loses_money_no() {
    let vault = fake_vault_key(4);
    let payload = payload_targeting(200, vault);
    let outcome = resolve_agent_vs_benchmark(vault, 0, 300, &payload).unwrap();
    assert_eq!(outcome, Outcome::No);
}

#[test]
fn wrong_target_agent_is_rejected() {
    // Payload targets vault-tag=5 but resolver is handed vault-tag=9's key —
    // must reject with WrongTargetAgent. This prevents a resolver from
    // pointing data_a at an arbitrary token account to game the outcome.
    let encoded_target = fake_vault_key(5);
    let wrong_data_a = fake_vault_key(9);
    let payload = payload_targeting(200, encoded_target);
    let err = resolve_agent_vs_benchmark(wrong_data_a, 500, 300, &payload).unwrap_err();
    assert_eq!(err, ResolveError::WrongTargetAgent);
}
