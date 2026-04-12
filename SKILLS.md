# yields-cli — Agent Interface for Yields.so

An AI agent can use `yields-cli` to autonomously interact with the Yields.so protocol on Solana devnet: launch investment strategies, invest in existing ones, place predictions on LS-LMSR markets, and read live on-chain NAV data — all without a browser or UI.

---

## Prerequisites

### 1. Wallet keypair

The CLI reads a Solana keypair JSON file. Default location is `~/.config/solana/id.json`. Pass a custom path with `--keypair`.

```bash
# Generate a new keypair if you don't have one
solana-keygen new --outfile ~/.config/solana/id.json
```

### 2. Devnet SOL (for transaction fees)

```bash
solana airdrop 2 --url devnet
```

### 3. Devnet USDC (for deposits and predictions)

Devnet USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`

Get devnet USDC from the Circle faucet:
- URL: https://faucet.circle.com
- Select "Devnet" and paste your wallet address

Minimum amounts: at least 1 USDC for strategy deposits; any positive amount for predictions.

### 4. Install the CLI

```bash
cd packages/cli
pnpm install
pnpm build
```

Set an alias for convenience:

```bash
alias yields-cli="node /mnt/storage/yields-v2/packages/cli/dist/index.js"
```

---

## Global Options

These flags apply to all commands:

| Flag | Description | Default |
|------|-------------|---------|
| `--keypair <path>` | Path to Solana keypair JSON | `~/.config/solana/id.json` |
| `--rpc <url>` | Solana RPC endpoint | Devnet public RPC |

---

## Commands

### `create-strategy`

Create a new on-chain investment strategy. Optionally make an initial USDC deposit in the same flow.

```
yields-cli create-strategy \
  --name <name> \
  [--protocol <kamino|marginfi|jupiter|<pubkey>>] \
  [--fee-bps <bps>] \
  [--deposit <usdc>] \
  [--min-deposit <usdc>] \
  [--usdc-mint <pubkey>]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--name` | Strategy name, max 32 chars (required) | — |
| `--protocol` | Protocol name or program address | `kamino` |
| `--fee-bps` | Performance fee in basis points (100 = 1%, 1000 = 10%) | `1000` |
| `--deposit` | Initial USDC deposit; `0` skips the deposit transaction | `0` |
| `--min-deposit` | Minimum USDC any investor must deposit | `1` |
| `--usdc-mint` | USDC mint address | Devnet USDC |

**Output** (stdout):

```
Creating strategy "Alpha Momentum" on devnet...
  wallet: <your-pubkey>

  create_strategy: <tx-sig>
  strategy: <strategy-address>
  mint:     <share-mint-address>

✓ Strategy created successfully.
```

Save the printed `strategy:` address — you'll need it for `buy-shares` and `nav`.

**Example — create with initial deposit:**

```bash
yields-cli create-strategy \
  --name "Alpha Momentum" \
  --protocol kamino \
  --fee-bps 500 \
  --deposit 100 \
  --min-deposit 10
```

**Example — create with no deposit:**

```bash
yields-cli create-strategy \
  --name "My Yield Vault" \
  --fee-bps 1000
```

---

### `buy-shares`

Invest USDC into an existing strategy and receive strategy share tokens in return.

```
yields-cli buy-shares \
  --strategy <pubkey> \
  --amount <usdc>
```

| Option | Description |
|--------|-------------|
| `--strategy` | Strategy account address (required) |
| `--amount` | USDC amount to invest (required) |

**Output** (stdout):

```
Buying shares of strategy 93amC41qp6YfTQwsugjgRG21eUtmbqiCx4VJjzE2xZYF...

  strategy: 93amC41qp6YfTQwsugjgRG21eUtmbqiCx4VJjzE2xZYF
  amount:   50 USDC
  tx:       <tx-sig>

✓ Shares purchased.
```

**Example — invest in the seeded Kamino Seed Strategy:**

```bash
yields-cli buy-shares \
  --strategy 93amC41qp6YfTQwsugjgRG21eUtmbqiCx4VJjzE2xZYF \
  --amount 50
```

---

### `predict`

Buy YES or NO shares on an LS-LMSR prediction market. Markets resolve automatically using on-chain NAV data from the linked strategy.

```
yields-cli predict \
  --market <pubkey> \
  --side <yes|no> \
  --amount <usdc>
```

| Option | Description |
|--------|-------------|
| `--market` | Prediction market address (required) |
| `--side` | `yes` or `no` — the outcome you are predicting (required) |
| `--amount` | USDC to stake (required) |

**Output** (stdout):

```
Predicting YES on market 2XfBNnZ5YEH23tB4QdCNzXu2bJmeY5WwmMuikGgZP8wu...

  market:   2XfBNnZ5YEH23tB4QdCNzXu2bJmeY5WwmMuikGgZP8wu
  side:     YES
  amount:   25 USDC
  implied:  62.5%
  tx:       <tx-sig>

