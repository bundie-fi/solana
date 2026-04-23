# Upstream diff vs `zeriontech/zerion-ai`

This fork is based on **`zeriontech/zerion-ai @ 376d30b2cb9fff41b84d55a49e842229468b1f08`**
("Merge pull request #14 from zeriontech/feat/mpp-payment").

To stay mergeable with future upstream releases, **all integration code is
additive** — it lives in `src/bundie/`, `src/cli.js`, `examples/bundie/`, and
`tests/unit/bundie-*.test.mjs`. Only two upstream files were touched, and
both changes are tiny and isolated.

## Files modified vs upstream

### 1. `package.json`

Three changes — name, scripts, bin. Diff in spirit:

```diff
-  "name": "zerion-cli",
-  "version": "0.4.2",
-  "description": "Zerion for AI agents and developers: hosted MCP docs, ...",
-  "author": "Zerion",
+  "name": "@bundie/zerion-agent",
+  "version": "0.0.1-poc",
+  "private": true,
+  "description": "Bundie x Zerion track — strategy rebalance agent on top of zerion-ai. Forked from zerion-cli.",
+  "author": "Bundie (fork of Zerion)",
   "type": "module",
   "bin": {
-    "zerion": "./cli/zerion.js"
+    "zerion": "./cli/zerion.js",
+    "zerion-bundie": "./src/cli.js"
   },
   "scripts": {
     "test": "node --test 'tests/**/*.test.mjs'",
     ...
+    "test:bundie": "node --test tests/unit/bundie-policies.test.mjs tests/unit/bundie-rebalance.test.mjs tests/unit/bundie-policy-loader.test.mjs",
+    "build": "node --check ...",
+    "bundie": "node src/cli.js",
-    "prepublishOnly": "npm test"
+    "prepublishOnly": "echo 'private package — do not publish' && exit 1"
   },
```

Why: rename to scope-private package so we can't accidentally publish to npm,
add the `zerion-bundie` bin entry, and add `test:bundie` + `build` scripts
that the Bundie monorepo expects.

### 2. `README.md`

Prepended a Bundie-track section (everything before the
`# Original zerion-ai README` divider). The upstream README content below
the divider is **byte-for-byte unchanged**.

## Files added (purely additive — no merge conflicts possible)

```
src/cli.js
src/bundie/policies.js
src/bundie/policy-loader.js
src/bundie/strategy-monitor.js
src/bundie/rebalance-loop.js
src/bundie/state-store.js
examples/bundie/policies.yaml
tests/unit/bundie-policies.test.mjs
tests/unit/bundie-rebalance.test.mjs
tests/unit/bundie-policy-loader.test.mjs
docs/UPSTREAM_DIFF.md
```

## Files removed

- `.git/`         (was the upstream git history; this fork lives inside the
                  Bundie monorepo, which has its own history)
- `.github/`      (upstream CI workflows would otherwise run on the parent
                  repo; safer to drop and re-introduce per Bundie's needs)

## How to upgrade from upstream

1. `git remote add upstream https://github.com/zeriontech/zerion-ai.git` (in a temp clone)
2. `git fetch upstream main`
3. Cherry-pick / merge upstream changes into this fork.
4. The only conflict points are `package.json` (resolve by keeping our `name`,
   `bin`, `scripts`) and `README.md` (resolve by keeping our prepended
   section above the `# Original zerion-ai README` divider).

## Calls into upstream code (not modified, just consumed)

| Caller                                              | Upstream symbol                                                  |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| `src/cli.js::loadLiveSwapExecutor`                  | `cli/lib/trading/swap.js` → `getSwapQuote`, `executeSwap`        |
| (transitively) `executeSwap` for Solana             | `cli/lib/chain/solana.js:26` → `signAndBroadcastSolana`          |
| (transitively) `executeSwap` for EVM                | `cli/lib/trading/transaction.js` → `signSwapTransaction`, `broadcastAndWait` |

If any of these signatures change in upstream, only `src/cli.js::loadLiveSwapExecutor`
needs an update.
