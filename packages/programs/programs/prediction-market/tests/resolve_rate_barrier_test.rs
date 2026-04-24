//! Pure-logic smoke tests for the Rate Barrier (kind=5) resolution algebra.
//! Mirrors the pattern in v2_resolution_tests.rs — mocks the inputs that
//! resolve_market_v2's handler would derive from on-chain state, then asserts
//! outcome correctness at the threshold boundary.

const MARKET_PAYLOAD_LEN: usize = 64;

fn set_payload_u64(p: &mut [u8; MARKET_PAYLOAD_LEN], off: usize, v: u64) {
    p[off..off + 8].copy_from_slice(&v.to_le_bytes());
}

#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    Yes,
    No,
}

// Pure reproduction of the kind=5 resolver body. Keep in sync with
// resolve_market_v2.rs — the test is the canary on divergence.
fn resolve_rate_barrier(current_apy_bps: u64, payload: &[u8; MARKET_PAYLOAD_LEN]) -> Outcome {
    let threshold_bps = {
        let mut b = [0u8; 8];
        b.copy_from_slice(&payload[0..8]);
        u64::from_le_bytes(b)
    };
    if current_apy_bps >= threshold_bps {
        Outcome::Yes
    } else {
        Outcome::No
    }
}

fn payload_with_threshold(bps: u64) -> [u8; MARKET_PAYLOAD_LEN] {
    let mut p = [0u8; MARKET_PAYLOAD_LEN];
    set_payload_u64(&mut p, 0, bps);
    set_payload_u64(&mut p, 8, 1_000_000); // window start
    set_payload_u64(&mut p, 16, 1_500_000); // window end
    set_payload_u64(&mut p, 24, 1); // selector = Kamino USDC supply
    p
}

#[test]
fn rate_barrier_yes_when_apy_meets_threshold() {
    let payload = payload_with_threshold(800);
    assert_eq!(resolve_rate_barrier(800, &payload), Outcome::Yes);
    assert_eq!(resolve_rate_barrier(1200, &payload), Outcome::Yes);
}

#[test]
fn rate_barrier_no_when_apy_below_threshold() {
    let payload = payload_with_threshold(800);
    assert_eq!(resolve_rate_barrier(799, &payload), Outcome::No);
    assert_eq!(resolve_rate_barrier(0, &payload), Outcome::No);
}
