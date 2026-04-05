/// Unit tests for strategy-token pure math logic.
///
/// These test the core business logic (share calculation, performance fees,
/// TWAP EMA, state serialization) without deploying the program on-chain.

// =========================================================================
// Share Calculation Tests
// =========================================================================

/// Replicates the share math from buy_shares.rs
fn calc_shares(amount: u64, total_shares: u64, current_nav: u64) -> Option<u64> {
    if total_shares == 0 || current_nav == 0 {
        return Some(amount); // 1:1 first deposit
    }
    let numerator = (amount as u128).checked_mul(total_shares as u128)?;
    let shares = numerator.checked_div(current_nav as u128)?;
    if shares > u64::MAX as u128 {
        return None;
    }
    Some(shares as u64)
}

/// Replicates the withdrawal math from redeem_shares.rs
fn calc_withdrawal(shares: u64, current_nav: u64, total_shares: u64) -> Option<u64> {
    if total_shares == 0 {
        return None;
    }
    let result = (shares as u128)
        .checked_mul(current_nav as u128)?
        .checked_div(total_shares as u128)?;
    Some(result as u64)
}

#[test]
fn test_first_deposit_1_to_1() {
    // First deposit: shares = amount
    let shares = calc_shares(1_000_000, 0, 0).unwrap();
    assert_eq!(shares, 1_000_000);
}

#[test]
fn test_proportional_shares_at_par() {
    // NAV = 1000, shares = 1000, deposit 500 -> get 500 shares
    let shares = calc_shares(500, 1000, 1000).unwrap();
    assert_eq!(shares, 500);
}

#[test]
fn test_proportional_shares_nav_doubled() {
    // NAV grew to 2000 with 1000 shares. Deposit 1000 -> get 500 shares (price doubled)
    let shares = calc_shares(1000, 1000, 2000).unwrap();
    assert_eq!(shares, 500);
}

#[test]
fn test_proportional_shares_nav_halved() {
    // NAV dropped to 500 with 1000 shares. Deposit 500 -> get 1000 shares (price halved)
    let shares = calc_shares(500, 1000, 500).unwrap();
    assert_eq!(shares, 1000);
}

#[test]
fn test_shares_large_values() {
    // 1B USDC (6 decimals) with 1B shares at NAV = 1.1B
    let shares = calc_shares(
        1_000_000_000_000, // 1M USDC
        1_000_000_000_000_000, // 1B shares (9 decimals)
        1_100_000_000_000, // 1.1M USDC NAV
    ).unwrap();
    // Expected: 1M * 1B / 1.1M = ~909,090,909,090,909
    assert_eq!(shares, 909_090_909_090_909);
}

#[test]
fn test_shares_zero_amount_returns_zero() {
    let shares = calc_shares(0, 1000, 1000).unwrap();
    assert_eq!(shares, 0);
}

#[test]
fn test_withdrawal_proportional() {
    // 500 shares out of 1000, NAV = 2000 -> get 1000
    let withdrawal = calc_withdrawal(500, 2000, 1000).unwrap();
    assert_eq!(withdrawal, 1000);
}

#[test]
fn test_withdrawal_all_shares() {
    // Redeem all shares gets all NAV
    let withdrawal = calc_withdrawal(1000, 5000, 1000).unwrap();
    assert_eq!(withdrawal, 5000);
}

#[test]
fn test_withdrawal_zero_total_shares() {
    assert!(calc_withdrawal(100, 1000, 0).is_none());
}

#[test]
fn test_deposit_then_redeem_roundtrip() {
    // Deposit 1000, get 1000 shares. NAV stays 1000. Redeem 1000 shares -> get 1000 back.
    let initial_deposit = 1_000_000u64;
    let shares = calc_shares(initial_deposit, 0, 0).unwrap();
    assert_eq!(shares, initial_deposit);

    let withdrawal = calc_withdrawal(shares, initial_deposit, shares).unwrap();
    assert_eq!(withdrawal, initial_deposit);
}

#[test]
fn test_two_depositors_fair_share() {
    // Alice deposits 1000, gets 1000 shares. NAV = 1000.
    let alice_shares = calc_shares(1000, 0, 0).unwrap();
    assert_eq!(alice_shares, 1000);

    // Bob deposits 1000 when NAV = 1000, total_shares = 1000. Gets 1000 shares.
    let bob_shares = calc_shares(1000, 1000, 1000).unwrap();
    assert_eq!(bob_shares, 1000);

    // NAV is now 2000, total shares = 2000. Each redeems 1000 shares -> 1000 each.
    let alice_withdrawal = calc_withdrawal(alice_shares, 2000, 2000).unwrap();
    let bob_withdrawal = calc_withdrawal(bob_shares, 2000, 2000).unwrap();
    assert_eq!(alice_withdrawal, 1000);
    assert_eq!(bob_withdrawal, 1000);
}

