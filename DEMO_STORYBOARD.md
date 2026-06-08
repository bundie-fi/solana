# Bundie — Demo Video Storyboard (verified 2026-06-07)

Per-clip shot list with exact surfaces, commands, and what appears on screen.
Narration timing tracks `demo-script.txt`. Record each clip clean and silent;
voiceover last. Every surface below was verified live against
`backend.solana.bundie.fi`.

**Hero market (the only live on-chain market):** `kamino_main_tvl_drop_50m_24h_90d`
**Market PDA:** `DiBhjyYXxWjzp3reF2y26ndJ5CqqNYSndB8GNLY4Jr99`
**Reads Kamino devnet Reserve:** `9uKMtFU9UJ9DfbwzCReGENb31appi79KTEeDGdCnvMjy`

---

## DO THIS FIRST (pre-flight — off camera)

1. **Place one small YES bet** on the hero market in `app.solana.bundie.fi` with a
   funded devnet Phantom (bUSD from the faucet). This (a) proves tradeability — the
   one thing not verifiable headlessly — and (b) bumps 24h-trades off zero so the
   detail page shows live confidence instead of `0`. If the buy reverts with
   "Unexpected error" (ConstraintRaw 2003), the market needs reseeding with the bUSD
   mint before you film.
2. **Warm the payment terminal** once (npx cold-start + blockhash fetch are slow):
   run the Shot B commands below once, then clear the screen.
3. Light theme, 1440p+ capture, no wallet PII in frame.

---

## Clip 1 — Hook + Problem  [0:00–0:35]
- **Surface:** `https://app.solana.bundie.fi/markets`
- **Do:** Slow scroll across the grid. Hover 2–3 cards so the outcome questions read.
- **On screen:** On-chain markets sort first with the green **"Settled on-chain"** badge.
- **Gotchas:**
  - Tight-crop to the **top rows** (the `onchain_tvl` markets). AWS/Anthropic/Cloudflare/
    OpenAI cards are off-chain (statuspage) and sit below — keep them out of frame.
  - Do NOT point at the depeg markets as the moat — they resolve via **Pyth** (external
    oracle), the opposite of the "reads the chain" claim.

## Clip 2 — Hero market  [0:35–1:05]
- **Surface:** `https://app.solana.bundie.fi/markets/kamino_main_tvl_drop_50m_24h_90d`
- **Do:** Pause on the YES/NO price (~52% YES). Say "that price *is* the implied
  probability." Point at the **"Settled on-chain"** section / resolver = on-chain read.
  Optionally place the YES bet here on camera and watch the price tick.
- **On screen (verified live):** YES 52.0%, depth $108, resolver `onchain_tvl_rolling_window`.
- **Gotcha:** Don't expand/show the raw `resolver_config`/notes — it contains a devnet
  honesty caveat (`price_usd=1.0` stub) that reads badly out of context. The TVL read
  itself is from the real Kamino reserve; only the USD conversion is stubbed.

## Clip 3 — The oracle moment (Shot B)  [1:05–1:35]  ← the single most important frame

Two ways to film it. **B-pay** matches the script's "watch the X-PAYMENT header."
**B-mcp** is the agent-native version. Showing B-mcp then B-pay (read it, then pay for
it) is the strongest 30s if you have room.

### Option B-pay — real X-PAYMENT round-trip (verified working)
Two terminals. Treasury is shared via env.
```bash
cd packages/backend
export DEMO_TREASURY=$(node -e "const{Keypair}=require('@solana/web3.js');console.log(Keypair.generate().publicKey.toBase58())")

# Terminal 1 — the enforced oracle gate (paid mode)
NODE_NO_WARNINGS=1 node x402-demo/gate.mjs

# Terminal 2 — a paying AI agent
NODE_NO_WARNINGS=1 node x402-demo/pay-and-read.mjs
```
- **On screen (verified):**
  ```
  STEP 1 — GET without payment → HTTP 402   price: 100 base units ($0.0001)
  STEP 2 — built + signed bUSD transfer tx (X-PAYMENT)
  STEP 3 — GET with X-PAYMENT → HTTP 200  (X-X402-Tier: paid)  YES 52.0%  on-chain resolver
  STEP 4 — ed25519 verify → VALID ✓ tamper-proof
  ```
- **Why local:** the deployed backend runs x402 in free tier. Enforcing it in prod would
  402 the web app AND the MCP (neither pays) — breaking Clips 2 and B-mcp. The local gate
  runs the *exact* production verification code and serves the *real* signed upstream price,
  so the payment + data on camera are genuine; only enforcement is moved off the shared
  endpoint.

### Option B-mcp — agent reads via MCP (deck-preferred, verified)
In Claude Code (or any MCP client) with `@bundie/sol-mcp` connected:
- Call `read_price` with `event_id: kamino_main_tvl_drop_50m_24h_90d` → signed price.
- Call `verify_attestation` with the full response → `valid: true`, signer `DA83YA…`.
- **Captions** (judges watch muted): `read_price`, `$0.001`, `signed`, `ed25519 VALID`.

## Clip 4 — Moat + Close  [1:35–2:00]
- **Surface:** back to the hero market, optionally split with explorer.
- **Optional Shot D:** `https://explorer.solana.com/address/DiBhjyYXxWjzp3reF2y26ndJ5CqqNYSndB8GNLY4Jr99?cluster=devnet`
  — proves the market exists on-chain (accounts). Note: there is **no on-chain *resolve*
  tx** to show — the hero is active, and the only resolved market is off-chain. Don't film
  a resolve tx; show the account instead.
- **Close card:** "Bundie — the oracle agents read to price the future" + the three URLs.

---

## Consistency note (why the numbers match)
The grid, the detail page, the MCP, and the x402 read all source from the live `/v1`
endpoint → all show **YES ~52% / depth $108**. Do NOT film the legacy `/api/markets`
surface (shows a stale 0.76 / "ended") — it is not used by the markets pages.
