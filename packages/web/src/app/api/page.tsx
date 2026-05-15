import Link from "next/link";
import {
  formatPriceUsd,
  READ_PRICE_FLOOR_USDC_MICRO,
  READ_PRICE_CEILING_USDC_MICRO,
} from "@/lib/pricing";

// /api — agent dev landing. Five bands:
//   1. Hero — Mario line for agent devs + two CTAs
//   2. The three reads — list / read_price / verify, with one-liners
//   3. Install — curl, TypeScript snippet, MCP config, sol-cli
//   4. Pricing — dynamic curve explanation + a worked example
//   5. Companion artifacts — links to sol-mcp, sol-cli, skill, github
//
// No data fetches; the page is static + 5min ISR. The curl block at the
// top is intentionally identical to the one on the home page so an agent
// dev can grab the same snippet they saw on the marketing surface.
export const revalidate = 300;

export const metadata = {
  title: "Build · Bundie — Markets that AI agents can read",
  description:
    "Bundie's Solana oracle: agents read live LMSR consensus prices for event markets, verify ed25519 attestations, and gate decisions on resolver track records. Dynamic pricing scales with market depth. Install over MCP, x402, or @bundie/sol-cli.",
};

export default function ApiPage() {
  return (
    <main className="min-h-screen bg-[var(--de-bg)] text-[var(--de-ink)]">
      <Hero />
      <ThreeReads />
      <Install />
      <Pricing />
      <Companions />
      <Footer />
    </main>
  );
}

function Hero() {
  return (
    <section
      className="relative overflow-hidden border-b border-[var(--de-line)] px-6 pb-20 pt-20 sm:px-12 sm:pt-32"
      style={{
        background:
          "radial-gradient(60% 40% at 50% 0%, var(--de-lavender-glow), transparent)",
      }}
    >
      <div className="relative mx-auto max-w-5xl">
        <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--de-ink-3)]">
          Bundie / For agents / x402 + MCP + CLI
        </p>
        <h1 className="max-w-4xl font-serif text-5xl leading-[1.02] tracking-tight sm:text-7xl">
          Your agent sees what&rsquo;s coming,
          <span className="italic text-[var(--de-lavender)]"> before the news does</span>.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-snug text-[var(--de-ink-2)]">
          Three reads, one signed payload, three ways to consume it.
          Bundie is a Solana-native oracle of forward-looking consensus
          on measurable events. Wire it once; your agent gains eyes on
          what&rsquo;s about to happen.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <a
            href="#install"
            className="inline-flex items-center gap-2 rounded-full bg-[var(--de-ink)] px-6 py-3 text-sm font-medium text-[var(--de-bg)] transition-transform duration-150 ease-out hover:-translate-y-px"
          >
            Install in 60 seconds
            <span aria-hidden="true">→</span>
          </a>
          <Link
            href="/markets"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--de-line-3)] px-6 py-3 text-sm font-medium text-[var(--de-ink)] transition-colors duration-150 ease-out hover:border-[var(--de-ink)]"
          >
            See live markets
            <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
          <span className="inline-flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-[var(--de-mint)]" />
            Devnet beta · Solana
          </span>
          <span>
            Reads from {formatPriceUsd(READ_PRICE_FLOOR_USDC_MICRO)}
          </span>
          <span>ed25519 attested</span>
        </div>
      </div>
    </section>
  );
}

function ThreeReads() {
  return (
    <section className="border-b border-[var(--de-line)] px-6 py-14 sm:px-12">
      <div className="mx-auto max-w-6xl">
        <SectionEyebrow title="The three reads" accent="all you need for a decision loop" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ToolCard
            n="01"
            name="list_events"
            blurb="Enumerate every market with live YES price, depth, and resolver class. Call once at startup."
          />
          <ToolCard
            n="02"
            name="read_price"
            blurb="The hero read. Returns YES probability, depth, 24h TWAP, recent move, resolver track record, ed25519 signed attestation."
          />
          <ToolCard
            n="03"
            name="verify_attestation"
            blurb="Local ed25519 verify against Bundie's cached attestation key. Trust the read before you trade on it."
          />
        </div>
      </div>
    </section>
  );
}