#[test]
fn test_nav_growth_benefits_early_depositor() {
    // Alice deposits 1000 -> 1000 shares, NAV=1000.
    // NAV grows to 1500 (yield).
    // Bob deposits 1000 -> 666 shares (1000*1000/1500).
    let bob_shares = calc_shares(1000, 1000, 1500).unwrap();
    assert_eq!(bob_shares, 666); // truncated

    // Total: 1666 shares, NAV = 2500
    // Alice redeems 1000 shares -> 1000*2500/1666 = 1500
    let alice_out = calc_withdrawal(1000, 2500, 1666).unwrap();
    assert_eq!(alice_out, 1500); // truncated (1500.6)

    // Bob redeems 666 shares -> 666*2500/1666 = 999
    let bob_out = calc_withdrawal(666, 2500, 1666).unwrap();
    assert_eq!(bob_out, 999); // truncated (999.4)
}

// =========================================================================
// Performance Fee Tests
// =========================================================================

const NAV_SCALE: u128 = 1_000_000_000;

/// Replicates fee logic from redeem_shares.rs
fn calc_performance_fee(
    shares: u64,
    current_nav: u64,
    total_shares: u64,
    high_water_mark: u64, // per-share, 1e9 scaled
    fee_bps: u16,
) -> u64 {
    if total_shares == 0 || fee_bps == 0 {
        return 0;
    }

    let nav_per_share_now = (current_nav as u128) * NAV_SCALE / (total_shares as u128);
    let hwm_per_share = high_water_mark as u128;

    if nav_per_share_now > hwm_per_share {
        let profit_per_share = nav_per_share_now - hwm_per_share;
        let total_profit = profit_per_share * (shares as u128) / NAV_SCALE;
        let fee = total_profit * (fee_bps as u128) / 10_000;
        fee as u64
    } else {
        0
    }
}

#[test]
fn test_no_fee_when_nav_at_hwm() {
    // NAV = 1000, shares = 1000, HWM per share = 1e9 (1:1 ratio)
    let fee = calc_performance_fee(500, 1000, 1000, 1_000_000_000, 1000);
    assert_eq!(fee, 0);
}

#[test]
fn test_no_fee_when_nav_below_hwm() {
    // NAV dropped below HWM — no fee
    let fee = calc_performance_fee(500, 800, 1000, 1_000_000_000, 1000);
    assert_eq!(fee, 0);
}

#[test]
fn test_fee_on_profit_above_hwm() {
    // 1000 shares, NAV grew from 1000 to 1100. HWM = 1e9 (1.0 per share).
    // Nav per share now = 1.1e9. Profit per share = 0.1e9.
    // Redeeming 500 shares: total_profit = 0.1e9 * 500 / 1e9 = 50.
    // Fee at 10% (1000 bps) = 50 * 1000 / 10000 = 5.
    let fee = calc_performance_fee(500, 1100, 1000, 1_000_000_000, 1000);
    assert_eq!(fee, 5);
}

#[test]
fn test_fee_20_percent_on_full_redeem() {
    // 1000 shares, NAV grew from 1000 to 2000. HWM = 1e9.
    // Nav per share = 2e9. Profit per share = 1e9.
    // Redeeming all 1000: profit = 1e9 * 1000 / 1e9 = 1000.
    // Fee at 20% (2000 bps) = 1000 * 2000 / 10000 = 200.
    let fee = calc_performance_fee(1000, 2000, 1000, 1_000_000_000, 2000);
    assert_eq!(fee, 200);
}

#[test]
fn test_fee_zero_bps_means_no_fee() {
    let fee = calc_performance_fee(1000, 2000, 1000, 1_000_000_000, 0);
    assert_eq!(fee, 0);
}

#[test]
fn test_fee_with_multiple_depositors() {
    // Alice: 1000 shares at NAV 1000 (HWM = 1e9 per share)
    // Bob: 500 shares at NAV 1500 (deposited 750, got 500 shares)
    // NAV grows to 2250. Total shares = 1500.
    // Nav per share = 2250 * 1e9 / 1500 = 1.5e9
    // HWM = 1e9. Profit per share = 0.5e9
    // Alice redeems 1000: profit = 0.5e9 * 1000 / 1e9 = 500. Fee at 10% = 50.
    let fee = calc_performance_fee(1000, 2250, 1500, 1_000_000_000, 1000);
    assert_eq!(fee, 50);
}

