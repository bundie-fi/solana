/**
 * Web-side helpers for displaying the dynamic read price across the
 * home, /api, and /markets surfaces. Keeps the rendered string stable
 * between the backend response, the MCP server card, and the UI.
 */

/** Render USDC base units as a short dollar string. $0.0001..$0.01 range. */
export function formatPriceUsd(microUnits: number | null | undefined): string {
  if (microUnits == null || !Number.isFinite(microUnits)) return "—";
  const dollars = microUnits / 1_000_000;
  return `$${dollars.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
}

/** Floor + ceiling for "from X — up to Y" copy without a backend call. */
export const READ_PRICE_FLOOR_USDC_MICRO = 100; // $0.0001
export const READ_PRICE_CEILING_USDC_MICRO = 10_000; // $0.01
