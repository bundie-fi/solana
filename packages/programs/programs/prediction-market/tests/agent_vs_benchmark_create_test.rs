//! Task 2.3 — verify `MARKET_KIND_AGENT_VS_BENCHMARK` exists with value 6
//! and that its documented payload layout round-trips through
//! `payload_u64` / `set_payload_u64`.
//!
//! Layout reminder (see state/market.rs doc-comment for full table):
//!   payload[0..8]   = spread_bps                (u64 LE) — required annualised excess
//!   payload[8..16]  = window_start_slot         (u64 LE)
//!   payload[16..24] = window_end_slot           (u64 LE)
//!   payload[24..32] = benchmark_reader_selector (u64 LE)
//!   payload[32..40] = initial_agent_nav         (u64 LE)
//!   payload[40..64] = reserved (zero)
//!
//! The agent's vault pubkey is carried in `market.created_by` — no extra
//! field on the payload side.

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
    let initial_agent_nav: u64 = 1_000_000_000;

    let mut payload = [0u8; MARKET_PAYLOAD_LEN];
    set_payload_u64(&mut payload, 0, spread_bps);
    set_payload_u64(&mut payload, 8, window_start_slot);
    set_payload_u64(&mut payload, 16, window_end_slot);
    set_payload_u64(&mut payload, 24, benchmark_reader_selector);
    set_payload_u64(&mut payload, 32, initial_agent_nav);

    assert_eq!(payload_u64(&payload, 0), spread_bps);
    assert_eq!(payload_u64(&payload, 8), window_start_slot);
    assert_eq!(payload_u64(&payload, 16), window_end_slot);
    assert_eq!(payload_u64(&payload, 24), benchmark_reader_selector);
    assert_eq!(payload_u64(&payload, 32), initial_agent_nav);

    // Reserved tail stays zero.
    for b in &payload[40..64] {
        assert_eq!(*b, 0u8);
    }
}
