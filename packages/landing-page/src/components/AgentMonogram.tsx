/**
 * Editorial replacement for emoji avatars on agent cards / activity rows.
 *
 * Derives a 1–2 letter monogram from the agent handle and renders it on
 * a hairline-bordered tile in the serif typeface. Looks intentional,
 * deterministic, and on-brand — none of the "AI random emoji" feel.
 *
 * Letter rules:
 *   - strip `.bundie.sol` (or any `.sol`-style suffix)
 *   - if hyphenated (e.g. `apy-rotator`) → first letter of each of the
 *     first two segments → "AR"
 *   - else → first letter only → "B" for `barbell`
 *
 * Color is deterministic from a hash of the handle so the same agent
 * always picks the same tint, but two adjacent agents don't visually
 * collide.
 */

const TINTS: Array<{ bg: string; ink: string; ring: string }> = [
  // Teal (brand primary)
  { bg: "rgba(18, 68, 58, 0.08)", ink: "var(--amber-3)", ring: "rgba(18, 68, 58, 0.18)" },
  // Warm slate
  { bg: "rgba(58, 50, 40, 0.06)", ink: "var(--ink-2)", ring: "rgba(58, 50, 40, 0.14)" },
  // Amber
  { bg: "rgba(177, 122, 60, 0.08)", ink: "var(--amber-2)", ring: "rgba(177, 122, 60, 0.20)" },
  // Cool slate
  { bg: "rgba(40, 50, 58, 0.06)", ink: "var(--ink-2)", ring: "rgba(40, 50, 58, 0.14)" },
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function monogramFor(handle: string): string {
  // Strip a trailing `.<word>.<word>` (SNS-style) — keep the leading
  // user-chosen part. `alex.bundie.sol` → `alex`, `apy-rotator` stays.
  const stem = handle.replace(/\..*$/, "").trim();
  if (!stem) return "·";
  if (stem.includes("-")) {
    const parts = stem.split("-").filter(Boolean);
    const a = parts[0]?.[0] ?? "";
    const b = parts[1]?.[0] ?? "";
    return (a + b).toUpperCase();
  }
  return stem[0].toUpperCase();
}

interface AgentMonogramProps {
  handle: string;
  size?: number;
  className?: string;
}

export function AgentMonogram({
  handle,
  size = 32,
  className,
}: AgentMonogramProps) {
  const letters = monogramFor(handle);
  const tint = TINTS[hash(handle) % TINTS.length];
  // Letter sizing scales with the tile, with a small downshift for
  // 2-letter monograms so they don't crash into the borders.
  const fontSize = letters.length > 1 ? Math.round(size * 0.42) : Math.round(size * 0.5);

  return (
    <span
      className={className}
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 6,
        background: tint.bg,
        boxShadow: `inset 0 0 0 1px ${tint.ring}`,
        color: tint.ink,
        fontFamily: "var(--font-serif), 'Instrument Serif', Georgia, serif",
        fontSize,
        lineHeight: 1,
        letterSpacing: letters.length > 1 ? "-0.02em" : "0",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {letters}
    </span>
  );
}
