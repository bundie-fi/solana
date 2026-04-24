use prediction_market::rate_readers::{rate_reader_for_selector, SELECTOR_MARINADE_MSOL_STAKE};

fn build_state_dump(msol_price_q32: u64) -> Vec<u8> {
    let mut buf = vec![0u8; 520];
    buf[512..520].copy_from_slice(&msol_price_q32.to_le_bytes());
    buf
}

#[test]
fn parity_price_returns_zero_bps() {
    let dump = build_state_dump(1u64 << 32); // exactly 1.0
    let reader = rate_reader_for_selector(SELECTOR_MARINADE_MSOL_STAKE).unwrap();
    assert_eq!(reader.read_apy_bps(&dump).unwrap(), 0);
}

#[test]
fn one_percent_above_parity_returns_100_bps() {
    // 1.01 in Q32.32 = Q32_ONE + (Q32_ONE / 100)
    let one_percent = (1u64 << 32) + ((1u64 << 32) / 100);
    let dump = build_state_dump(one_percent);
    let reader = rate_reader_for_selector(SELECTOR_MARINADE_MSOL_STAKE).unwrap();
    let bps = reader.read_apy_bps(&dump).unwrap();
    // Allow +/-1 bp tolerance for Q32.32 rounding
    assert!((99..=101).contains(&bps), "expected ~100 bps, got {}", bps);
}

#[test]
fn below_parity_returns_zero() {
    let dump = build_state_dump((1u64 << 32) - 1);
    let reader = rate_reader_for_selector(SELECTOR_MARINADE_MSOL_STAKE).unwrap();
    assert_eq!(reader.read_apy_bps(&dump).unwrap(), 0);
}

#[test]
fn truncated_dump_returns_zero() {
    let reader = rate_reader_for_selector(SELECTOR_MARINADE_MSOL_STAKE).unwrap();
    assert_eq!(reader.read_apy_bps(&[0u8; 100]).unwrap(), 0);
}
