use prediction_market::rate_readers::rate_reader_for_selector;

#[test]
fn selector_1_maps_to_kamino_usdc_supply() {
    let reader = rate_reader_for_selector(1).expect("selector 1 must resolve");
    assert_eq!(reader.name(), "kamino-usdc-supply");
}

#[test]
fn selector_2_maps_to_marinade_msol_stake() {
    let reader = rate_reader_for_selector(2).expect("selector 2 must resolve");
    assert_eq!(reader.name(), "marinade-msol-stake");
}

#[test]
fn unknown_selector_returns_none() {
    assert!(rate_reader_for_selector(99).is_none());
}