#[test]
fn test_fee_after_hwm_updated() {
    // HWM updated to 1.5e9 per share. NAV now 1.8e9 per share (1800 NAV, 1000 shares).
    // Profit = (1.8e9 - 1.5e9) = 0.3e9 per share.
    // Redeem 500: profit = 0.3e9 * 500 / 1e9 = 150. Fee at 10% = 15.
    let fee = calc_performance_fee(500, 1800, 1000, 1_500_000_000, 1000);
    assert_eq!(fee, 15);
}

// =========================================================================
// TWAP EMA Tests
// =========================================================================

/// Replicates TWAP EMA from update_nav.rs
fn calc_twap_ema(
    nav_per_share: u64,
    old_twap: u64,
    slots_elapsed: u64,
    twap_window: u64,
) -> u64 {
    if twap_window == 0 {
        return nav_per_share;
    }
    let weight = slots_elapsed.min(twap_window);
    let complement = twap_window.saturating_sub(weight);
    ((nav_per_share as u128 * weight as u128 + old_twap as u128 * complement as u128)
        / twap_window as u128) as u64
}

#[test]
fn test_twap_first_snapshot() {
    // First snapshot: old_twap = nav_per_share, so EMA = nav_per_share
    let twap = calc_twap_ema(1_000_000_000, 1_000_000_000, 300, 9000);
    assert_eq!(twap, 1_000_000_000);
}

#[test]
fn test_twap_gradual_change() {
    // NAV jumps from 1.0 to 1.5, after 300 slots in 9000 window
    let twap = calc_twap_ema(1_500_000_000, 1_000_000_000, 300, 9000);
    // weight=300, complement=8700
    // (1.5e9*300 + 1.0e9*8700) / 9000 = (450e9 + 8700e9) / 9000 = 1016666666
    assert_eq!(twap, 1_016_666_666);
}

#[test]
fn test_twap_full_window_elapsed() {
    // Full window elapsed: EMA becomes current value
    let twap = calc_twap_ema(2_000_000_000, 1_000_000_000, 9000, 9000);
    assert_eq!(twap, 2_000_000_000);
}

#[test]
fn test_twap_beyond_window() {
    // More than window elapsed: capped at window, same as full window
    let twap = calc_twap_ema(2_000_000_000, 1_000_000_000, 20000, 9000);
    assert_eq!(twap, 2_000_000_000);
}

#[test]
fn test_twap_converges_over_multiple_updates() {
    let window = 9000u64;
    let interval = 300u64; // snapshot every 300 slots

    // Start: TWAP and NAV both at 1.0e9
    let mut twap = 1_000_000_000u64;
    let nav = 1_200_000_000u64; // NAV jumps to 1.2

    // EMA converges exponentially. After 30 snapshots (1 window), ~63% convergence.
    // After 90 snapshots (3 windows), ~95% convergence.
    for _ in 0..90 {
        twap = calc_twap_ema(nav, twap, interval, window);
    }

    // After 3 full windows, EMA should be very close to NAV
    let diff = if twap > nav { twap - nav } else { nav - twap };
    // With 300/9000 step ratio, convergence is ~95% after 3 windows. Allow 5% tolerance.
    let tolerance = (nav as f64 * 0.05) as u64;
    assert!(diff < tolerance, "TWAP {} should be within 5% of NAV {}, diff={}", twap, nav, diff);
}

#[test]
fn test_twap_stable_when_nav_constant() {
    let twap = calc_twap_ema(1_000_000_000, 1_000_000_000, 300, 9000);
    assert_eq!(twap, 1_000_000_000);

    let twap2 = calc_twap_ema(1_000_000_000, twap, 300, 9000);
    assert_eq!(twap2, 1_000_000_000);
}

// =========================================================================
// State Serialization Tests
// =========================================================================

