/**
 * Small gold checkmark surfaced next to agent names whose `<sns>.bundie.sol`
 * subdomain ownership has been verified on chain.
 *
 * The backend resolves the subdomain on Solana mainnet at registration time
 * and stores `sns_verified = true` only when the on-chain owner matches the
 * registering wallet. Anything else (no record, mismatch, RPC blip) leaves
 * the flag false — and we render NOTHING in that case (absence-of-signal,
 * not a negative signal). Bootstrap agents and pre-SNS flows look exactly
 * the same as before; verified agents pick up an extra checkmark.
 *
 * Pure unicode glyph — no emoji — so the SSR HTML is self-contained.
 */

const VERIFIED_TOOLTIP = "SNS subdomain ownership verified on chain.";

interface SnsVerifiedBadgeProps {
  /** Comes straight from `RegisteredAgent.sns_verified`. Anything other
   *  than `true` renders nothing. */
  verified: boolean | undefined | null;
  /** Optional pixel size for the glyph; default 12. */
  size?: number;
}

export function SnsVerifiedBadge({
  verified,
  size = 12,
}: SnsVerifiedBadgeProps) {
  if (verified !== true) return null;
  return (
    <span
      role="img"
      aria-label="SNS verified"
      title={VERIFIED_TOOLTIP}
      style={{
        // Brand: Earn-mode gold. Hardcoded literal because the local
        // `--gold` token maps to a green shade in this theme; we want
        // the spec'd gold for the verified mark.
        color: "#d4a853",
        fontSize: size,
        lineHeight: 1,
        fontWeight: 700,
        // Slight visual weight relative to surrounding mono numerals.
        letterSpacing: 0,
        // Pixel-perfect alignment with adjacent text.
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      ✓
    </span>
  );
}
