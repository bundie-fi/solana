//! Task 2.2 — verify `MARKET_KIND_RATE_BARRIER` exists with value 5 and
//! that the documented payload layout round-trips through the canonical
//! `payload_u64` / `set_payload_u64` helpers.
//!
//! Layout reminder (see state/market.rs doc-comment for full table):
//!   payload[0..8]   = threshold_bps          (u64 LE)
//!   payload[8..16]  = window_start_slot      (u64 LE)
//!   payload[16..24] = window_end_slot        (u64 LE)
//!   payload[24..32] = rate_reader_selector   (u64 LE)
//!   payload[32..64] = reserved (zero)

use prediction_market::state::{
    payload_u64, set_payload_u64, MARKET_KIND_RATE_BARRIER, MARKET_PAYLOAD_LEN,
};

#[test]
fn rate_barrier_kind_constant_is_five() {
    assert_eq!(MARKET_KIND_RATE_BARRIER, 5u8);
}

#[test]
fn rate_barrier_payload_roundtrip() {
    let threshold_bps: u64 = 800;
    let window_start_slot: u64 = 1_000_000;
    let window_end_slot: u64 = 1_500_000;
    let rate_reader_selector: u64 = 1; // Kamino USDC supply APY

    let mut payload = [0u8; MARKET_PAYLOAD_LEN];
    set_payload_u64(&mut payload, 0, threshold_bps);
    set_payload_u64(&mut payload, 8, window_start_slot);
    set_payload_u64(&mut payload, 16, window_end_slot);
    set_payload_u64(&mut payload, 24, rate_reader_selector);

    assert_eq!(payload_u64(&payload, 0), threshold_bps);
    assert_eq!(payload_u64(&payload, 8), window_start_slot);
    assert_eq!(payload_u64(&payload, 16), window_end_slot);
    assert_eq!(payload_u64(&payload, 24), rate_reader_selector);

    // Reserved tail stays zero.
    for b in &payload[32..64] {
        assert_eq!(*b, 0u8);
    }
}
