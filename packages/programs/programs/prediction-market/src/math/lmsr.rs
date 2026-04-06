//! LS-LMSR (Liquidity-Sensitive Logarithmic Market Scoring Rule)
//!
//! Cost function: C(q) = b(q) * ln(sum(e^(q_i / b(q))))
//! where q_i = shares outstanding for outcome i
//! and b(q) = alpha * sum(q_i) (liquidity scales with volume)
//!
//! Fixed-point arithmetic using u128 with 1e9 scaling factor.
//! All "scaled" values represent real numbers multiplied by SCALE.
//! For example, 1.5 is stored as 1_500_000_000.
//!
//! CRITICAL: Must fit within Solana's 1.4M CU budget.
//! Target < 200K CU per operation.

/// Fixed-point scaling factor: 1e9.
/// A value of SCALE represents 1.0 in real arithmetic.
const SCALE: u128 = 1_000_000_000;

/// SCALE cast as i128 for signed arithmetic.
const ISCALE: i128 = SCALE as i128;

/// ln(2) in fixed-point: 0.693147180559945... * 1e9 ≈ 693_147_180
const LN2: i128 = 693_147_180;

/// Maximum exponent input (20 * SCALE). Beyond this, e^x overflows u128.
/// e^20 ≈ 4.85e8, which in fixed-point is ~4.85e17, well within u128.
const EXP_MAX: i128 = 20 * ISCALE;

/// Minimum exponent input. e^(-20) ≈ 2e-9, which rounds to ~2 in fixed-point.
const EXP_MIN: i128 = -(20 * ISCALE);

/// Fixed-point exponential approximation: e^x where x is scaled by SCALE.
///
/// Uses a 5th-order Taylor series around 0:
///   e^x ≈ 1 + x + x²/2! + x³/3! + x⁴/4! + x⁵/5!
///
/// For large positive x (> EXP_MAX), returns a clamped safe maximum.
/// For large negative x (< EXP_MIN), returns 0 (underflow to zero).
///
/// # Arguments
/// * `x` - The exponent in fixed-point (scaled by 1e9). Can be negative.
///
/// # Returns
/// * `Some(result)` - e^x in fixed-point (scaled by 1e9)
/// * `None` - on arithmetic overflow
pub fn exp_fixed(x: i128) -> Option<u128> {
    // Clamp to avoid overflow
    if x > EXP_MAX {
        // e^20 * SCALE ≈ 485_165_195_409_790_278 — safe in u128
        return Some(485_165_195_409_790_278);
    }
    if x < EXP_MIN {
        // e^(-20) is negligible; return 0
        return Some(0);
    }

    // For negative x, compute e^|x| then invert: e^(-x) = SCALE^2 / e^x
    if x < 0 {
        let pos = exp_fixed(-x)?;
        if pos == 0 {
            return None; // division by zero guard
        }
        // e^(-x) = SCALE * SCALE / e^(|x|)
        let result = (SCALE as u128)
            .checked_mul(SCALE as u128)?
            .checked_div(pos)?;
        return Some(result);
    }

    // Taylor series: e^x ≈ 1 + x + x²/2 + x³/6 + x⁴/24 + x⁵/120
    // We compute each term incrementally.
    // term_k = x^k / k! in fixed-point.
    // term_{k+1} = term_k * x / ((k+1) * SCALE)

    let xu = x as u128; // safe: x >= 0 here
    let s = SCALE;

    // term0 = SCALE (represents 1.0)
    let term0: u128 = s;
    // term1 = x
    let term1: u128 = xu;
    // term2 = x * term1 / (2 * SCALE)
    let term2: u128 = xu.checked_mul(term1)?.checked_div(2u128.checked_mul(s)?)?;
    // term3 = x * term2 / (3 * SCALE)
    let term3: u128 = xu.checked_mul(term2)?.checked_div(3u128.checked_mul(s)?)?;
    // term4 = x * term3 / (4 * SCALE)
    let term4: u128 = xu.checked_mul(term3)?.checked_div(4u128.checked_mul(s)?)?;
    // term5 = x * term4 / (5 * SCALE)
    let term5: u128 = xu.checked_mul(term4)?.checked_div(5u128.checked_mul(s)?)?;

    term0
        .checked_add(term1)?
        .checked_add(term2)?
        .checked_add(term3)?
        .checked_add(term4)?
        .checked_add(term5)
}

