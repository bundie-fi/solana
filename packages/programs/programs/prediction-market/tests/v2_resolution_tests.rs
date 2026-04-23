//! Pure-logic smoke tests for resolve_market_v2.
//!
//! Each test reproduces the resolution algebra used by resolve_market_v2's
//! handler, mocks the inputs (NavOracle TWAP, Strategy.backer_count, payload
//! threshold), and asserts that the YES/NO outcome lands on the correct side
//! of the threshold for each of the four shipped kinds.
//!
//! Drawdown (kind=3) is intentionally excluded — see SHIP NOTE in PR.
//! These mirror the strategy-token math_tests.rs pattern: validate the
//! decision boundary without spinning up a full Solana runtime. A future PR
//! can replace these with Mollusk tx tests once the test harness is set up.

const SECONDS_PER_YEAR: u128 = 31_536_000;
const MARKET_PAYLOAD_LEN: usize = 64;

// ─── Helpers reproduced from resolve_market_v2.rs ───────────────────────────

fn payload_u64(payload: &[u8; MARKET_PAYLOAD_LEN], byte_offset: usize) -> u64 {
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&payload[byte_offset..byte_offset + 8]);
    u64::from_le_bytes(buf)
}

fn set_payload_u64(payload: &mut [u8; MARKET_PAYLOAD_LEN], byte_offset: usize, v: u64) {
    payload[byte_offset..byte_offset + 8].copy_from_slice(&v.to_le_bytes());
}

fn annualized_growth_bps(twap: u64, initial_nav: u64, elapsed_secs: u128) -> u128 {
    if initial_nav == 0 || twap <= initial_nav {
        return 0;
    }
    let growth_bps = (twap - initial_nav) as u128 * 10_000 / initial_nav as u128;
    growth_bps.saturating_mul(SECONDS_PER_YEAR) / elapsed_secs
}

#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    Yes,
    No,
}

fn resolve_apy_threshold(
    twap_a: u64,
    initial_a: u64,
    elapsed_secs: u128,
    payload: &[u8; MARKET_PAYLOAD_LEN],
) -> Outcome {
    let threshold_bps = payload_u64(payload, 0) as u128;
    let apy_bps = annualized_growth_bps(twap_a, initial_a, elapsed_secs);
    if apy_bps >= threshold_bps {
        Outcome::Yes
    } else {
        Outcome::No
    }
}

fn resolve_nav_target(twap_a: u64, payload: &[u8; MARKET_PAYLOAD_LEN]) -> Outcome {
    let target_nav = payload_u64(payload, 0);
    if twap_a >= target_nav {
        Outcome::Yes
    } else {
        Outcome::No
    }
}

fn resolve_relative(twap_a: u64, initial_a: u64, twap_b: u64, initial_b: u64) -> Outcome {
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
    if growth_a > growth_b {
        Outcome::Yes
    } else {
        Outcome::No
    }
}

fn resolve_backer_count(count: u32, payload: &[u8; MARKET_PAYLOAD_LEN]) -> Outcome {
    let target = payload_u64(payload, 0);
    if (count as u64) >= target {
        Outcome::Yes
    } else {
        Outcome::No
    }
}

// ─── Kind 0: ApyThreshold ───────────────────────────────────────────────────

#[test]
fn apy_threshold_yes_above_threshold() {
    // 10% growth over 30 days → annualised ≈ 121.7% APR → 12_175 bps.
    // Threshold 10_000 bps (100%) — should resolve YES.
    let mut payload = [0u8; MARKET_PAYLOAD_LEN];
    set_payload_u64(&mut payload, 0, 10_000);

    let initial = 1_000_000_000u64;
    let twap = 1_100_000_000u64; // +10%
    let elapsed = 30u128 * 86_400;
    assert_eq!(
        resolve_apy_threshold(twap, initial, elapsed, &payload),
        Outcome::Yes
    );
}

#[test]
fn apy_threshold_no_below_threshold() {
    // 1% growth over 30 days → annualised ≈ 12.17% → 1_217 bps.
    // Threshold 10_000 bps (100%) — should resolve NO.
    let mut payload = [0u8; MARKET_PAYLOAD_LEN];
    set_payload_u64(&mut payload, 0, 10_000);

    let initial = 1_000_000_000u64;
    let twap = 1_010_000_000u64; // +1%
    let elapsed = 30u128 * 86_400;
    assert_eq!(
        resolve_apy_threshold(twap, initial, elapsed, &payload),
        Outcome::No
    );
}

