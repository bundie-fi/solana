# LS-LMSR: Liquidity-Sensitive Logarithmic Market Scoring Rule

## Why LS-LMSR

Standard prediction markets die without liquidity. LS-LMSR provides guaranteed liquidity at every price point from the first trade.

| Mechanism | Sophistication | Used in Colosseum? | Our Choice? |
|-----------|---------------|-------------------|-------------|
| Constant-product (Uniswap-style) | Low | Several | No — poorly suited for binary outcomes |
| Classic LMSR (Hanson) | Medium | tap2bet, Mood Ring | No — fixed liquidity parameter |
| **LS-LMSR** | **Medium-High** | **None** | **Yes** |
| pm-AMM (Paradigm, Nov 2024) | High | None | No — too complex for hackathon |

## The Math

### Cost Function
```
C(q) = b(q) * ln(Σ e^(q_i / b(q)))
```

For a binary market (YES/NO):
```
C(q) = b * ln(e^(q_yes/b) + e^(q_no/b))
```

### Liquidity Parameter
The "LS" in LS-LMSR means the liquidity parameter scales with volume:
```
b(q) = α * (q_yes + q_no)
```

With a minimum from initial subsidy to ensure liquidity at start.

### Price (Implied Probability)
```
p_yes = e^(q_yes/b) / (e^(q_yes/b) + e^(q_no/b))
      = 1 / (1 + e^((q_no - q_yes) / b))
```

This is a sigmoid function — prices are always between 0 and 1.

### Cost to Buy
```
cost = C(q_new) - C(q_old)
```

Where `q_new` has the purchased shares added to the relevant outcome.

## On-Chain Implementation

### Fixed-Point Arithmetic
Solana has no floating point. We use u128 with 1e9 scaling factor.

### Exponential Computation
For `e^x` on-chain, use the log-sum-exp trick:
```
ln(e^a + e^b) = max(a,b) + ln(1 + e^(-|a-b|))
```

Then approximate `ln(1 + e^(-x))` for small values using Taylor series:
```
ln(1 + e^(-x)) ≈ e^(-x) - e^(-2x)/2 + e^(-3x)/3
```

For `e^(-x)` with small x, use:
```
e^(-x) ≈ 1 - x + x²/2 - x³/6
```

### Compute Budget
Target: < 200K CU per buy_shares call.
Maximum: 1.4M CU (Solana limit with compute budget extension).

**Day 1 priority:** Prototype and benchmark before building anything else.

## References
- [Paradigm pm-AMM (Nov 2024)](https://paradigm.xyz/2024/11/pm-amm)
- [Hanson's LMSR (original paper)](https://mason.gmu.edu/~rhanson/mktscore.pdf)
- [a16z: AI Judges Scale Prediction Markets](https://a16zcrypto.com/posts/article/ai-judges-scale-prediction-markets)
