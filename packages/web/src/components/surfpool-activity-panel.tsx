/**
 * SurfpoolActivityPanel — renders an agent's recent surfpool tx feed.
 *
 * Surfpool is a local Solana mainnet fork where chaos-sim agents execute
 * against real protocol IDs (Kamino / Marinade / Jito / Drift / Orca /
 * MarginFi). Their txs are real but invisible because surfpool has no
 * public explorer — this panel surfaces them so visitors can watch agent
 * strategy execution land in near-real-time.
 *
 * Server component (no client interactivity required) — keeps the agent
 * profile page SSR.
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

const PROTOCOL_EMOJI: Record<string, string> = {
  kamino:   "📈",
  marginfi: "🏦",
  marinade: "⚡",
  jito:     "🔥",
  drift:    "🎯",
  orca:     "🌊",
  solend:   "🟣",
};

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
  // Two decimals for USDC, four for SOL — keeps the row tight.
  const fixed = isSolFamily ? ui.toFixed(4) : ui.toFixed(2);
  return `${fixed} ${unit}`;
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

export function SurfpoolActivityPanel({ actions }: SurfpoolActivityPanelProps) {
  return (
    <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line-1)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span className="pulse-dot amber" />
        <div className="bd-eyebrow">Live strategy execution on Solana mainnet fork (Surfpool)</div>
      </div>
      <p
        className="muted"
        style={{ fontSize: 11, marginBottom: 12, lineHeight: 1.4 }}
      >
        Real txs against mainnet protocols, replicated on Surfpool — txSigs
        valid on the local fork only.
      </p>

      {actions.length === 0 ? (
        <div
          className="card inset"
          style={{ padding: "16px", textAlign: "center" }}
        >
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Agent has no surfpool activity yet.
          </p>
          <p className="muted mono-tiny" style={{ marginTop: 4 }}>
            (Lend deposits land here; LST stakes appear under the Strategy
            positions panel above.)
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {actions.map((a) => {
            const emoji = PROTOCOL_EMOJI[a.protocol] ?? "🔗";
            const amount = formatAmount(a);
            return (
              <div
                key={a.id}
                className="card inset"
                style={{
                  padding: "10px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
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
                  {emoji}
                </span>
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
                      style={{ fontSize: 12, color: "var(--fg-0)", fontWeight: 600 }}
                    >
                      {a.actionType}
                    </span>
                    {amount && (
                      <span
                        className="mono"
                        style={{ fontSize: 12, color: "var(--gold)" }}
                      >
                        {amount}
                      </span>
                    )}
                  </div>
                  {a.notes && (
                    <div
                      className="muted"
                      style={{
                        fontSize: 10.5,
                        marginTop: 2,
                        lineHeight: 1.35,
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
                    style={{ fontSize: 10, color: "var(--fg-2)" }}
                    title={a.txSig}
                  >
                    {truncateSig(a.txSig)}
                  </div>
                  <div
                    className="muted mono-tiny"
                    style={{ marginTop: 2, fontSize: 9 }}
                  >
                    slot {a.slot.toLocaleString()} · {formatRelative(a.createdAt)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
