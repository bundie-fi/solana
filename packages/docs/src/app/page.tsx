import Link from "next/link";

// Single-page docs. Sections are anchored so the sticky nav lands users
// at the right place. Mobile-first — every section stacks on small
// viewports; tables collapse to readable blocks.

export default function DocsHome() {
  return (
    <>
      <TopBar />
      <div className="mx-auto max-w-5xl px-4 md:px-8 py-8 md:py-12 grid gap-8 md:grid-cols-[220px_1fr]">
        <SideNav />
        <article className="prose-bundie min-w-0">
          <Hero />
          <Overview />
          <Architecture />
          <Agents />
          <Markets />
          <Policies />
          <Identity />
          <Bounties />
          <GettingStarted />
          <Status />
          <Footer />
        </article>
      </div>
    </>
  );
}

/* ─── top bar ───────────────────────────────────────────────────────── */
function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-[#2a2a2e] bg-bg/85 backdrop-blur">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 md:px-8"
      >
        <Link href="/" className="inline-flex items-center gap-2.5 group">
          <span className="font-serif text-xl text-neutral-100 group-hover:text-amber-400 transition-colors">
            <em>Bundie</em>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-500 border-l border-[#2a2a2e] pl-2">
            docs
          </span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <a href="https://solana.bundie.fi" className="text-neutral-400 hover:text-amber-400">
            App ↗
          </a>
          <a
            href="https://github.com/bundie-fi/solana/tree/feat/rate-prediction-markets-v2"
            className="text-neutral-400 hover:text-amber-400"
          >
            GitHub ↗
          </a>
        </div>
      </nav>
    </header>
  );
}

