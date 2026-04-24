/**
 * Zerion routing indicator — Z-shaped SVG + "Zerion-routed" label.
 */
export function ZerionBadge() {
  return (
    <span className="row gap-1 mono-tiny dim" style={{ fontSize: 9 }}>
      <svg width="8" height="9" viewBox="0 0 8 9" fill="none">
        <path d="M0 0h8L4 4l4 5H0l4-5z" fill="currentColor" opacity=".7" />
      </svg>
      Zerion-routed
    </span>
  );
}