/// Fixed-point natural logarithm: ln(x) where x is scaled by SCALE.
///
/// Uses repeated halving to bring x into the range [SCALE/2, SCALE],
/// then applies a 4th-order Taylor series for ln(1 + y) where y = (x - SCALE) / SCALE.
///
/// Identity used: ln(x) = ln(x / 2) + ln(2)
///
/// # Arguments
/// * `x` - The input in fixed-point (scaled by 1e9). Must be > 0.
///
/// # Returns
/// * `Some(result)` - ln(x) in fixed-point (signed, scaled by 1e9)
/// * `None` - if x == 0 (ln(0) is undefined) or on overflow
pub fn ln_fixed(x: u128) -> Option<i128> {
    if x == 0 {
        return None; // ln(0) is undefined
    }

    // Count how many times we need to halve x to bring it into [SCALE/2, SCALE*2)
    // ln(x) = ln(x / 2^k) + k * ln(2)
    let mut val = x;
    let mut halvings: i128 = 0;

    // Bring val down into range [SCALE/2, 2*SCALE) by repeated halving
    let upper = SCALE.checked_mul(2)?;
    while val >= upper {
        val = val.checked_div(2)?;
        halvings = halvings.checked_add(1)?;
    }

    // Bring val up if it's below SCALE/2 by repeated doubling (negative halvings)
    let lower = SCALE.checked_div(2)?;
    while val < lower && val > 0 {
        val = val.checked_mul(2)?;
        halvings = halvings.checked_sub(1)?;
    }

    // Now val is in [SCALE/2, 2*SCALE).
    // Compute ln(val) using ln(1 + y) where y = (val - SCALE) / SCALE.
    // y is in [-0.5, 1.0), so the Taylor series converges reasonably.
    //
    // ln(1 + y) ≈ y - y²/2 + y³/3 - y⁴/4
    //
    // In fixed-point, y = val - SCALE (since val is already scaled).

    let y: i128 = val as i128 - ISCALE;

    // y^2 / SCALE (keep in fixed-point)
    let y2 = y.checked_mul(y)?.checked_div(ISCALE)?;
    let y3 = y2.checked_mul(y)?.checked_div(ISCALE)?;
    let y4 = y3.checked_mul(y)?.checked_div(ISCALE)?;

    // ln(1+y) ≈ y - y²/2 + y³/3 - y⁴/4
    let ln_val = y
        .checked_sub(y2.checked_div(2)?)?
        .checked_add(y3.checked_div(3)?)?
        .checked_sub(y4.checked_div(4)?)?;

    // Final result: ln(x) = ln(val/SCALE)*SCALE + halvings * ln(2)
    ln_val.checked_add(halvings.checked_mul(LN2)?)
}

/// Calculate the liquidity parameter b for LS-LMSR.
///
/// b = max(alpha * (q_yes + q_no) / SCALE, initial_subsidy)
///
/// The liquidity parameter scales with total share volume so that markets
/// become less sensitive (more liquid) as trading increases.
/// `initial_subsidy` provides a floor so new markets are tradeable.
///
/// # Arguments
/// * `yes_shares` - Outstanding YES shares
/// * `no_shares` - Outstanding NO shares
/// * `alpha` - Liquidity sensitivity parameter (scaled by 1e9, e.g. 0.1 = 100_000_000)
/// * `initial_subsidy` - Minimum liquidity floor (in token base units)
///
/// # Returns
/// The liquidity parameter b (unscaled, in token base units)
pub fn calculate_b(
    yes_shares: u64,
    no_shares: u64,
    alpha: u64,
    initial_subsidy: u64,
) -> u64 {
    let total = yes_shares as u128 + no_shares as u128;
    let b = (alpha as u128 * total) / SCALE;
    // Minimum b from initial subsidy to ensure liquidity at start
    std::cmp::max(b as u64, initial_subsidy)
}

