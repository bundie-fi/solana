# Yields.so Agent Interface

You are an AI agent that can create and manage investment strategies on Yields.so — a Solana protocol where strategies are tradeable assets and anyone can predict which ones will outperform.

## Prerequisites

- Solana keypair at `~/.config/solana/id.json` (or set `ANCHOR_WALLET`)
- USDC in your wallet on Solana devnet
- `yields-cli` available: `node /path/to/yields-v2/packages/cli/dist/index.js`

Set an alias for convenience:
```
alias yields-cli="node /mnt/storage/yields-v2/packages/cli/dist/index.js"
```

---

## What You Can Do

### 1. Create an Investment Strategy

Launch a strategy as a tradeable on-chain asset. You define the name, target protocol, and fee. Others can invest in it and earn what it earns.

```bash
yields-cli create-strategy \
  --name "Funding Rate Arb" \
  --protocol kamino \
  --fee-bps 1000 \
  --deposit 100
```

Options:
- `--name` — strategy name, max 32 chars
- `--protocol` — `kamino`, `marginfi`, or `jupiter` (or a raw pubkey)
- `--fee-bps` — your performance fee (1000 = 10%)
- `--deposit` — initial USDC deposit (creates your first shares)
- `--min-deposit` — minimum deposit others must make (default: 1 USDC)

Output: strategy pubkey + transaction signature.

---

### 2. Buy Strategy Shares (Invest)

Invest in an existing strategy to earn its yield.

```bash
yields-cli buy-shares \
  --strategy <STRATEGY_PUBKEY> \
  --amount 50
```

Output: shares minted + transaction signature.

---

### 3. Predict on a Strategy

Place a YES or NO prediction on whether a strategy will hit its performance target. Uses LS-LMSR pricing — fair odds guaranteed from trade one.

```bash
yields-cli predict \
  --market <MARKET_PUBKEY> \
  --side yes \
  --amount 10
```

Options:
- `--side` — `yes` or `no`
- `--amount` — USDC stake

Output: shares bought + implied probability + transaction signature.

---

### 4. Check Strategy NAV

Read a strategy's current net asset value, share price, and estimated APY.

```bash
yields-cli nav --strategy <STRATEGY_PUBKEY>
```

Output: TVL, NAV, share price, APY, investor count.

---

## Example Flow

```bash
# Create a funding rate arbitrage strategy with 10% fee and 100 USDC seed capital
yields-cli create-strategy \
  --name "Funding Rate Arb" \
  --protocol kamino \
  --fee-bps 1000 \
  --deposit 100

# → strategy: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
# → tx: 5ZYt...

# Check its NAV
yields-cli nav --strategy 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU

# Predict it will exceed 20% APY
yields-cli predict \
  --market <MARKET_PUBKEY> \
  --side yes \
  --amount 25
```

---

## Notes

- All amounts are in USDC (whole numbers). The CLI handles decimals.
- Devnet only. RPC defaults to `https://api.devnet.solana.com`.
- Use `--rpc <url>` to override the RPC endpoint.
- Use `--keypair <path>` to use a different wallet.
- Strategy type is always `agent` when created via CLI — no Beethoven CPI is invoked at creation time.
