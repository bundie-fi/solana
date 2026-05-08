/**
 * Horizontal stacked bar — current NAV broken out by the four
 * direct-integration components: base / kamino / solend / perps. Values
 * arrive as `*_micros` bigint strings; we convert to USD then divide by
 * the sum to get %s. Zero total → empty state.
 *
 * Distinct colors per protocol; legend below. Values shown as USD + %.
 */

interface Components {
  baseUsdMicros: string;
  kaminoUsdMicros: string;
  solendUsdMicros: string;
  perpsUsdMicros: string;
}

const PROTOCOLS: Array<{
  key: keyof Components;
  label: string;
  color: string;
}> = [
  { key: "baseUsdMicros", label: "Base", color: "#d4a853" },
  { key: "kaminoUsdMicros", label: "Kamino", color: "#5a8dee" },
  { key: "solendUsdMicros", label: "Solend", color: "#2c8b79" },
  { key: "perpsUsdMicros", label: "Perps", color: "#a78bfa" },
];

function microsToNumber(micros: string): number {
  try {
    return Number(BigInt(micros)) / 1_000_000;
  } catch {
    return 0;
  }
}

export function ProtocolExposureBar({
  components,
}: {
  components: Components;
}) {
  const slices = PROTOCOLS.map((p) => ({
    ...p,
    usd: microsToNumber(components[p.key]),
  }));
  const total = slices.reduce((s, x) => s + x.usd, 0);

  if (total <= 0) {
    return (
      <div
        className="muted"
        style={{
          fontSize: 12,
          padding: "12px 0",
          textAlign: "center",
        }}
      >
        No protocol exposure recorded for this snapshot.
      </div>
    );
  }

  return (
    <div>
      {/* Stacked bar */}
      <div
        style={{
          display: "flex",
          height: 22,
          borderRadius: 999,
          overflow: "hidden",
          border: "1px solid var(--de-line)",
          background: "var(--bg-3)",
        }}
      >
        {slices.map((s) => {
          const pct = (s.usd / total) * 100;
          if (pct <= 0) return null;
          return (
            <div
              key={s.key}
              style={{
                width: `${pct}%`,
                background: s.color,
                height: "100%",
              }}
              title={`${s.label}: ${pct.toFixed(1)}%`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0,1fr))",
          gap: "6px 12px",
          marginTop: 10,
        }}
        className="protocol-legend"
      >
        {slices.map((s) => {
          const pct = total > 0 ? (s.usd / total) * 100 : 0;
          return (
            <div
              key={s.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 9,
                  height: 9,
                  borderRadius: 2,
                  background: s.color,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  color: "var(--de-ink-2)",
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  fontSize: 10.5,
                }}
              >
                {s.label}
              </span>
              <span
                style={{ color: "var(--de-ink)", marginLeft: "auto" }}
              >
                {pct.toFixed(1)}%
              </span>
              <span className="dim" style={{ fontSize: 10 }}>
                ${s.usd.toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </span>
            </div>
          );
        })}
      </div>

      <style>{`
        @media (min-width: 640px) {
          .protocol-legend {
            grid-template-columns: repeat(4, minmax(0,1fr)) !important;
          }
        }
      `}</style>
    </div>
  );
}
