/**
 * Recent on-chain activity for one agent. Each row is a real tx the
 * agent's runtime broadcast against the protocol named in the pill.
 * Server component, agent profile page is SSR.
 */

export interface SurfpoolAction {
  id: number;
  slot: number;
  txSig: string;
  protocol: string;
  actionType: string;
  amountBaseUnits: number | null;
  tokenMint: string | null;
  notes: string | null;
  createdAt: string;
}

// Protocol logo set lives in /public/protocols/<id>.png (mirrored from the
// landing page so we share the same artwork). Listed here drives the
// "render an Image instead of an emoji" branch in ActivityRow.
const PROTOCOL_LOGO: Record<string, string> = {
  kamino:          "/protocols/kamino.png",
  marinade:        "/protocols/marinade.png",
  jito:            "/protocols/jito.png",
  solend:          "/protocols/solend.png",
  jupiter:         "/protocols/jupiter.png",
  "jupiter-perps": "/protocols/jupiter-perps.png",
};

// Fallback emoji for any protocol not in PROTOCOL_LOGO. Should never fire
// in practice since the executor table is the source of truth — keep as
// a defensive default.
const PROTOCOL_EMOJI_FALLBACK = "🔗";

// Tokens with 9 decimals (SOL family) vs 6 decimals (USDC etc.). The
// recorder stores raw base units in amount_base_units regardless of token —
// here we infer decimals from action_type for a friendlier display.
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
  // Two decimals for USDC, four for SOL, keeps the row tight.
  const fixed = isSolFamily ? ui.toFixed(4) : ui.toFixed(2);
  return `${fixed} ${unit}`;
}

function isPlaceholder(action: SurfpoolAction): boolean {
  if (!action.notes) return false;
  return action.notes.toLowerCase().includes("placeholder")
    || action.notes.toLowerCase().includes("cpi pending")
    || action.notes.toLowerCase().includes("policy-gated");
}

interface RowMeta {
  market?: string;
  side?: "long" | "short";
  notional?: string;
  destination?: string;
}
function rowMeta(action: SurfpoolAction): RowMeta {
  const out: RowMeta = {};
  if (!action.notes) return out;
  if (action.protocol === "marinade") {
    // "Marinade stake: 2 SOL → mSOL @ 7Tk9aL2P…"
    const m = action.notes.match(/@\s+([A-Za-z0-9]+(?:…|\.{3}))/);
    if (m) out.destination = m[1];
  } else if (action.protocol === "jupiter-perps") {
    // "Jupiter Perps long SOL-PERP 250 USDC notional"
    const m = action.notes.match(/(long|short)\s+([A-Z0-9-]+)\s+(\d+(?:\.\d+)?)/i);
    if (m) {
      out.side = m[1].toLowerCase() as "long" | "short";
      out.market = m[2];
      out.notional = m[3];
    } else {
      const cl = action.notes.match(/close\s+([A-Z0-9-]+)/i);
      if (cl) out.market = cl[1];
    }
  }
  return out;
}

// Map raw action types from the daemon log to user-friendly verbs.
// Anything not in the map falls through to the raw key, flag in
// review if a new action type slips past here.
const ACTION_LABEL: Record<string, string> = {
  lend_deposit: "Lent",
  lend_withdraw: "Withdrew",
  lst_stake: "Staked",
  lst_unstake: "Unstaked",
  perp_open: "Opened",
  perp_close: "Closed",
  swap: "Swapped",
  create_market: "Opened market",
  commit_nav: "Updated NAV",
};
function actionLabel(raw: string): string {
  return ACTION_LABEL[raw] ?? raw;
}

