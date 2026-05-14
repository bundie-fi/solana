/**
 * v1 resolver runner — long-lived daemon that polls each registered
 * resolver on its configured interval and submits `resolve_event` for
 * markets whose trigger condition has been met.
 *
 * Wiring:
 *   - Reads `scripts/resolvers/sources.json` via the registry loader.
 *   - For each demo-eligible event, instantiates the resolver class.
 *   - On every tick (default 60s), polls every resolver in parallel.
 *   - On YES/NO signal, builds + submits a `resolve_event` ix signed by
 *     the BUNDIE_RESOLVER_KEY env keypair (must match the pubkey passed
 *     to `create_event` at market-creation time).
 *
 * Started via `pnpm tsx packages/backend/src/v1/runner.ts`. Not mounted
 * inside the main Hono process so a crashed runner doesn't take the API
 * down (and vice-versa). Logs to stdout; no persistent state.
 */

import "dotenv/config";
import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import idlJson from "../idl/prediction_market.json" with { type: "json" };
import { loadRegistry, listDemoEvents } from "./registry.js";
import { findMarketForEvent } from "./onchain.js";
import { PythThresholdDurationResolver } from "./resolvers/pyth-threshold-duration.js";
import { StatuspageIncidentResolver } from "./resolvers/statuspage-incident.js";
import { AwsHealthIncidentResolver } from "./resolvers/aws-health-incident.js";
import type { Resolver } from "./types.js";

/**
 * sha256(JSON.stringify(config)) — same algorithm as the deploy script's
 * `configHash` helper. Used to verify that the resolver_config loaded
 * from sources.json on this process matches what was pinned on-chain
 * at market-creation time. A mismatch means someone edited sources.json
 * after deploy — REFUSE to sign.
 */
function configHash(config: unknown): Buffer {
  return createHash("sha256").update(JSON.stringify(config)).digest();
}

async function verifyOnchainConfigHash(
  program: Program,
  marketPda: PublicKey,
  loadedConfig: unknown,
): Promise<boolean> {
  const [resolverAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("resolver_auth"), marketPda.toBuffer()],
    program.programId,
  );
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const account = (await (program.account as any).resolverAuthority.fetch(
      resolverAuthorityPda,
    )) as { configHash: number[] };
    const onchain = Buffer.from(account.configHash);
    const local = configHash(loadedConfig);
    return onchain.equals(local);
  } catch (err) {
    console.warn(
      `[runner] config_hash verify failed (treating as mismatch): ${(err as Error).message}`,
    );
    return false;
  }
}

const TICK_INTERVAL_MS = Number(process.env.BUNDIE_RUNNER_TICK_MS ?? "60000");
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";

function loadResolverKeypair(): Keypair {
  const path = process.env.BUNDIE_RESOLVER_KEY;
  if (!path) {
    throw new Error(
      "BUNDIE_RESOLVER_KEY env var (path to JSON keypair file) is required",
    );
  }
  const secret = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(secret));
}

/** Build the Anchor program with a signing wallet (resolver keypair). */
function buildProgram(resolverKp: Keypair): Program {
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new Wallet(resolverKp);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Program(idlJson as any as Idl, provider);
}

/**
 * Map resolver_class string from sources.json to a constructed resolver
 * instance. v1 ships one implementation (Pyth threshold). The others
 * land in subsequent commits; for now they log a warning and are skipped.
 */
function buildResolvers(
  connection: Connection,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Map<string, Resolver<any>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map = new Map<string, Resolver<any>>();
  map.set(
    "pyth_threshold_duration",
    new PythThresholdDurationResolver(connection),
  );
  map.set(
    "statuspage_v2_incident_duration",
    new StatuspageIncidentResolver(),
  );
  map.set("aws_health_dashboard_incident", new AwsHealthIncidentResolver());
  // TODO: onchain_tvl_rolling_window resolver requires per-protocol TVL
  // readers (Kamino, MarginFi, Save). Each protocol publishes its TVL
  // through a different account layout. Lands as protocol-specific
  // readers ship alongside their NAV oracles.
  return map;
}

async function submitResolveEvent(
  program: Program,
  resolverKp: Keypair,
  marketAddress: PublicKey,
  outcome: "yes" | "no",
): Promise<string> {
  const [resolverAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("resolver_auth"), marketAddress.toBuffer()],
    program.programId,
  );
  const outcomeObj = outcome === "yes" ? { yes: {} } : { no: {} };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sig = await (program.methods as any)
    .resolveEvent(outcomeObj)
    .accounts({
      resolver: resolverKp.publicKey,
      market: marketAddress,
      resolverAuthority: resolverAuthorityPda,
    })
    .rpc();
  return sig;
}

async function tick(
  program: Program,
  resolverKp: Keypair,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolvers: Map<string, Resolver<any>>,
): Promise<void> {
  loadRegistry(); // warm cache
  const events = listDemoEvents();
  const now = new Date();

  await Promise.all(
    events.map(async (event) => {
      const resolver = resolvers.get(event.resolver_class);
      if (!resolver) {
        console.warn(
          `[runner] no resolver for class '${event.resolver_class}' — skipping ${event.event_id}`,
        );
        return;
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await resolver.poll(event.event_id, event.resolver_config as any, now);
        if (!result) return; // trigger not met yet — wait for next tick

        const marketPda = await findMarketForEvent(event.event_id);
        if (!marketPda) {
          console.warn(
            `[runner] ${event.event_id} resolved to '${result}' but no on-chain market — skip`,
          );
          return;
        }

        // Safety check: refuse to sign if the loaded resolver_config
        // doesn't match what was pinned on-chain at market-creation
        // time. Drift = potentially-wrong resolution = potentially-lost
        // user money. Better to skip and alert than to settle bad data.
        const hashOk = await verifyOnchainConfigHash(
          program,
          marketPda,
          event.resolver_config,
        );
        if (!hashOk) {
          console.error(
            `[runner] REFUSING to resolve ${event.event_id}: on-chain config_hash != local. Redeploy needed or sources.json drifted.`,
          );
          return;
        }

        console.log(
          `[runner] resolving ${event.event_id} (${marketPda.toBase58()}) → ${result.toUpperCase()}`,
        );
        const sig = await submitResolveEvent(program, resolverKp, marketPda, result);
        console.log(`[runner] resolved: ${sig}`);
      } catch (err) {
        console.error(
          `[runner] ${event.event_id} failed: ${(err as Error).message}`,
        );
      }
    }),
  );
}

async function main() {
  const resolverKp = loadResolverKeypair();
  const program = buildProgram(resolverKp);
  const connection = new Connection(RPC_URL, "confirmed");
  const resolvers = buildResolvers(connection);

  console.log(`[runner] starting`);
  console.log(`[runner] resolver pubkey: ${resolverKp.publicKey.toBase58()}`);
  console.log(`[runner] rpc: ${RPC_URL}`);
  console.log(`[runner] tick interval: ${TICK_INTERVAL_MS}ms`);
  console.log("");

  // Initial tick immediately, then schedule recurring.
  await tick(program, resolverKp, resolvers);
  setInterval(() => {
    tick(program, resolverKp, resolvers).catch((err) => {
      console.error(`[runner] tick failed: ${(err as Error).message}`);
    });
  }, TICK_INTERVAL_MS);
}

main().catch((err) => {
  console.error("[runner] fatal:", err);
  process.exit(1);
});
