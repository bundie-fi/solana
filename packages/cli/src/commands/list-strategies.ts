/**
 * list-strategies — list every Strategy account on-chain.
 *
 * Filters by the strategy-token discriminator to avoid catching NavOracle
 * or other pinocchio-owned accounts. Decodes each via fetchStrategy.
 *
 * Useful for agents that want to discover strategies to open markets on
 * (market-maker archetype) or that want a directory view.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { PROGRAM_IDS } from '../constants.js';
import { fetchStrategy, StrategyAccount } from '../accounts.js';

/** Strategy account discriminator — must match strategy-token/src/state/strategy.rs */
const STRATEGY_DISCRIMINATOR = Buffer.from([
  0xd0, 0x82, 0x35, 0xce, 0x9a, 0x7f, 0x5b, 0x11,
]);

export async function listStrategies(conn: Connection): Promise<StrategyAccount[]> {
  const accounts = await conn.getProgramAccounts(PROGRAM_IDS.strategyToken, {
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: bs58.encode(STRATEGY_DISCRIMINATOR),
        },
      },
    ],
  });

  const strategies: StrategyAccount[] = [];
  for (const { pubkey } of accounts) {
    try {
      strategies.push(await fetchStrategy(conn, pubkey));
    } catch (e) {
      // skip accounts that fail to decode (e.g., partially-initialized)
      console.error(`  [skip ${pubkey.toBase58()}]: ${(e as Error).message}`);
    }
  }

  return strategies;
}

export function formatStrategyTable(strategies: StrategyAccount[]): string {
  if (strategies.length === 0) return '(no strategies found)';

  const header =
    'address                                       | name                       | nav (USDC) | shares    | investors | fee';
  const sep = '─'.repeat(header.length);
  const rows = strategies.map(s => {
    const navUsdc = (Number(s.currentNav) / 1_000_000).toFixed(6);
    const shares = (Number(s.totalShares) / 1_000_000).toFixed(2);
    return `${s.address.toBase58().padEnd(45)} | ${s.name.padEnd(26)} | ${navUsdc.padStart(10)} | ${shares.padStart(9)} | ${String(s.totalInvestors).padStart(9)} | ${s.feeBps} bps`;
  });

  return [header, sep, ...rows].join('\n');
}
