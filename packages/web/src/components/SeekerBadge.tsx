"use client";

import { useEffect, useState } from "react";
import { isSeekerTwa } from "@/lib/seeker";

/**
 * Small gold pill rendered near the top of the home feed when the page is
 * being viewed inside the Seeker TWA shell. Effect-only check avoids an
 * SSR/CSR markup mismatch (navigator is not defined server-side).
 */
export function SeekerBadge() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(isSeekerTwa());
  }, []);
  if (!show) return null;
  return (
    <span
      className="pill pill-gold mono"
      style={{
        fontSize: 9,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
      }}
      title="Running as a Trusted Web Activity on a Solana Seeker device"
    >
      Seeker · TWA
    </span>
  );
}
