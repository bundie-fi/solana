use prediction_market::rate_readers::{rate_reader_for_selector, SELECTOR_KAMINO_USDC_SUPPLY};

fn build_reserve_dump(available: u64, borrowed_native: u64, collateral_total: u64) -> Vec<u8> {
    let mut buf = vec![0u8; 1384];
    // 8-byte Anchor discriminator — value doesn't matter for reader
    buf[0..8].copy_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8]);
    buf[224..232].copy_from_slice(&available.to_le_bytes());
    let borrowed_sf: u128 = (borrowed_native as u128) << 60;
    buf[232..248].copy_from_slice(&borrowed_sf.to_le_bytes());
    buf[1376..1384].copy_from_slice(&collateral_total.to_le_bytes());
    buf
}

#[test]
fn zero_liquidity_returns_zero_bps() {
    let dump = build_reserve_dump(0, 0, 0);
    let reader = rate_reader_for_selector(SELECTOR_KAMINO_USDC_SUPPLY).unwrap();
    assert_eq!(reader.read_apy_bps(&dump).unwrap(), 0);
}

#[test]
fn fifty_percent_utilization_returns_5000_bps() {
    let dump = build_reserve_dump(50_000, 50_000, 100_000);
    let reader = rate_reader_for_selector(SELECTOR_KAMINO_USDC_SUPPLY).unwrap();
    assert_eq!(reader.read_apy_bps(&dump).unwrap(), 5_000);
}

#[test]
fn ninety_percent_utilization_returns_9000_bps() {
    let dump = build_reserve_dump(10_000, 90_000, 100_000);
    let reader = rate_reader_for_selector(SELECTOR_KAMINO_USDC_SUPPLY).unwrap();
    assert_eq!(reader.read_apy_bps(&dump).unwrap(), 9_000);
}

#[test]
fn truncated_dump_returns_zero() {
    let reader = rate_reader_for_selector(SELECTOR_KAMINO_USDC_SUPPLY).unwrap();
    assert_eq!(reader.read_apy_bps(&[0u8; 100]).unwrap(), 0);
}