#[test]
fn test_strategy_state_roundtrip() {
    use strategy_token::state::strategy::*;

    let mut data = vec![0u8; STRATEGY_LEN];

    Strategy::set_discriminator(&mut data);
    assert!(Strategy::check_discriminator(&data));

    let authority = [42u8; 32];
    Strategy::set_authority(&mut data, &authority);
    assert_eq!(Strategy::authority(&data), &authority);

    Strategy::set_fee_bps(&mut data, 1000);
    assert_eq!(Strategy::fee_bps(&data), 1000);

    Strategy::set_total_deposits(&mut data, 999_999);
    assert_eq!(Strategy::total_deposits(&data), 999_999);

    Strategy::set_current_nav(&mut data, 1_234_567);
    assert_eq!(Strategy::current_nav(&data), 1_234_567);

    Strategy::set_total_shares(&mut data, 5_000_000);
    assert_eq!(Strategy::total_shares(&data), 5_000_000);

    Strategy::set_high_water_mark(&mut data, 1_500_000_000);
    assert_eq!(Strategy::high_water_mark(&data), 1_500_000_000);

    Strategy::set_nav_twap_accumulator(&mut data, u128::MAX);
    assert_eq!(Strategy::nav_twap_accumulator(&data), u128::MAX);

    Strategy::set_strategy_type(&mut data, STRATEGY_TYPE_YIELD);
    assert_eq!(Strategy::strategy_type(&data), STRATEGY_TYPE_YIELD);

    Strategy::set_status(&mut data, STATUS_ACTIVE);
    assert_eq!(Strategy::status(&data), STATUS_ACTIVE);

    Strategy::set_bump(&mut data, 254);
    assert_eq!(Strategy::bump(&data), 254);

    Strategy::set_wallet_bump(&mut data, 253);
    assert_eq!(Strategy::wallet_bump(&data), 253);
}

#[test]
fn test_nav_oracle_state_roundtrip() {
    use strategy_token::state::nav_oracle::*;

    let mut data = vec![0u8; NAV_ORACLE_LEN];

    NavOracle::set_discriminator(&mut data);
    assert!(NavOracle::check_discriminator(&data));

    let strategy_key = [7u8; 32];
    NavOracle::set_strategy(&mut data, &strategy_key);
    assert_eq!(NavOracle::strategy(&data), &strategy_key);

    NavOracle::set_nav_per_share(&mut data, 1_200_000_000);
    assert_eq!(NavOracle::nav_per_share(&data), 1_200_000_000);

    NavOracle::set_twap_value(&mut data, 1_150_000_000);
    assert_eq!(NavOracle::twap_value(&data), 1_150_000_000);

    NavOracle::set_snapshot_count(&mut data, 42);
    assert_eq!(NavOracle::snapshot_count(&data), 42);

    NavOracle::set_min_snapshot_interval(&mut data, 300);
    assert_eq!(NavOracle::min_snapshot_interval(&data), 300);

    NavOracle::set_twap_window(&mut data, 9000);
    assert_eq!(NavOracle::twap_window(&data), 9000);

    NavOracle::set_bump(&mut data, 255);
    assert_eq!(NavOracle::bump(&data), 255);
}

#[test]
fn test_strategy_discriminator_rejects_wrong() {
    use strategy_token::state::strategy::*;

    let mut data = vec![0u8; STRATEGY_LEN];
    // Wrong discriminator
    data[0..8].copy_from_slice(&[0xFF; 8]);
    assert!(!Strategy::check_discriminator(&data));
}

#[test]
fn test_strategy_discriminator_rejects_short_data() {
    use strategy_token::state::strategy::*;

    let data = vec![0u8; 10]; // too short
    assert!(!Strategy::check_discriminator(&data));
}

// =========================================================================
// Edge Case Tests
// =========================================================================

#[test]
fn test_tiny_deposit_with_large_nav() {
    // NAV = 1_000_000_000 (1B), shares = 1000. Deposit 1 -> shares = 1*1000/1B = 0
    let shares = calc_shares(1, 1000, 1_000_000_000).unwrap();
    assert_eq!(shares, 0); // would be rejected by zero shares check
}

#[test]
fn test_fee_precision_small_profit() {
    // Very small profit: 0.001% gain. 1000 shares, NAV 1001, HWM 1e9.
    // Nav/share = 1.001e9. Profit/share = 0.001e9 = 1_000_000.
    // Redeem 1 share: profit = 1_000_000 * 1 / 1e9 = 0. Fee = 0.
    let fee = calc_performance_fee(1, 1001, 1000, 1_000_000_000, 1000);
    assert_eq!(fee, 0); // truncation means very small profits don't generate fees
}

#[test]
fn test_max_values_dont_overflow() {
    // Near u64::MAX values
    let shares = calc_shares(u64::MAX / 2, u64::MAX / 2, u64::MAX / 2);
    assert!(shares.is_some());
    assert_eq!(shares.unwrap(), u64::MAX / 2);
}
