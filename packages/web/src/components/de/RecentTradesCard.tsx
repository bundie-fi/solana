/**
 * RecentTradesCard — dark editorial recap of an agent's most recent on-chain
 * actions. Rebuilds `SurfpoolActivityPanel` against `--de-*` tokens and the
 * tighter sidebar form factor.
 *
 * Each row collapses to:
 *   protocol logo · verb · amount + token · time-ago + tx link
 *
 * Pulls from the same `agent_action_log` Postgres table the legacy panel
 * uses. Server component — the parent fetches /api/agent/:sns/surfpool-activity
 * and passes the rows in. No client APIs.
 */
import type { CSSProperties } from "react";
import type { SurfpoolAction } from "@/components/surfpool-activity-panel";

const PROTOCOL_LOGO: Record<string, string> = {
  kamino: "/protocols/kamino.png",
  marinade: "/protocols/marinade.png",
  jito: "/protocols/jito.png",
  solend: "/protocols/solend.png",
  jupiter: "/protocols/jupiter.png",
  "jupiter-perps": "/protocols/jupiter-perps.png",
  marginfi: "/protocols/marginfi.png",
};

const ACTION_LABEL: Record<string, string> = {
  lend_deposit: "Deposit",
  lend_withdraw: "Withdraw",
  lst_stake: "Stake",
  lst_unstake: "Unstake",
  perp_open: "Open",
  perp_close: "Close",
  swap: "Swap",
  create_market: "Open market",
  commit_nav: "Commit NAV",
};

function actionLabel(raw: string): string {
  return ACTION_LABEL[raw] ?? raw.replace(/_/g, " ");
}

function formatAmount(action: SurfpoolAction): string | null {
  if (action.amountBaseUnits == null) return null;
  const isSolFamily =
    action.actionType === "lst_stake" ||
    action.actionType === "lst_unstake" ||
    action.protocol === "marinade" ||
    action.protocol === "jito";
  const decimals = isSolFamily ? 9 : 6;
  const ui = action.amountBaseUnits / 10 ** decimals;
  const unit = isSolFamily
    ? action.actionType === "lst_unstake"
      ? "mSOL"
      : "SOL"
    : "USDC";
  const fixed = isSolFamily ? ui.toFixed(4) : ui.toFixed(2);
  return `${fixed} ${unit}`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const deltaSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (deltaSec < 60) return `${deltaSec}s`;
  const m = Math.round(deltaSec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

function truncateSig(sig: string): string {
  if (sig.length <= 12) return sig;
  return `${sig.slice(0, 6)}…${sig.slice(-4)}`;
}

export interface RecentTradesCardProps {
  actions: SurfpoolAction[];
  /** Cap rows shown. Defaults to 6 for the sticky sidebar slot. */
  limit?: number;
  style?: CSSProperties;
}

export function RecentTradesCard({
  actions,
  limit = 6,
  style,
}: RecentTradesCardProps) {
  const visible = actions.slice(0, limit);

  return (
    <section
      style={{
        background: "var(--de-bg-raised)",
        border: "1px solid var(--de-line-2)",
        borderRadius: 12,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--de-ink-3)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          Recent trades
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--de-ink-4)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          {actions.length} total
        </span>
      </div>

      {visible.length === 0 ? (
        <div
          style={{
            padding: "28px 16px",
            textAlign: "center",
            border: "1px dashed var(--de-line-2)",
            borderRadius: 10,
            background: "var(--de-bg-3)",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: 14,
              color: "var(--de-ink-2)",
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            No trades on record.
          </p>
          <p
            style={{
              marginTop: 6,
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--de-ink-4)",
            }}
          >
            Agent has not deployed capital yet
          </p>
        </div>
      ) : (
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {visible.map((a) => (
            <TradeRow key={a.id} action={a} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TradeRow({ action }: { action: SurfpoolAction }) {
  const logo = PROTOCOL_LOGO[action.protocol];
  const amount = formatAmount(action);
  const ago = formatRelative(action.createdAt);

  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        background: "var(--de-bg-3)",
        border: "1px solid var(--de-line)",
        borderRadius: 10,
      }}
    >
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo}
          alt={action.protocol}
          width={24}
          height={24}
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            flexShrink: 0,
            objectFit: "cover",
          }}
        />
      ) : (
        <span
          aria-hidden
          style={{
            width: 24,
            height: 24,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 6,
            background: "var(--de-bg-2)",
            border: "1px solid var(--de-line-2)",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--de-ink-3)",
          }}
        >
          {action.protocol.slice(0, 2).toUpperCase()}
        </span>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 12.5,
              color: "var(--de-ink)",
              fontWeight: 500,
            }}
          >
            {actionLabel(action.actionType)}
          </span>
          {amount && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                color: "var(--de-lavender)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {amount}
            </span>
          )}
        </div>
        <div
          style={{
            marginTop: 2,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--de-ink-4)",
            letterSpacing: "0.04em",
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <span>{action.protocol}</span>
          <span aria-hidden>·</span>
          <span>{ago} ago</span>
        </div>
      </div>

      <a
        href={`https://orbmarkets.io/tx/${action.txSig}?cluster=devnet`}
        target="_blank"
        rel="noreferrer"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--de-ink-3)",
          textDecoration: "none",
          letterSpacing: "0.04em",
          flexShrink: 0,
        }}
        title={action.txSig}
      >
        {truncateSig(action.txSig)} ↗
      </a>
    </li>
  );
}