/// Calculate the cost to buy `amount` shares of a given outcome.
///
/// Uses the LMSR cost function for a binary market:
///   C(q) = b * ln(e^(q_yes/b) + e^(q_no/b))
///   cost = C(q_after) - C(q_before)
///
/// To avoid overflow from large exponents, we apply the log-sum-exp trick:
///   ln(e^a + e^b) = max(a, b) + ln(1 + e^(-|a - b|))
///
/// # Arguments
/// * `yes_shares` - Current outstanding YES shares
/// * `no_shares` - Current outstanding NO shares
/// * `liquidity_param` - The liquidity parameter b (see `calculate_b`)
/// * `outcome_is_yes` - true to buy YES shares, false for NO
/// * `amount` - Number of shares to buy
///
/// # Returns
/// * `Some(cost)` - Cost in base token units
/// * `None` - On arithmetic error
pub fn calculate_cost(
    yes_shares: u64,
    no_shares: u64,
    liquidity_param: u64,
    outcome_is_yes: bool,
    amount: u64,
) -> Option<u64> {
    if liquidity_param == 0 {
        return None;
    }

    let b = liquidity_param as i128;

    // State before purchase
    let q_yes_before = yes_shares as i128;
    let q_no_before = no_shares as i128;

    // State after purchase
    let (q_yes_after, q_no_after) = if outcome_is_yes {
        (q_yes_before.checked_add(amount as i128)?, q_no_before)
    } else {
        (q_yes_before, q_no_before.checked_add(amount as i128)?)
    };

    // Compute C(q) = b * log_sum_exp(q_yes/b, q_no/b) using the trick
    let c_before = lmsr_cost_fn(q_yes_before, q_no_before, b)?;
    let c_after = lmsr_cost_fn(q_yes_after, q_no_after, b)?;

    // cost = C(after) - C(before); should always be positive
    if c_after < c_before {
        return Some(0); // rounding guard
    }

    let cost = (c_after - c_before) as u64;
    Some(cost)
}

/// Internal: compute C(q) = b * ln(e^(q_yes/b) + e^(q_no/b))
///
/// Uses the log-sum-exp trick:
///   ln(e^a + e^b) = m + ln(1 + e^(-(|a-b|)))
/// where m = max(a, b), and a = q_yes/b, b_val = q_no/b (in fixed-point).
///
/// Returns C(q) in token base units (unscaled).
fn lmsr_cost_fn(q_yes: i128, q_no: i128, b: i128) -> Option<i128> {
    // a = q_yes * SCALE / b  (fixed-point representation of q_yes/b)
    let a = (q_yes as i128)
        .checked_mul(ISCALE)?
        .checked_div(b)?;
    let b_val = (q_no as i128)
        .checked_mul(ISCALE)?
        .checked_div(b)?;

    // log-sum-exp: max(a, b_val) + ln(1 + e^(-|a - b_val|))
    let m = std::cmp::max(a, b_val);
    let diff = (a - b_val).abs();

    // e^(-diff) in fixed-point
    let neg_diff = -diff;
    let exp_neg_diff = exp_fixed(neg_diff)?;

    // ln(1 + e^(-diff)): argument is (SCALE + exp_neg_diff) in fixed-point
    let inner = (SCALE as u128).checked_add(exp_neg_diff)?;
    let ln_inner = ln_fixed(inner)?;

    // log_sum_exp = m + ln_inner (both in fixed-point SCALE)
    let log_sum_exp = m.checked_add(ln_inner)?;

    // C(q) = b * log_sum_exp / SCALE  (convert back from fixed-point to base units)
    let cost = b
        .checked_mul(log_sum_exp)?
        .checked_div(ISCALE)?;

    Some(cost)
}

