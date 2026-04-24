"use client";

interface ProbBarProps {
  /** YES probability as a 0–100 number */
  yes: number;
  style?: "split" | "centered" | "tick";
  height?: number;
  animate?: boolean;
}

/**
 * Animated YES/NO probability bar.
 * Three render modes: split (default), centered (deviation from 50/50), tick (candlestick).
 */
export function ProbBar({ yes, style = "split", height, animate = true }: ProbBarProps) {
  const no = 100 - yes;

  if (style === "tick") {
    return (
      <div className="probbar tick" style={{ height: height ?? 18 }}>
        <div
          style={{
            width: `${yes}%`,
            height: 3,
            background: "linear-gradient(90deg, rgba(34,197,94,.3), var(--green))",
            borderRadius: 999,
            transition: animate ? "width 320ms cubic-bezier(.25,.4,.25,1)" : undefined,
          }}
        />
        <div style={{ width: 8 }} />
        <div
          style={{
            width: `${no}%`,
            height: 3,
            background: "linear-gradient(90deg, var(--red), rgba(239,68,68,.3))",
            borderRadius: 999,
            transition: animate ? "width 320ms cubic-bezier(.25,.4,.25,1)" : undefined,
          }}
        />
      </div>
    );
  }

  if (style === "centered") {
    const yesOff = Math.max(0, yes - 50);
    const noOff = Math.max(0, 50 - yes);
    return (
      <div className="probbar centered" style={{ height: height ?? 8, position: "relative" }}>
        {yes > 50 && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: 0,
              bottom: 0,
              width: `${yesOff * 2}%`,
              background: "linear-gradient(90deg, rgba(34,197,94,.7), var(--green))",
              transition: "width 320ms cubic-bezier(.25,.4,.25,1)",
            }}
          />
        )}
        {yes < 50 && (
          <div
            style={{
              position: "absolute",
              right: "50%",
              top: 0,
              bottom: 0,
              width: `${noOff * 2}%`,
              background: "linear-gradient(270deg, rgba(239,68,68,.7), var(--red))",
              transition: "width 320ms cubic-bezier(.25,.4,.25,1)",
            }}
          />
        )}
      </div>
    );
  }

  // split (default)
  return (
    <div className="probbar" style={{ height: height ?? 8 }}>
      <div className="yes" style={{ width: `${yes}%` }} />
      <div className="hairline" />
      <div className="no" style={{ width: `${no}%` }} />
    </div>
  );
}