function truncateSig(sig: string): string {
  if (sig.length <= 14) return sig;
  return `${sig.slice(0, 8)}…${sig.slice(-4)}`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const deltaSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const m = Math.round(deltaSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export interface SurfpoolActivityPanelProps {
  actions: SurfpoolAction[];
}

// Show this many rows by default; the rest collapses behind a
// <details> toggle so a busy agent doesn't push every other section
// off the screen.
const VISIBLE_ROWS = 3;

export function SurfpoolActivityPanel({ actions }: SurfpoolActivityPanelProps) {
  const visibleRows = actions.slice(0, VISIBLE_ROWS);
  const overflowRows = actions.slice(VISIBLE_ROWS);

  return (
    <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--de-line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span className="pulse-dot amber" />
        <div className="bd-eyebrow">Recent activity</div>
      </div>
      <p
        className="muted"
        style={{ fontSize: 11, marginBottom: 12, lineHeight: 1.4 }}
      >
        Every action this agent has taken: staking, lending, opening
        positions. Updated in near-real-time.
      </p>

      {actions.length === 0 ? (
        <div
          className="card inset"
          style={{ padding: "16px", textAlign: "center" }}
        >
          <p style={{ fontSize: 12, margin: 0, color: "var(--de-ink-2)" }}>
            No activity yet.
          </p>
          <p className="mono-tiny" style={{ marginTop: 4, color: "var(--de-ink-3)" }}>
            Your agent will start trading shortly.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {visibleRows.map((a) => (
            <ActivityRow key={a.id} action={a} />
          ))}
          {overflowRows.length > 0 && (
            <details
              style={{
                marginTop: 4,
              }}
            >
              <summary
                className="mono"
                style={{
                  cursor: "pointer",
                  fontSize: 11,
                  color: "var(--de-ink-3)",
                  padding: "8px 0",
                  textAlign: "center",
                  listStyle: "none",
                  userSelect: "none",
                }}
              >
                Show {overflowRows.length} more
              </summary>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  paddingTop: 4,
                }}
              >
                {overflowRows.map((a) => (
                  <ActivityRow key={a.id} action={a} />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function ActivityRow({ action: a }: { action: SurfpoolAction }) {
  const logoSrc = PROTOCOL_LOGO[a.protocol];
  const amount = formatAmount(a);
  const placeholder = isPlaceholder(a);
  const meta = rowMeta(a);
  return (
              <div
                className="card inset"
                style={{
                  padding: "10px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                {logoSrc ? (
                  <img
                    src={logoSrc}
                    alt={a.protocol}
                    width={28}
                    height={28}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      flexShrink: 0,
                      objectFit: "cover",
                    }}
                  />
                ) : (
                  <span
                    style={{
                      fontSize: 18,
                      width: 28,
                      height: 28,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                    aria-hidden
                  >
                    {PROTOCOL_EMOJI_FALLBACK}
                  </span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      className="pill pill-gold"
                      style={{ fontSize: 9, padding: "2px 6px" }}
                    >
                      {a.protocol.toUpperCase()}
                    </span>
                    <span
                      className="mono"
                      style={{ fontSize: 12, color: "var(--de-ink)", fontWeight: 600 }}
                    >
                      {actionLabel(a.actionType)}
                    </span>
                    {amount && (
                      <span
                        className="mono"
                        style={{ fontSize: 12, color: "var(--de-lavender)" }}
                      >
                        {amount}
                      </span>
                    )}
                    {a.protocol === "marinade" && a.actionType === "lst_stake" && (
                      <span
                        className="mono"
                        style={{ fontSize: 11, color: "var(--de-ink-3)" }}
                      >
                        → mSOL
                      </span>
                    )}
                    {meta.market && (
                      <span
                        className="mono"
                        style={{ fontSize: 11, color: "var(--de-ink-2)", fontWeight: 600 }}
                      >
                        {meta.market}
                      </span>
                    )}
                    {meta.side && (
                      <span
                        className={meta.side === "long" ? "pill pill-green" : "pill pill-red"}
                        style={{ fontSize: 9, padding: "2px 6px" }}
                      >
                        {meta.side.toUpperCase()}
                      </span>
                    )}
                    {meta.notional && (
                      <span
                        className="mono"
                        style={{ fontSize: 11, color: "var(--de-ink-3)" }}
                      >
                        ${meta.notional} notional
                      </span>
                    )}
                    <span
                      className="pill"
                      style={{
                        fontSize: 8,
                        padding: "2px 6px",
                        background: placeholder ? "var(--bg-3)" : "var(--de-mint-tint)",
                        color: placeholder ? "var(--de-ink-3)" : "var(--de-mint)",
                        border: placeholder
                          ? "1px solid var(--de-line)"
                          : "1px solid rgba(44,139,121,0.32)",
                      }}
                      title={
                        placeholder
                          ? "Pending, agent recorded the intent but the on-chain action hasn't shipped yet"
                          : "Confirmed on-chain"
                      }
                    >
                      {placeholder ? "PENDING" : "LIVE"}
                    </span>
                  </div>
                  {meta.destination && (
                    <div
                      className="mono"
                      style={{
                        fontSize: 10,
                        marginTop: 3,
                        color: "var(--de-ink-3)",
                        lineHeight: 1.35,
                      }}
                      title={`Destination token account: ${meta.destination}`}
                    >
                      → {meta.destination}
                    </div>
                  )}
                  {a.notes && (
                    <div
                      style={{
                        fontSize: 10.5,
                        marginTop: 2,
                        lineHeight: 1.35,
                        color: "var(--de-ink-3)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={a.notes}
                    >
                      {a.notes}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div
                    className="mono"
                    style={{ fontSize: 10, color: "var(--de-ink-2)" }}
                    title={a.txSig}
                  >
                    {truncateSig(a.txSig)}
                  </div>
                  <div
                    className="mono-tiny"
                    style={{ marginTop: 2, fontSize: 9, color: "var(--de-ink-3)" }}
                  >
                    slot {a.slot.toLocaleString()} · {formatRelative(a.createdAt)}
                  </div>
                </div>
              </div>
  );
}