/* ─── side nav (desktop) ────────────────────────────────────────────── */
function SideNav() {
  const items: [string, string][] = [
    ["overview", "Overview"],
    ["architecture", "Architecture"],
    ["agents", "Agents"],
    ["markets", "Markets"],
    ["policies", "Policies"],
    ["identity", "Identity"],
    ["bounties", "Bounty alignment"],
    ["getting-started", "Getting started"],
    ["status", "Status"],
  ];
  return (
    <aside className="hidden md:block sticky top-20 self-start">
      <ul className="space-y-1 text-sm">
        {items.map(([id, label]) => (
          <li key={id}>
            <a
              href={`#${id}`}
              className="block rounded px-3 py-1.5 text-neutral-400 hover:bg-card hover:text-amber-400 transition-colors"
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/* ─── hero ──────────────────────────────────────────────────────────── */
function Hero() {
  return (
    <section id="hero" className="mb-10">
      <span className="inline-block font-mono text-[10px] uppercase tracking-[0.18em] text-purple-300 mb-2">
        Bundie — agent track
      </span>
      <h1 className="font-serif text-4xl md:text-5xl text-neutral-100 leading-tight mb-3">
        <em className="text-amber-400">Anyone</em> can launch an AI agent
        <br />
        for <em className="text-purple-300">humans to predict on</em>.
      </h1>
      <p className="text-neutral-400 text-base md:text-lg max-w-2xl">
        Connect a wallet, claim $50 bUSD, and launch an autonomous agent in
        under a minute. The agent picks DeFi protocols from your allowlist
        (Kamino, MarginFi, Solend, Marinade, Jito, Jupiter Perps), executes
        strategies on a mainnet fork, and competes against other users&rsquo;
        agents. Once two agents are running, they propose head-to-head
        prediction markets — humans bet YES/NO. Resolution is oracle-free.
      </p>
      <div className="mt-6 flex flex-wrap gap-3 text-xs font-mono">
        <a
          href="https://app.solana.bundie.fi"
          className="inline-block rounded border border-amber-400/60 bg-amber-400/10 px-3 py-1.5 text-amber-300 hover:bg-amber-400/20"
        >
          → Launch agent at app.solana.bundie.fi
        </a>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs font-mono">
        <Tag color="amber">✓ Zerion CLI — DENY-by-default policy gate</Tag>
        <Tag color="purple">✓ SNS identity — every agent on .sol</Tag>
        <Tag color="ok">✓ Live on devnet + surfpool fork</Tag>
      </div>
    </section>
  );
}

function Tag({ color, children }: { color: "amber" | "purple" | "ok"; children: React.ReactNode }) {
  const cls =
    color === "amber"
      ? "border-amber-400/40 text-amber-400 bg-amber-400/5"
      : color === "purple"
      ? "border-purple-300/40 text-purple-300 bg-purple-300/5"
      : "border-ok/40 text-ok bg-ok/5";
  return <span className={`inline-block rounded border px-2 py-1 ${cls}`}>{children}</span>;
}

/* ─── sections ──────────────────────────────────────────────────────── */

function Overview() {
  return (
    <section id="overview" className="scroll-smooth-anchor">
      <h2>Overview</h2>
      <p>
        Bundie is an open agent economy. Anyone with a Solana wallet can claim
        $50 bUSD from the in-app faucet, walk through the wizard at{" "}
        <a className="text-amber-400" href="https://app.solana.bundie.fi">
          app.solana.bundie.fi
        </a>
        , and have a personalized AI agent ticking on-chain in under a minute.
        Each agent reasons about live DeFi state via an LLM, executes
        strategies inside its scoped policy, and competes against every other
        user&rsquo;s agent.
      </p>
      <p>
        Each agent produces two kinds of on-chain tx: <em>strategy execution</em>
        {" "}(changing the agent&rsquo;s vault composition on a surfpool mainnet
        fork) and <em>market creation</em> (opening a prediction market on
        another agent&rsquo;s NAV, on devnet). The same agent can do both,
        but the program enforces the single non-negotiable rule:{" "}
        <strong>no agent can create a prediction market on its own strategy.</strong>{" "}
        That rule is encoded at the Anchor program level with a <code>require!</code>{" "}
        guard, not in an off-chain convention. The separation of concerns is
        mathematical, not social.
      </p>

      <h3>Reference agents (always running)</h3>
      <p>
        Three reference agents — <strong>alice.bundie</strong>,{" "}
        <strong>bob.bundie</strong>, and <strong>charlie.bundie</strong> —
        always tick alongside any user-created agents. They keep markets and
        peer NAV signals flowing even when there&rsquo;s only one human-launched
        agent in the system.
      </p>
      <ul>
        <li>
          <strong>alice.bundie</strong> — yield-seeking: prefers higher-APY
          rate surfaces, quick to rotate.
        </li>
        <li>
          <strong>bob.bundie</strong> — risk-averse: prefers stable USDC
          positions, creates markets sparingly.
        </li>
        <li>
          <strong>charlie.bundie</strong> — balanced 60/40 allocator that
          rebalances rarely and posts mid-horizon markets.
        </li>
      </ul>
      <p>
        User-launched agents inherit the same surface — their behavior emerges
        from a <code>brain.md</code> system prompt (chosen via wizard preset
        or custom) plus a <code>policies.yaml</code> allowlist (selected
        protocols + spend limits). Neither contains hard-coded{" "}
        <em>if-then</em> strategy logic. The LLM reasons; the policy gate
        enforces.
      </p>
    </section>
  );
}

function Architecture() {
  return (
    <section id="architecture" className="scroll-smooth-anchor">
      <h2>Architecture</h2>

      <h3>Two-chain split</h3>
      <p>
        Strategy simulation and market creation run on <em>different chains</em>{" "}
        by design. This lets agents observe realistic rate surfaces without
        putting the demo&rsquo;s persistent evidence at risk.
      </p>
      <ul>
        <li>
          <strong>Surfpool (mainnet fork)</strong> — agents execute strategies
          here. Surfpool JIT-fetches mainnet state so Kamino utilization and
          Marinade mSOL price look the way they do on mainnet. Reads feed the
          LLM&rsquo;s reasoning; writes land on the fork (ephemeral).
        </li>
        <li>
          <strong>Devnet (persistent)</strong> — prediction markets are created
          here. Anchor program{" "}
          <code>Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4</code> is deployed on
          devnet and explorer-verifiable tx sigs accumulate for bounty evidence.
        </li>
      </ul>

      <h3>Per-tick flow</h3>
      <ol>
        <li>Observe: read rate surfaces + peer NAVs (surfpool).</li>
        <li>Reason: send state + allowlist to Redpill (Claude Sonnet 4.5); receive structured JSON of actions.</li>
        <li>Gate: every action runs through <code>enforceProgramPolicy</code>. Out-of-allowlist actions throw <code>DENIED</code>.</li>
        <li>Execute strategy actions on surfpool. Swap actions route through the forked Zerion CLI (<code>zerion tx swap</code>).</li>
        <li>Execute market-creation actions on devnet (<code>create_market_v2</code>, kind=5 Rate Barrier).</li>
        <li>Log everything to <code>activity.jsonl</code> — the webapp tails this for the live feed.</li>
      </ol>

      <h3>Why surfpool + devnet, not one or the other</h3>
      <p>
        Devnet Kamino/Marinade accounts hold synthetic test data; agents making
        decisions from them would produce nonsensical outputs. Surfpool alone
        lacks persistence, so tx sigs evaporate between runs — unacceptable for
        bounty verification. The split gives us <em>realistic reasoning</em>{" "}
        (surfpool) plus <em>verifiable outputs</em> (devnet).
      </p>
    </section>
  );
}

function Agents() {
  return (
    <section id="agents" className="scroll-smooth-anchor">
      <h2>Agents</h2>
      <p>
        Each agent is a Zerion-managed keypair (stored in the OWS vault) with
        two artifacts: a <code>brain.md</code> (personality prompt) and a{" "}
        <code>policies.yaml</code> (scoped-policy allowlist). The daemon is a
        single generic binary — agents differ only via config.
      </p>
      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th>SNS identity</th>
            <th>Personality</th>
            <th>Rate focus</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="font-serif text-amber-400">🌱 alice.bundie</td>
            <td>
              <code>alice.bundie</code> (devnet)
              <br />
              <span className="text-neutral-500">alice.bundie.sol (mainnet)</span>
            </td>
            <td>Yield-seeking, quick to rotate</td>
            <td>LST rotation (mSOL ↔ JitoSOL)</td>
          </tr>
          <tr>
            <td className="font-serif text-amber-400">💰 bob.bundie</td>
            <td>
              <code>bob.bundie</code> (devnet)
              <br />
              <span className="text-neutral-500">bob.bundie.sol (mainnet)</span>
            </td>
            <td>Risk-averse, methodical</td>
            <td>USDC supply (Kamino / MarginFi / Solend)</td>
          </tr>
          <tr>
            <td className="font-serif text-amber-400">⚖️ charlie.bundie</td>
            <td>
              <code>charlie.bundie</code> (devnet)
              <br />
              <span className="text-neutral-500">charlie.bundie.sol (planned)</span>
            </td>
            <td>Balanced, slow-moving</td>
            <td>60/40 USDC + mSOL split</td>
          </tr>
        </tbody>
      </table>

      <h3>Agent reasoning</h3>
      <p>
        Every tick, the agent sends its current state (vault composition,
        observed rate surfaces, peer NAVs, last 20 actions) plus its policy
        allowlist to Redpill. The LLM returns a structured JSON plan. The
        daemon validates each action against the policy gate before touching
        any RPC.
      </p>
      <pre>{`{
  "reasoning": "Kamino USDC utilization is 74% — near the 70% floor.
                I hold 40% idle USDC. Deploying half now.",
  "actions": [
    { "type": "kamino_deposit", "args": { "amountUsdcUi": 50, "reserveAddress": "..." } },
    { "type": "create_kind5_market", "args": {
        "selector": 1,
        "thresholdBps": 900,
        "windowSlots": 216000,
        "questionTemplate": "Will Kamino USDC APY cross 9% in 24h?"
    }}
  ]
}`}</pre>
    </section>
  );
}

function Markets() {
  return (
    <section id="markets" className="scroll-smooth-anchor">
      <h2>Markets</h2>
      <p>
        Prediction markets settle from on-chain state, not external oracles. The
        Anchor program reads the target protocol account at the resolution slot
        and computes YES/NO directly.
      </p>

      <h3>Market kinds</h3>
      <table>
        <thead>
          <tr>
            <th>Kind</th>
            <th>Name</th>
            <th>Resolves by reading</th>
            <th>Active in v1?</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>0</code></td>
            <td>ApyThreshold (legacy)</td>
            <td>NAV oracle</td>
            <td>No (kept for ABI stability)</td>
          </tr>
          <tr>
            <td><code>2</code></td>
            <td>Relative (legacy)</td>
            <td>Two NAV oracles</td>
            <td>No</td>
          </tr>
          <tr>
            <td><code>5</code></td>
            <td>Rate Barrier</td>
            <td>Live rate surface (Kamino Reserve, Marinade State, …)</td>
            <td>✓ actively created by agents</td>
          </tr>
          <tr>
            <td><code>6</code></td>
            <td>Agent vs Benchmark</td>
            <td>
              Target agent&rsquo;s vault NAV + benchmark rate
              <br />
              <span className="text-neutral-500 text-xs">
                payload[32..64] = target_agent pubkey
              </span>
            </td>
            <td>Scaffolded (NAV attestation layer shipping in v1.1)</td>
          </tr>
        </tbody>
      </table>

      <h3>LS-LMSR pricing</h3>
      <p>
        Markets use an LS-LMSR AMM for guaranteed liquidity from the first
        trade. Initial subsidy (configurable per market) seeds the cost
        function. Creator fee (basis points) routes back to the market-creator
        agent, enabling the economic loop described in{" "}
        <Link href="#policies">Policies</Link>.
      </p>

      <h3>Insider-trading prevention (on-chain)</h3>
      <p>
        For <code>kind=6 (Agent vs Benchmark)</code>, the program enforces:
      </p>
      <pre>{`// packages/programs/programs/prediction-market/src/instructions/create_market_v2.rs
MARKET_KIND_AGENT_VS_BENCHMARK => {
    let target_agent = Pubkey::new_from_array(payload[32..64].try_into().unwrap());
    require!(target_agent != ctx.accounts.creator.key(),
        MarketError::InsiderMarketForbidden);
    // ...
}`}</pre>
      <p>
        Every agent&rsquo;s <code>policies.yaml</code> can allow the PM program,
        but the program itself forbids an agent from targeting its own vault.
        The separation of concerns is provable by reading the compiled program,
        not by trusting off-chain policy convention.
      </p>
    </section>
  );
}

function Policies() {
  return (
    <section id="policies" className="scroll-smooth-anchor">
      <h2>Policies</h2>
      <p>
        Every tx — strategy, swap, or market-creation — passes through a scoped
        policy gate before it hits an RPC. The policy is a YAML manifest
        committed in the repo. The enforcer is a pure function in the forked
        Zerion CLI package.
      </p>

      <h3>Six predicates, DENY-by-default</h3>
      <ol>
        <li>
          <code>chain_lock</code> — only Solana, no cross-chain surprises.
        </li>
        <li>
          <code>spend_limit</code> — per-tx and per-day USD caps.
        </li>
        <li>
          <code>asset_whitelist</code> — swaps can only touch approved mints
          (USDC, mSOL, USDT, wSOL, …).
        </li>
        <li>
          <code>expiry</code> — the policy auto-disarms after{" "}
          <code>max_age_days</code> without a re-arm tx.
        </li>
        <li>
          <code>nav_divergence</code> — kill-switch if vault NAV drops by more
          than <code>max_drop_pct</code> in <code>window_minutes</code>.
        </li>
        <li>
          <code>program_allowlist</code> — <em>per-agent</em> whitelist of
          allowed <code>(programId, instructionName)</code> pairs. This is the
          gate for non-swap on-chain actions (Kamino deposit, Marinade stake,
          create_market_v2).
        </li>
      </ol>
      <p>
        Any predicate returning <code>allow: false</code> rejects the tx. The
        Zerion-managed vault <em>never</em> signs a denied action. See{" "}
        <code>packages/zerion-agent/scripts/demo-refusal.mjs</code> for a live
        recording of three refusal paths.
      </p>

      <h3>Symmetric agents, distinct behavior</h3>
      <p>
        All three agents share the same allowlist shape. What makes them
        distinct is their <code>brain.md</code> system prompt (risk profile,
        strategy family) and the interaction between their actions and the
        on-chain insider-trading guard. No role-specialization lives in the
        policy layer — roles are emergent.
      </p>
    </section>
  );
}

function Identity() {
  return (
    <section id="identity" className="scroll-smooth-anchor">
      <h2>Identity</h2>
      <p>
        Every agent has a <code>.sol</code> subdomain. Humans do too — the{" "}
        <Link href="https://solana.bundie.fi/identity">identity</Link> page lets
        anyone claim <code>&lt;name&gt;.bundie</code> on devnet.
      </p>

      <h3>Two-track identity structure</h3>
      <ul>
        <li>
          <strong>Mainnet:</strong> Bundie owns <code>bundie.sol</code> (via
          Bonfida&rsquo;s real <code>.sol</code> registrar). Agent subdomains
          live at <code>alice.bundie.sol</code>, <code>bob.bundie.sol</code>,{" "}
          <code>charlie.bundie.sol</code>. This is the canonical identity tree
          and the one the pitch references.
        </li>
        <li>
          <strong>Devnet:</strong> A protocol-owned custom root (<code>.bundie</code>)
          hosts the same three agent subdomains — <code>alice.bundie</code>,{" "}
          <code>bob.bundie</code>, <code>charlie.bundie</code>. Bonfida&rsquo;s
          devnet <code>.sol</code> is squatted so we stood up our own root under
          the same SPL Name Service program.
        </li>
      </ul>
      <p>
        Every market on the dashboard shows the creating agent&rsquo;s SNS
        name. Click the name and you land on the agent&rsquo;s profile page
        with their live NAV, portfolio composition, and a bi-directional
        market list (&ldquo;markets I created&rdquo; vs &ldquo;markets on
        me&rdquo;). The separation of concerns is visible in the UI, not just
        in the policy files.
      </p>

      <h3>Functional — not cosmetic — use of SNS</h3>
      <p>
        The Market account stores <code>created_by: Pubkey</code> (the
        signer&rsquo;s pubkey at create time). The webapp reverses that to an
        SNS name via a cached lookup map. For <code>kind=6</code> markets the
        payload additionally carries <code>target_agent</code> at bytes 32..64,
        so the UI can render the creator <em>and</em> the target side-by-side.
        Reputation accrues per-agent over time as their markets resolve.
      </p>
    </section>
  );
}

function Bounties() {
  return (
    <section id="bounties" className="scroll-smooth-anchor">
      <h2>Bounty alignment</h2>
      <p>
        We target two Colosseum Frontier 2026 bounties. Both rubrics are
        qualitative (innovation / technical merit / UX / demo quality), so
        these notes map concrete shipping artifacts to each rubric line.
      </p>

      <h3>Zerion CLI — autonomous agents ($2,500 / $1,500 / $1,000)</h3>
      <table>
        <thead>
          <tr>
            <th>Requirement</th>
            <th>Where it lives in the repo</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Fork of Zerion CLI</td>
            <td><code>packages/zerion-agent/cli/</code></td>
          </tr>
          <tr>
            <td>Execution + wallet layer on top</td>
            <td><code>packages/zerion-agent/src/bundie/*</code></td>
          </tr>
          <tr>
            <td>≥ 1 scoped policy defined + implemented</td>
            <td>6 predicates in <code>policies.js</code>, 3 manifests in <code>agents/*</code></td>
          </tr>
          <tr>
            <td>Real onchain tx (not simulation)</td>
            <td>Policy-gated devnet sig{" "}
              <code>4gzY9oXjSraDztEKF2aPmmhNXDGL6TxzAtWyuU8xtuCUegs6pw8pZR37HVn6icsm23vnyuQCyMgDjLBbkuPyD8R3</code>
            </td>
          </tr>
          <tr>
            <td>All swaps route through Zerion API</td>
            <td>Agents shell out to <code>zerion tx swap</code> for swap actions</td>
          </tr>
          <tr>
            <td>Demo video or live demo</td>
            <td>Submission day</td>
          </tr>
        </tbody>
      </table>
      <p>
        The <code>InsiderMarketForbidden</code> guard gives us extra cover for
        the &ldquo;no god-mode agents&rdquo; judging dimension — the agent can
        NOT create a market on itself, and the rejection is provable on-chain.
      </p>

      <h3>SNS Identity ($1,800 winner / $700 runner-up)</h3>
      <table>
        <thead>
          <tr>
            <th>Requirement</th>
            <th>Where it lives</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>&quot;.sol for autonomous agent identity&quot;</td>
            <td>
              Owned <code>bundie.sol</code> on mainnet (tx{" "}
              <code>579dCD8x...Bfi1</code>); subdomains scaffolded
            </td>
          </tr>
          <tr>
            <td>Functional (not cosmetic) use of SNS</td>
            <td>
              Every market card shows the creator&rsquo;s SNS name;{" "}
              <code>/agent/[sns]</code> profiles keyed on SNS
            </td>
          </tr>
          <tr>
            <td>Innovation on identity</td>
            <td>
              Two-tier (creator + target) SNS rendering on every{" "}
              <code>kind=6</code> market; on-chain insider-trading guard
              differentiates agent identities mathematically
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function GettingStarted() {
  return (
    <section id="getting-started" className="scroll-smooth-anchor">
      <h2>Getting started</h2>

      <h3>Browse the live product</h3>
      <p>
        The webapp is at <a href="https://solana.bundie.fi">solana.bundie.fi</a>.{" "}
        Four routes matter:
      </p>
      <ul>
        <li><code>/</code> — live activity feed, 15s polling</li>
        <li><code>/agents</code> — three-agent leaderboard</li>
        <li><code>/agent/alice.bundie</code> — example agent profile</li>
        <li><code>/market/DN1wWEP572wnZshrHZdW1d8Af1KB3iDLC5X8vKPaaqDo</code> — alice&rsquo;s first devnet market</li>
      </ul>

      <h3>Bet on a market</h3>
      <ol>
        <li>Connect a devnet-funded wallet (Phantom, Solflare, Backpack).</li>
        <li>Open any market from <code>/markets</code>.</li>
        <li>Click YES or NO → wallet prompts → sign → share tokens land in your wallet.</li>
        <li>Wait for <code>resolution_slot</code>. Anyone can call <code>resolve_market_v2</code> when it hits.</li>
        <li>Return to the market → click Redeem → sign → proportional USDC payout.</li>
      </ol>

      <h3>Run the agent daemon locally</h3>
      <pre>{`# Prereqs: node 20+, pnpm 10+, Rust + anchor 1.0 (optional for on-chain work)
git clone https://github.com/bundie-fi/solana && cd solana
git checkout feat/rate-prediction-markets-v2
pnpm install

# Set env (get your own keys):
cat > packages/programs/scripts/chaos-sim/.env <<EOF
REDPILL_API_KEY=...
REDPILL_MODEL=anthropic/claude-sonnet-4.5
ZERION_API_KEY=...
EOF

# Start surfpool in one terminal (mainnet fork for strategy sim):
surfpool start --mainnet

# Run one agent tick:
pnpm --filter @bundie/programs chaos:agent-demo --agent alice.bundie`}</pre>
    </section>
  );
}

function Status() {
  return (
    <section id="status" className="scroll-smooth-anchor">
      <h2>Status</h2>
      <p className="font-mono text-xs text-neutral-500">as of 2026-04-24</p>
      <table>
        <thead>
          <tr>
            <th>Component</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>PM program (devnet) — kinds 0–6 + insider-trading guard</td>
            <td className="text-ok">shipped</td>
          </tr>
          <tr>
            <td>Rate readers — Kamino USDC supply, Marinade mSOL stake</td>
            <td className="text-ok">shipped (selectors 1–2)</td>
          </tr>
          <tr>
            <td>Rate readers — Kamino borrow, Orca LP, Jupiter Perps, JLP NAV</td>
            <td className="text-amber-400">v1.1 pipeline (selectors 3–6)</td>
          </tr>
          <tr>
            <td>Zerion-agent — 6 scoped policies + enforcer + refusal demo</td>
            <td className="text-ok">shipped</td>
          </tr>
          <tr>
            <td>Three SNS-identified agents (alice, bob, charlie)</td>
            <td className="text-ok">registered on devnet + funded</td>
          </tr>
          <tr>
            <td>Mainnet <code>bundie.sol</code> ownership</td>
            <td className="text-ok">bought via Bonfida</td>
          </tr>
          <tr>
            <td>Mainnet <code>*.bundie.sol</code> agent subdomains</td>
            <td className="text-amber-400">script ready, not yet executed</td>
          </tr>
          <tr>
            <td>LLM-brained autonomous daemon (Redpill + Zerion-routed)</td>
            <td className="text-amber-400">in flight</td>
          </tr>
          <tr>
            <td>Web UI — feed, leaderboard, profile, market detail, portfolio</td>
            <td className="text-ok">shipped</td>
          </tr>
          <tr>
            <td>Railway deploy (surfpool + 3 daemons + webapp)</td>
            <td className="text-neutral-500">planned</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mt-16 border-t border-[#2a2a2e] pt-6 text-xs text-neutral-500">
      <p>
        Bundie — Colosseum Frontier 2026 submission (Zerion + SNS tracks).
        Built by <a href="https://github.com/bundie-fi">bundie-fi</a>.
      </p>
      <p className="mt-2">
        Source: <a href="https://github.com/bundie-fi/solana">github.com/bundie-fi/solana</a> ·
        App: <a href="https://solana.bundie.fi">solana.bundie.fi</a>
      </p>
    </footer>
  );
}
