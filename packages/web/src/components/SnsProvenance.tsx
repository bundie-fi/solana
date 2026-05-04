"use client";

/**
 * SnsProvenance , small visual indicator that an identity is backed by the
 * real on-chain SPL Name Service program (not a Bundie-internal namespace).
 *
 * Two surfaces:
 *   - <SnsProvenance variant="footer" />  , full footer for the /identity page
 *   - <SnsProvenance variant="stat"   />  , one-line stat for the connected-
 *                                          wallet strip
 *
 * Hard-codes the program ID + the public devnet root values from
 * lib/sns-register so any future override there is reflected here too.
 *
 * Why surface this at all
 * ───────────────────────
 * Without it, users see ".bundie" suffixes and could assume Bundie maintains
 * an off-chain ledger. Making the SPL Name Service program ID visible (with
 * a one-click explorer link) lets a curious user trace the resolution path
 * end-to-end on devnet , confirming the identity layer is real SNS infra.
 */
import {
  BUNDIE_ROOT_OWNER,
  BUNDIE_ROOT_PDA,
  SPL_NAME_SERVICE_PROGRAM_ID,
} from "@/lib/sns-register";

type Variant = "footer" | "stat";

export function SnsProvenance({ variant }: { variant: Variant }): JSX.Element {
  const programId = SPL_NAME_SERVICE_PROGRAM_ID.toBase58();
  const root = BUNDIE_ROOT_PDA.toBase58();
  const owner = BUNDIE_ROOT_OWNER.toBase58();

  if (variant === "stat") {
    return (
      <p className="mt-2 font-mono text-[10px] text-neutral-600">
        Identity layer:{" "}
        <span className="text-neutral-700">SPL Name Service</span>
        {" · "}
        <a
          href={`https://orbmarkets.io/address/${root}?cluster=devnet`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-amber-400 hover:underline"
          title={`.bundie root PDA on devnet\nProgram: ${programId}\nOwner:   ${owner}`}
        >
          devnet root: {root.slice(0, 6)}…{root.slice(-4)}
        </a>
      </p>
    );
  }

  return (
    <footer className="mt-12 border-t border-neutral-300 pt-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-600">
        Powered by SPL Name Service
      </p>
      <p className="mt-1 text-xs text-neutral-700">
        Every <code className="font-mono">.bundie</code> name is a real{" "}
        <code className="font-mono">NameRegistry</code> account under the
        SPL Name Service program — same primitives that back Bonfida{" "}
        <code className="font-mono">.sol</code>, just under a root we
        own on devnet.
      </p>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 font-mono text-[10px] sm:grid-cols-[max-content_1fr]">
        <dt className="text-neutral-600">Program</dt>
        <dd>
          <a
            href={`https://orbmarkets.io/address/${programId}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-400 hover:underline"
          >
            {programId}
          </a>
        </dd>
        <dt className="text-neutral-600">Bundie root PDA</dt>
        <dd>
          <a
            href={`https://orbmarkets.io/address/${root}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-400 hover:underline"
          >
            {root}
          </a>
        </dd>
        <dt className="text-neutral-600">Root owner</dt>
        <dd>
          <a
            href={`https://orbmarkets.io/address/${owner}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-400 hover:underline"
          >
            {owner}
          </a>
        </dd>
      </dl>
    </footer>
  );
}

export default SnsProvenance;