#[test]
fn apy_threshold_no_when_twap_below_initial() {
    // Loss scenario — apy_bps clamps to 0, so any positive threshold → NO.
    let mut payload = [0u8; MARKET_PAYLOAD_LEN];
    set_payload_u64(&mut payload, 0, 100);

    let initial = 1_000_000_000u64;
    let twap = 900_000_000u64;
    let elapsed = 30u128 * 86_400;
    assert_eq!(
        resolve_apy_threshold(twap, initial, elapsed, &payload),
        Outcome::No
    );
}

// ─── Kind 1: NavTarget ──────────────────────────────────────────────────────

#[test]
fn nav_target_yes_at_target() {
    let mut payload = [0u8; MARKET_PAYLOAD_LEN];
    set_payload_u64(&mut payload, 0, 1_500_000_000);

    assert_eq!(resolve_nav_target(1_500_000_000, &payload), Outcome::Yes);
    assert_eq!(resolve_nav_target(1_500_000_001, &payload), Outcome::Yes);
}

#[test]
fn nav_target_no_below_target() {
    let mut payload = [0u8; MARKET_PAYLOAD_LEN];
    set_payload_u64(&mut payload, 0, 1_500_000_000);

    assert_eq!(resolve_nav_target(1_499_999_999, &payload), Outcome::No);
    assert_eq!(resolve_nav_target(1_000_000_000, &payload), Outcome::No);
}

// ─── Kind 2: Relative ───────────────────────────────────────────────────────

#[test]
fn relative_yes_when_a_outgrows_b() {
    // A: +10%, B: +5% → A wins (growth_a > growth_b).
    let outcome = resolve_relative(1_100_000_000, 1_000_000_000, 1_050_000_000, 1_000_000_000);
    assert_eq!(outcome, Outcome::Yes);
}

#[test]
fn relative_no_when_b_outgrows_a() {
    // A: +5%, B: +10% → B wins.
    let outcome = resolve_relative(1_050_000_000, 1_000_000_000, 1_100_000_000, 1_000_000_000);
    assert_eq!(outcome, Outcome::No);
}

#[test]
fn relative_no_on_tie() {
    // Equal growth → strict > comparison → NO.
    let outcome = resolve_relative(1_100_000_000, 1_000_000_000, 2_200_000_000, 2_000_000_000);
    assert_eq!(outcome, Outcome::No);
}

#[test]
fn relative_normalises_starting_prices() {
    // A starts at 1.0, ends at 1.10 (+10%).
    // B starts at 5.0, ends at 5.30 (+6%).
    // A outperforms in % terms despite B's larger absolute price.
    let outcome = resolve_relative(1_100_000_000, 1_000_000_000, 5_300_000_000, 5_000_000_000);
    assert_eq!(outcome, Outcome::Yes);
}

// ─── Kind 4: BackerCount ────────────────────────────────────────────────────

#[test]
fn backer_count_yes_at_or_above_target() {
    let mut payload = [0u8; MARKET_PAYLOAD_LEN];
    set_payload_u64(&mut payload, 0, 100);

    assert_eq!(resolve_backer_count(100, &payload), Outcome::Yes);
    assert_eq!(resolve_backer_count(250, &payload), Outcome::Yes);
}

#[test]
fn backer_count_no_below_target() {
    let mut payload = [0u8; MARKET_PAYLOAD_LEN];
    set_payload_u64(&mut payload, 0, 100);

    assert_eq!(resolve_backer_count(99, &payload), Outcome::No);
    assert_eq!(resolve_backer_count(0, &payload), Outcome::No);
}

// ─── Payload encoding round-trip ───────────────────────────────────────────

#[test]
fn payload_roundtrip_preserves_value() {
    let mut payload = [0u8; MARKET_PAYLOAD_LEN];
    set_payload_u64(&mut payload, 0, 12_345_678_900);
    set_payload_u64(&mut payload, 8, 98_765_432_100);
    assert_eq!(payload_u64(&payload, 0), 12_345_678_900);
    assert_eq!(payload_u64(&payload, 8), 98_765_432_100);
}