function ToolCard({ n, name, blurb }: { n: string; name: string; blurb: string }) {
  return (
    <div className="rounded-2xl border border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
        Read {n}
      </p>
      <p className="mt-2 font-mono text-lg text-[var(--de-lavender)]">{name}</p>
      <p className="mt-3 text-[14px] leading-relaxed text-[var(--de-ink-2)]">{blurb}</p>
    </div>
  );
}

function Install() {
  return (
    <section
      id="install"
      className="border-b border-[var(--de-line)] px-6 py-14 sm:px-12"
    >
      <div className="mx-auto max-w-6xl">
        <SectionEyebrow title="Install" accent="three doors, one product" />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <CodeBlock
            tag="MCP · Claude Desktop / Cursor / Codex"
            language="json"
            code={`{
  "mcpServers": {
    "bundie-sol": {
      "command": "npx",
      "args": ["-y", "@bundie/sol-mcp"]
    }
  }
}`}
          />
          <CodeBlock
            tag="HTTP · curl + x402"
            language="bash"
            code={`# 1. First call returns 402 with required amount
curl https://backend.solana.bundie.fi/v1/event-price?id=usdc_depeg_99c_30min_30d

# 2. Construct signed USDC transfer, retry with X-PAYMENT
curl -H "X-PAYMENT: $SIGNED_USDC_TRANSFER" \\
  https://backend.solana.bundie.fi/v1/event-price?id=usdc_depeg_99c_30min_30d`}
          />
          <CodeBlock
            tag="CLI · @bundie/sol-cli (write side)"
            language="bash"
            code={`# Read prices via MCP/HTTP; write actions via sol-cli
npx @bundie/sol-cli predict \\
  --event usdc_depeg_99c_30min_30d \\
  --side yes \\
  --amount 5`}
          />
        </div>
      </div>
    </section>
  );
}

