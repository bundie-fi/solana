# Self-serve on-chain market creation

> Status: **deferred**. The current `/launch` page captures proposals
> for admin review. Full self-serve (user wallet signs `create_event`
> directly) needs the architectural pieces below before it ships.

## What "self-serve" means

User opens `/launch`, fills the form, clicks "Sign and deploy", their
wallet signs a `create_event` tx, pays the subsidy, and the market is
trading within seconds. No admin review needed.

## Why it isn't shipped yet

Three coupled blockers. Solving each in isolation produces markets that
can't resolve.

### 1. Static registry, not dynamic

The resolver-runner at `packages/backend/src/v1/runner.ts` reads
`packages/programs/scripts/resolvers/sources.json` at startup and
again at each `loadRegistry()` call. The runner only polls events
that exist in that file.

A market created on-chain by a user wallet WILL exist as a `Market`
PDA, but the resolver runner won't poll it because the resolver doesn't
know it exists.

**Unblock**: replace `sources.json` with a Postgres-backed `markets`
table. The resolver runner queries the table on each tick. New
on-chain markets register themselves into the table (POST endpoint
called after tx confirmation).

### 2. Resolver authority + config-hash trust

`create_event` takes a `resolver: Pubkey` argument — that's the only
key allowed to call `resolve_event` on this market. It also takes a
`config_hash: [u8; 32]` that gets pinned in the `ResolverAuthority`
PDA. The runner refuses to resolve if its loaded `resolver_config`
doesn't hash to that pin.

If a public user picks an arbitrary resolver pubkey, they can resolve
the market however they like (including rugging it). If they pick
Bundie's resolver but with a `resolver_config` Bundie won't accept,
the runner refuses to fire — the market is stuck open forever.

**Unblock**: the form must lock the resolver pubkey to a **vetted
resolver registry** (today: just the `4rebicw8…` Bundie runner). The
user picks a resolver class template (`pyth_threshold_duration` etc.);
the form computes `resolver_config` from the user's parameters in a
shape the live resolver code already understands; the `config_hash` is
the sha256 of that canonical JSON. The backend validates each
parameter against per-class constraints before letting the tx submit.

### 3. Subsidy economics

`create_event` requires `initial_subsidy > 0` and transfers USDC from
the creator's ATA into the market vault. Today Bundie pays the $100
subsidy for every demo market via the admin wallet. If users self-serve,
they pay it.

That's fine in principle but raises UX questions:
- $100 is a meaningful barrier for casual creators
- A creator might want a smaller subsidy ($10 - tighter spreads, thin
  signal) or larger ($1k - real depth)
- Some categories (e.g. price feeds) might justify Bundie subsidising
  to seed the market

**Unblock**: form takes a `subsidy_usd` field with a slider (min $10),
shows the resulting LMSR depth + spread so the user sees what they're
buying. Bundie can layer a matching grant on top for high-value
categories (admin policy, not a code change).

## The full Phase B implementation plan

When the three blockers above are addressed:

### Backend
- `markets` table (Postgres): one row per event-market, replaces
  `sources.json`. Columns: `event_id`, `category`, `resolver_class`,
  `resolver_config_json`, `config_hash`, `market_pda`, `creator_wallet`,
  `created_at`, `status`, `featured` (admin curated).
- `runner.ts` reads from `markets` instead of `sources.json` per tick.
- `POST /v1/markets` endpoint: validates the per-class params, computes
  the canonical config_hash, returns the tx assembly inputs (PDAs,
  payload, config_hash) for the client to sign.
- `POST /v1/markets/:event_id/confirm` endpoint: takes a tx signature,
  fetches the tx from RPC, validates it matches what the backend
  pre-computed, inserts the row.
- `/v1/admin/markets/:id` to feature / unfeature / pause (admin only).

### Frontend
- `/launch` form gains a "Sign and deploy" branch that POSTs to
  `/v1/markets` for inputs, builds the tx client-side via
  `@coral-xyz/anchor` + the user's wallet, sends it, then calls
  `/v1/markets/.../confirm` with the resulting signature.
- The catalog grid reads from the `markets` table so user-created
  markets appear immediately.
- An optional "featured" tab in `/markets` shows admin-curated markets
  separately from the long tail of user-created ones.

### Programs
- No changes needed for v0 of self-serve — the existing `create_event`
  ix is already permissionless on-chain. The gating is purely client +
  backend.

## Estimated scope

| Piece | Effort |
|---|---|
| `markets` table + migration | 1 hour |
| Runner refactor (read DB instead of file) | 2 hours |
| Per-class param validators + config_hash computation | 3 hours |
| Tx-builder client lib (one per market kind) | 4 hours |
| Form integration + wallet signing + confirm-roundtrip | 3 hours |
| Admin feature/pause toggles | 1 hour |
| End-to-end testing on devnet | 2 hours |

**Total: ~2 focused days**. Worth doing as a single PR, not piecemeal.

## What ships today (Phase A)

- `/launch` page captures proposals via `/v1/market-proposals`
- `/admin/proposals` queue for review + status changes
- `market_proposals` table auto-migrated on backend startup
- Admin token-gated via `BUNDIE_ADMIN_TOKEN` env var

The current admin-driven flow works:
1. User submits proposal at `/launch`
2. Admin sees it at `/admin/proposals`, approves with a reviewer note
3. Admin manually adds to `sources.json` and runs:
   ```
   BUNDIE_EVENT_FILTER=<event_id> MARKET_ID_PREFIX=<safe_slot> \
     pnpm tsx packages/programs/scripts/create-demo-events.ts
   ```
4. Admin marks the proposal `deployed`

That's the v0 contract. Phase B replaces step 3 with the user's own
wallet signing.
