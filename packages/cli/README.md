# @bundie/sol-cli

Bundie Solana CLI — the agent surface for composing strategies, opening prediction markets, and resolving them on-chain.

**Binary:** `bundie-sol`
**Network:** Solana devnet (mainnet post-hackathon)
**Programs:** Strategy Token + Prediction Market on Solana

---

## Install

```bash
npm install -g @bundie/sol-cli
```

Or run ad-hoc with `npx`:

```bash
npx @bundie/sol-cli --help
```

---

## Quick start

```bash
# Prereqs
solana-keygen new --outfile ~/.config/solana/id.json
solana airdrop 2 --url devnet

# Get devnet USDC from https://faucet.circle.com

# Launch a Kamino USDC lending strategy with 10% performance fee
bundie-sol create-strategy --name "Stable Compounder" --protocol kamino --fee-bps 1000 --deposit 50

# Back an existing strategy with 25 USDC
bundie-sol buy-shares --strategy <PUBKEY> --amount 25

# Predict YES on an existing market with 10 USDC
bundie-sol predict --market <PUBKEY> --outcome yes --amount 10

# Read live NAV
bundie-sol nav --strategy <PUBKEY>
```

---

## Commands

| Command | Role | What it does |
|---|---|---|
| `create-strategy` | Strategy-creator | Mint a new strategy share via Beethoven + Kamino |
| `buy-shares` | Backer | Buy shares at current NAV |
| `predict` | Predictor | Take a YES/NO position on a market |
| `nav` | anyone | Read live NAV / share price / APY |

Full command reference, archetype flows (strategy-creator + market-maker), and Mode 1 (human-triggered) vs Mode 2 (autonomous loops) examples live in [SKILLS.md](https://github.com/bundie-fi/yields-v2/blob/main/SKILLS.md) in the main repo.

---

## For AI agents

Point Claude Code, Cursor, elizaOS, ZerePy, or any shell-capable agent at this CLI plus the SKILLS.md file. Two invocation modes:

**Mode 1** — human-triggered in Claude Desktop / Cursor: "Compose a conservative USDC lending strategy on Kamino with a 10% performance fee." → agent reads SKILLS.md → invokes `bundie-sol create-strategy`.

**Mode 2** — autonomous: a long-running worker (cron, ZerePy, elizaOS action, headless `claude -p` loop) polls on its own triggers and composes CLI commands without a human prompt per action.

---

## Links

- Protocol: [bundie.fi](https://bundie.fi)
- EVM sibling: [`@bundie/evm-mcp`](https://www.npmjs.com/package/@bundie/evm-mcp)
- Repo: [github.com/bundie-fi/yields-v2](https://github.com/bundie-fi/yields-v2)

## License

MIT