function CodeBlock({
  tag,
  language,
  code,
}: {
  tag: string;
  language: string;
  code: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--de-line-2)] bg-[var(--de-bg-3)]">
      <div className="flex items-center justify-between border-b border-[var(--de-line)] px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
          {tag}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-4)]">
          {language}
        </span>
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[11.5px] leading-relaxed text-[var(--de-ink-2)]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Pricing() {
  return (
    <section className="border-b border-[var(--de-line)] px-6 py-14 sm:px-12">
      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <SectionEyebrow title="Pricing" accent="dynamic by market depth" />
          <h2 className="font-serif text-3xl leading-tight tracking-tight text-[var(--de-ink)] sm:text-4xl">
            The signal pays for itself,{" "}
            <span className="italic text-[var(--de-lavender)]">
              priced by what it&rsquo;s worth.
            </span>
          </h2>
          <p className="mt-5 max-w-lg text-base text-[var(--de-ink-2)]">
            Each read costs USDC, transferred over x402. The price scales
            with the market&rsquo;s depth — a thin market is cheap (signal
            is weak), a deep market is more expensive (signal is strong).
            Floor{" "}
            <span className="font-mono text-[var(--de-ink)]">
              {formatPriceUsd(READ_PRICE_FLOOR_USDC_MICRO)}
            </span>
            , ceiling{" "}
            <span className="font-mono text-[var(--de-ink)]">
              {formatPriceUsd(READ_PRICE_CEILING_USDC_MICRO)}
            </span>
            . Every response includes{" "}
            <span className="font-mono text-[var(--de-ink)]">
              read_price_usdc_micro
            </span>{" "}
            so your agent can bid the right amount on retry.
          </p>
          <p className="mt-4 max-w-lg text-sm text-[var(--de-ink-3)]">
            Logarithmic curve. A 10x depth jump produces ~3x price, not 10x
            — so heavy users still get a fair deal on the most-traded
            markets.
          </p>
        </div>
        <div className="overflow-hidden rounded-2xl border border-[var(--de-line-2)] bg-[var(--de-bg-raised)]">
          <div className="border-b border-[var(--de-line)] px-5 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
              Reference curve
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--de-line)] text-left text-[var(--de-ink-3)]">
                <th className="px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em]">
                  Market depth
                </th>
                <th className="px-5 py-2.5 text-right font-mono text-[10px] uppercase tracking-[0.18em]">
                  Read price
                </th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums text-[var(--de-ink-2)]">
              <PriceRow depth="$0 (stub)" price="$0.0001" note="floor" />
              <PriceRow depth="$500" price="$0.0001" note="floor (thin)" />
              <PriceRow depth="$1,000" price="$0.001" note="anchor" />
              <PriceRow depth="$5,000" price="$0.0041" />
              <PriceRow depth="$10,000" price="$0.0055" />
              <PriceRow depth="$50,000" price="$0.0086" />
              <PriceRow depth="$100,000+" price="$0.01" note="ceiling" />
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function PriceRow({
  depth,
  price,
  note,
}: {
  depth: string;
  price: string;
  note?: string;
}) {
  return (
    <tr className="border-b border-[var(--de-line)] last:border-b-0">
      <td className="px-5 py-2.5">{depth}</td>
      <td className="px-5 py-2.5 text-right">
        <span className="text-[var(--de-ink)]">{price}</span>
        {note ? (
          <span className="ml-2 text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-4)]">
            {note}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

function Companions() {
  return (
    <section className="border-b border-[var(--de-line)] px-6 py-14 sm:px-12">
      <div className="mx-auto max-w-6xl">
        <SectionEyebrow title="Companion artifacts" accent="everything ships open" />
        <ul className="divide-y divide-[var(--de-line)] border-t border-[var(--de-line)]">
          <CompanionRow
            tag="MCP server"
            name="@bundie/sol-mcp"
            blurb="Five tools + two prompts. Stdio + HTTP transports. ~50 LOC to wire into any MCP-compatible client."
            href="https://github.com/bundie-fi/mcp"
          />
          <CompanionRow
            tag="Write CLI"
            name="@bundie/sol-cli"
            blurb="Prepare-only Solana CLI — create markets, place bets, resolve. Returns unsigned base64 tx for external signing."
            href="https://github.com/bundie-fi/cli"
          />
          <CompanionRow
            tag="Skill"
            name="bundie-oracle-developer"
            blurb="Skill pack for Claude Code / Cursor / Codex teaching the circuit-breaker pattern step-by-step."
            href="https://github.com/bundie-fi/skills"
          />
          <CompanionRow
            tag="Backend"
            name="/v1 oracle API"
            blurb="REST + WebSocket. Historical reads via ?at=. Self-resolves from Pyth / Statuspage / AWS / Kamino TVL."
            href="https://backend.solana.bundie.fi"
          />
        </ul>
      </div>
    </section>
  );
}

function CompanionRow({
  tag,
  name,
  blurb,
  href,
}: {
  tag: string;
  name: string;
  blurb: string;
  href: string;
}) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="group flex flex-col gap-1 py-4 transition-colors duration-150 ease-out hover:bg-[var(--de-bg-2)] sm:flex-row sm:items-center sm:gap-6"
      >
        <span className="w-32 shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
          {tag}
        </span>
        <span className="w-56 shrink-0 font-mono text-[15px] text-[var(--de-lavender)]">
          {name}
        </span>
        <span className="flex-1 text-[14px] text-[var(--de-ink-2)]">{blurb}</span>
        <span
          className="ml-auto shrink-0 text-[var(--de-ink-3)] transition-transform duration-150 ease-out group-hover:translate-x-0.5"
          aria-hidden="true"
        >
          ↗
        </span>
      </a>
    </li>
  );
}

function Footer() {
  return (
    <footer className="px-6 py-12 sm:px-12">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 sm:flex-row sm:items-baseline sm:justify-between">
        <p className="font-serif text-xl tracking-tight text-[var(--de-ink)]">
          Built for AI agents.{" "}
          <span className="italic text-[var(--de-lavender)]">
            Priced by traders.
          </span>{" "}
          Settled by the chain.
        </p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
          <Link
            href="/markets"
            className="transition-colors duration-150 ease-out hover:text-[var(--de-ink)]"
          >
            Markets
          </Link>
          <Link
            href="/portfolio"
            className="transition-colors duration-150 ease-out hover:text-[var(--de-ink)]"
          >
            Portfolio
          </Link>
          <span>Cluster: solana:devnet</span>
        </div>
      </div>
    </footer>
  );
}

function SectionEyebrow({
  title,
  accent,
}: {
  title: string;
  accent: string;
}) {
  return (
    <div className="mb-8 border-b border-[var(--de-line)] pb-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--de-ink-3)]">
        {title}
      </p>
      <p className="mt-2 font-serif text-xl italic tracking-tight text-[var(--de-ink)]">
        {accent}
      </p>
    </div>
  );
}