/// Calculate the price (probability) of an outcome.
///
/// For a binary market, the price of YES is the softmax:
///   p_yes = e^(q_yes/b) / (e^(q_yes/b) + e^(q_no/b))
///         = 1 / (1 + e^((q_no - q_yes) / b))
///
/// This is a sigmoid function. We compute it directly to avoid overflow.
///
/// # Arguments
/// * `yes_shares` - Current outstanding YES shares
/// * `no_shares` - Current outstanding NO shares
/// * `liquidity_param` - The liquidity parameter b
/// * `outcome_is_yes` - true for YES price, false for NO price
///
/// # Returns
/// * `Some(price)` - Price scaled by SCALE (0 to 1e9, representing 0% to 100%)
/// * `None` - On arithmetic error
pub fn calculate_price(
    yes_shares: u64,
    no_shares: u64,
    liquidity_param: u64,
    outcome_is_yes: bool,
) -> Option<u64> {
    if liquidity_param == 0 {
        return None;
    }

    let b = liquidity_param as i128;

    // For YES price: delta = (q_no - q_yes) (note: swapped for sigmoid)
    // For NO price:  delta = (q_yes - q_no)
    // p = SCALE / (1 + e^(delta / b))
    let delta = if outcome_is_yes {
        (no_shares as i128).checked_sub(yes_shares as i128)?
    } else {
        (yes_shares as i128).checked_sub(no_shares as i128)?
    };

    // delta_scaled = delta * SCALE / b (fixed-point exponent)
    let delta_scaled = delta
        .checked_mul(ISCALE)?
        .checked_div(b)?;

    // e^(delta_scaled) in fixed-point
    let exp_val = exp_fixed(delta_scaled)?;

    // price = SCALE * SCALE / (SCALE + exp_val)
    // The first SCALE is the desired output scale, the second accounts for exp_val being scaled.
    let denominator = (SCALE as u128).checked_add(exp_val)?;
    if denominator == 0 {
        return None;
    }

    let price = (SCALE as u128)
        .checked_mul(SCALE as u128)?
        .checked_div(denominator)?;

    Some(price as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOLERANCE: u64 = 10_000_000; // 1% tolerance for rounding

    /// Helper: absolute difference
    fn abs_diff(a: u64, b: u64) -> u64 {
        if a > b { a - b } else { b - a }
    }

    // ---- exp_fixed tests ----

    #[test]
    fn test_exp_zero() {
        // e^0 = 1.0 = SCALE
        let result = exp_fixed(0).unwrap();
        assert_eq!(result, SCALE);
    }

    #[test]
    fn test_exp_one() {
        // e^1 ≈ 2.71828... * 1e9
        let result = exp_fixed(ISCALE).unwrap();
        let expected: u128 = 2_718_281_828;
        // Taylor 5th order is approximate; allow ~0.5% error
        let diff = if result > expected { result - expected } else { expected - result };
        assert!(diff < 15_000_000, "exp(1) = {}, expected ~{}", result, expected);
    }

    #[test]
    fn test_exp_negative_one() {
        // e^(-1) ≈ 0.36788 * 1e9
        let result = exp_fixed(-ISCALE).unwrap();
        let expected: u128 = 367_879_441;
        let diff = if result > expected { result - expected } else { expected - result };
        assert!(diff < 15_000_000, "exp(-1) = {}, expected ~{}", result, expected);
    }

    #[test]
    fn test_exp_clamp_large() {
        // Very large x should return clamped max
        let result = exp_fixed(25 * ISCALE).unwrap();
        assert_eq!(result, 485_165_195_409_790_278);
    }

    #[test]
    fn test_exp_clamp_very_negative() {
        // Very negative x should return 0
        let result = exp_fixed(-25 * ISCALE).unwrap();
        assert_eq!(result, 0);
    }

    // ---- ln_fixed tests ----

    #[test]
    fn test_ln_one() {
        // ln(1.0) = ln(SCALE) = 0
        let result = ln_fixed(SCALE).unwrap();
        assert_eq!(result, 0);
    }

    #[test]
    fn test_ln_e() {
        // ln(e) = 1.0 = SCALE
        // e ≈ 2_718_281_828 in fixed-point
        let e_fp: u128 = 2_718_281_828;
        let result = ln_fixed(e_fp).unwrap();
        let diff = (result - ISCALE).abs();
        assert!(diff < 50_000_000, "ln(e) = {}, expected ~{}", result, ISCALE);
    }

    #[test]
    fn test_ln_two() {
        // ln(2.0) ≈ 0.693147 * 1e9
        let two_fp: u128 = 2 * SCALE;
        let result = ln_fixed(two_fp).unwrap();
        let diff = (result - LN2).abs();
        assert!(diff < 10_000_000, "ln(2) = {}, expected ~{}", result, LN2);
    }

    #[test]
    fn test_ln_zero_returns_none() {
        assert!(ln_fixed(0).is_none());
    }

    // ---- calculate_b tests ----

    #[test]
    fn test_calculate_b_floor() {
        // With 0 shares, b should equal initial_subsidy
        let b = calculate_b(0, 0, 100_000_000, 1_000);
        assert_eq!(b, 1_000);
    }

    #[test]
    fn test_calculate_b_scales() {
        // 1000 + 1000 shares, alpha = 0.1 (100_000_000)
        // b = 0.1 * 2000 = 200
        let b = calculate_b(1_000, 1_000, 100_000_000, 50);
        assert_eq!(b, 200);
    }

    // ---- calculate_price tests ----

    #[test]
    fn test_equal_shares_50_50() {
        // Equal shares should give 50% probability for both outcomes
        let b = 1_000u64;
        let p_yes = calculate_price(500, 500, b, true).unwrap();
        let p_no = calculate_price(500, 500, b, false).unwrap();
        assert!(
            abs_diff(p_yes, 500_000_000) < TOLERANCE,
            "p_yes = {}, expected ~500_000_000",
            p_yes
        );
        assert!(
            abs_diff(p_no, 500_000_000) < TOLERANCE,
            "p_no = {}, expected ~500_000_000",
            p_no
        );
    }

    #[test]
    fn test_prices_sum_to_scale() {
        // Prices of YES and NO should sum to approximately SCALE
        let b = 500u64;
        let p_yes = calculate_price(700, 300, b, true).unwrap();
        let p_no = calculate_price(700, 300, b, false).unwrap();
        let sum = p_yes as u128 + p_no as u128;
        let diff = if sum > SCALE { sum - SCALE } else { SCALE - sum };
        assert!(
            diff < TOLERANCE as u128,
            "p_yes({}) + p_no({}) = {}, expected ~{}",
            p_yes, p_no, sum, SCALE
        );
    }

    #[test]
    fn test_more_yes_shares_higher_yes_price() {
        // More YES shares should lead to higher YES price
        let b = 1_000u64;
        let p_balanced = calculate_price(500, 500, b, true).unwrap();
        let p_yes_heavy = calculate_price(800, 200, b, true).unwrap();
        assert!(
            p_yes_heavy > p_balanced,
            "p_yes with more YES shares ({}) should be > balanced ({})",
            p_yes_heavy, p_balanced
        );
    }

    #[test]
    fn test_large_imbalance_near_extremes() {
        // Large imbalance should push price near 0 or SCALE
        let b = 100u64;
        let p_yes = calculate_price(10_000, 0, b, true).unwrap();
        assert!(
            p_yes > 900_000_000,
            "With large YES imbalance, p_yes ({}) should be near SCALE",
            p_yes
        );

        let p_no = calculate_price(10_000, 0, b, false).unwrap();
        assert!(
            p_no < 100_000_000,
            "With large YES imbalance, p_no ({}) should be near 0",
            p_no
        );
    }

    // ---- calculate_cost tests ----

    #[test]
    fn test_cost_is_positive() {
        let b = 1_000u64;
        let cost = calculate_cost(500, 500, b, true, 100).unwrap();
        assert!(cost > 0, "Cost should be positive, got {}", cost);
    }

    #[test]
    fn test_buying_yes_increases_yes_price() {
        let b = 1_000u64;
        let price_before = calculate_price(500, 500, b, true).unwrap();
        // Simulate buying 200 YES shares
        let price_after = calculate_price(700, 500, b, true).unwrap();
        assert!(
            price_after > price_before,
            "YES price after buying YES ({}) should exceed before ({})",
            price_after, price_before
        );
    }

    #[test]
    fn test_cost_symmetric() {
        // Buying YES from (500, 500) should cost the same as buying NO from (500, 500)
        let b = 1_000u64;
        let cost_yes = calculate_cost(500, 500, b, true, 100).unwrap();
        let cost_no = calculate_cost(500, 500, b, false, 100).unwrap();
        assert!(
            abs_diff(cost_yes, cost_no) < 2,
            "Symmetric costs should match: yes={}, no={}",
            cost_yes, cost_no
        );
    }

    #[test]
    fn test_cost_zero_amount() {
        let b = 1_000u64;
        let cost = calculate_cost(500, 500, b, true, 0).unwrap();
        assert_eq!(cost, 0, "Zero amount should cost zero");
    }

    #[test]
    fn test_cost_zero_liquidity_returns_none() {
        assert!(calculate_cost(500, 500, 0, true, 100).is_none());
    }

    #[test]
    fn test_price_zero_liquidity_returns_none() {
        assert!(calculate_price(500, 500, 0, true).is_none());
    }

    #[test]
    fn test_larger_purchase_costs_more() {
        // Buying more shares should cost more (convexity)
        let b = 1_000u64;
        let cost_small = calculate_cost(500, 500, b, true, 50).unwrap();
        let cost_large = calculate_cost(500, 500, b, true, 200).unwrap();
        assert!(
            cost_large > cost_small,
            "Larger purchase ({}) should cost more than smaller ({})",
            cost_large, cost_small
        );
    }
}
