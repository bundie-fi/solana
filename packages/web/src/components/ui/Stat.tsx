import { ReactNode } from "react";

/**
 * Small stat tile. Label + value (+ optional trailing delta).
 *
 * Example:
 *   <Stat label="APY" value="12.4%" tone="gold" delta="+1.2%" />
 */
export function Stat({
  label,
  value,
  delta,
  tone = "default",
  align = "center",
  className = "",
}: {
  label: string;
  value: ReactNode;
  delta?: string;
  tone?: "default" | "gold" | "purple" | "success" | "danger";
  align?: "left" | "center" | "right";
  className?: string;
}) {
  const toneMap = {
    default: "text-neutral-800",
    gold:    "text-earn-gold",
    purple:  "text-predict-purple",
    success: "text-success-400",
    danger:  "text-danger-400",
  } as const;

  const deltaTone =
    delta?.startsWith("-") || delta?.startsWith("−")
      ? "text-danger-400"
      : "text-success-400";

  const alignMap = {
    left:   "items-start text-left",
    center: "items-center text-center",
    right:  "items-end text-right",
  } as const;

  return (
    <div className={`flex flex-col gap-1 ${alignMap[align]} ${className}`}>
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-600">
        {label}
      </span>
      <span className={`font-mono nums text-lg font-bold ${toneMap[tone]}`}>
        {value}
      </span>
      {delta && (
        <span className={`font-mono nums text-xs ${deltaTone}`}>{delta}</span>
      )}
    </div>
  );
}
