/**
 * Lightweight (spoofable) check for whether the current browser is
 * running on a Solana Seeker device. For UI flair only — never gate
 * value on this. For verified Seeker ownership use the Seeker Genesis
 * Token (SGT) check via wallet authorize + getTokenAccountsByOwnerV2.
 *
 * Detection: Seeker's WebView reports "Seeker" in the User-Agent
 * string. TWA-wrapped apps inherit that UA.
 */
export function isSeekerDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /\bSeeker\b/i.test(navigator.userAgent);
}

/** True when the page is rendered inside a TWA (display-mode: standalone)
 *  AND the device is a Seeker. Useful for "Welcome to Bundie on Seeker"
 *  banners. */
export function isSeekerTwa(): boolean {
  if (typeof window === "undefined") return false;
  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches === true;
  return standalone && isSeekerDevice();
}