✓ Prediction placed.
```

The `implied` field shows your estimated probability after the trade, derived from current YES/NO share counts.

**Example — predict YES on the seeded market:**

```bash
yields-cli predict \
  --market 2XfBNnZ5YEH23tB4QdCNzXu2bJmeY5WwmMuikGgZP8wu \
  --side yes \
  --amount 25
```

**Example — predict NO:**

```bash
yields-cli predict \
  --market 2XfBNnZ5YEH23tB4QdCNzXu2bJmeY5WwmMuikGgZP8wu \
  --side no \
  --amount 10
```

---

### `nav`

Read a strategy's current Net Asset Value, share price, TVL, investor count, and estimated APY. Read-only — no wallet signing or USDC required.

```
yields-cli nav \
  --strategy <pubkey>
```

| Option | Description |
|--------|-------------|
| `--strategy` | Strategy account address (required) |

**Output** (stdout):

```
  Strategy:     Kamino Seed Strategy
  Address:      93amC41qp6YfTQwsugjgRG21eUtmbqiCx4VJjzE2xZYF
  Type:         agent  |  Status: active
  Fee:          10%
  TVL:          $1000.00 USDC
  NAV:          $1043.21 USDC
  Total shares: 1000.000000
  Share price:  $1.043210 USDC
  APY (est):    +8.64%
  Investors:    3
```

**Example — check NAV of the seeded strategy:**

```bash
yields-cli nav \
  --strategy 93amC41qp6YfTQwsugjgRG21eUtmbqiCx4VJjzE2xZYF
```

---

## Quick Start

Complete sequence: create a strategy, invest in it, place a prediction, then check NAV.

```bash
# 1. Create a new strategy with a 10 USDC seed deposit
yields-cli create-strategy \
  --name "My AI Strategy" \
  --protocol kamino \
  --fee-bps 1000 \
  --deposit 10 \
  --min-deposit 1

# Note the printed strategy address, e.g.:
#   strategy: <new-strategy-address>

# 2. Buy shares in the seeded strategy (or use your newly created address)
yields-cli buy-shares \
  --strategy 93amC41qp6YfTQwsugjgRG21eUtmbqiCx4VJjzE2xZYF \
  --amount 50

# 3. Place a YES prediction on the seeded market
yields-cli predict \
  --market 2XfBNnZ5YEH23tB4QdCNzXu2bJmeY5WwmMuikGgZP8wu \
  --side yes \
  --amount 25

# 4. Check the strategy's NAV and current share price
yields-cli nav \
  --strategy 93amC41qp6YfTQwsugjgRG21eUtmbqiCx4VJjzE2xZYF
```

---

## Error Cases

All commands print errors to stderr and exit with code 1.

| Error message | Cause | Fix |
|---------------|-------|-----|
| `insufficient funds` | Wallet does not have enough USDC | Get devnet USDC from https://faucet.circle.com |
| `insufficient lamports` | Not enough SOL for transaction fees | `solana airdrop 2 --url devnet` |
| `Account not found` | Strategy or market address does not exist on devnet | Verify the address; use a seeded address from below |
| `--side must be "yes" or "no"` | Invalid value passed to `--side` | Use exactly `yes` or `no` |
| `market not active` | The prediction market is paused or already resolved | Check market status; use a different market |
| `amount below minimum deposit` | Deposit is less than the strategy's `min_deposit` | Increase `--amount` to meet the minimum |
| `name too long` | Strategy name exceeds 32 characters | Shorten `--name` |
| `invalid public key input` | A provided address is malformed | Double-check the base58 address |

---

## Seeded Addresses (Devnet)

Use these for immediate testing without creating new accounts.

| Resource | Address |
|----------|---------|
| Kamino Seed Strategy | `93amC41qp6YfTQwsugjgRG21eUtmbqiCx4VJjzE2xZYF` |
| Seeded Prediction Market | `2XfBNnZ5YEH23tB4QdCNzXu2bJmeY5WwmMuikGgZP8wu` |

---

## Program Addresses (Devnet)

| Program | Address |
|---------|---------|
| Strategy Token Program | `Y13kaQZ6NJgyfLiL5VjZ9k5QaFJnw4REM4A5Gsfg9VV` |
| Prediction Market Program | `Y13kynHKA6nfgDtYReVTuPZEVki6NmY9dYDihQT8j7i` |
| Devnet USDC Mint | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |

---

## Devnet Resources

| Resource | Link |
|----------|------|
| Devnet USDC Faucet | https://faucet.circle.com |
| Solana Devnet Faucet (SOL) | https://faucet.solana.com |
| Devnet Explorer | https://explorer.solana.com/?cluster=devnet |
