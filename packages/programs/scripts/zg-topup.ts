/**
 * zg-topup.ts — manual OG top-up for the bundie-agents brain.
 *
 * Usage:
 *   ZG_DEPOSIT_OG=5 ZG_TRANSFER_OG=3 \
 *     pnpm --filter @bundie/programs exec tsx scripts/zg-topup.ts
 *
 * - ZG_DEPOSIT_OG  (default 5): total to add to the ledger from the EOA.
 *                  Skipped if 0. Make sure the EOA has at least this much
 *                  free, or the depositFund tx will revert.
 * - ZG_TRANSFER_OG (default 3): amount to allocate from the ledger to our
 *                  inference provider. Has to be <= ledger balance after
 *                  the deposit.
 *
 * Safe to re-run: addLedger swallows the "already exists" revert; the
 * deposit + transfer are pure top-ups so they compound rather than reset.
 *
 * After running, the script prints the new EOA / ledger / provider
 * balances so you can confirm before walking away.
 */
import { JsonRpcProvider, Wallet, formatEther, parseEther } from "ethers";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";

const PK = process.env.ZG_WALLET_PRIVATE_KEY;
const RPC = process.env.ZG_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
const PROVIDER =
  process.env.ZG_COMPUTE_PROVIDER_ADDRESS ??
  "0xa48f01287233509FD694a22Bf840225062E67836";
const DEPOSIT_OG = Number(process.env.ZG_DEPOSIT_OG ?? "5");
const TRANSFER_OG = Number(process.env.ZG_TRANSFER_OG ?? "3");

if (!PK) {
  console.error("ZG_WALLET_PRIVATE_KEY is not set");
  process.exit(1);
}

(async () => {
  const provider = new JsonRpcProvider(RPC);
  const wallet = new Wallet(PK, provider);
  console.log("EOA:", wallet.address);
  console.log(
    "EOA balance before:",
    formatEther(await provider.getBalance(wallet.address)),
    "OG",
  );

  const broker = await createZGComputeNetworkBroker(wallet as never);

  // addLedger is the one-time per-wallet on-chain init. Subsequent calls
  // revert with "already exists"; we swallow that for idempotence.
  try {
    await broker.ledger.addLedger(0);
    console.log("Ledger initialised.");
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/already|exists|registered/i.test(msg)) throw err;
  }

  if (DEPOSIT_OG > 0) {
    console.log(`Depositing ${DEPOSIT_OG} OG into the ledger…`);
    await broker.ledger.depositFund(DEPOSIT_OG);
    console.log("  done.");
  }

  if (TRANSFER_OG > 0) {
    console.log(
      `Transferring ${TRANSFER_OG} OG to provider ${PROVIDER.slice(0, 12)}…`,
    );
    await broker.ledger.transferFund(
      PROVIDER,
      "inference",
      parseEther(TRANSFER_OG.toString()),
    );
    console.log("  done.");
  }

  // Read-back so the operator sees the new state without a second script run.
  console.log("\n--- after top-up ---");
  console.log(
    "EOA balance:",
    formatEther(await provider.getBalance(wallet.address)),
    "OG",
  );
  try {
    const ledger = await broker.ledger.getLedger();
    console.log(
      "Ledger total:",
      formatEther(ledger.totalBalance ?? 0n),
      "OG",
    );
  } catch {}
  try {
    const acc = await broker.inference.getAccount(PROVIDER);
    console.log(
      "Provider balance:",
      formatEther(acc.balance ?? 0n),
      "OG",
    );
  } catch {}
})();
