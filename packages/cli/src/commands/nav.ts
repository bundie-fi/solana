/**
 * nav — read a strategy's current NAV, share price, and estimated APY.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { fetchStrategy } from '../accounts.js';

const USDC_DECIMALS = 1_000_000n;
const SHARE_DECIMALS = 1_000_000_000n; // 9 decimals for strategy shares
const SECONDS_PER_YEAR = 31_536_000n;

export async function printNav(conn: Connection, strategyAddress: PublicKey): Promise<void> {
  const s = await fetchStrategy(conn, strategyAddress);

  const navUsdc  = Number(s.currentNav)  / Number(USDC_DECIMALS);
  const tvlUsdc  = Number(s.totalDeposits) / Number(USDC_DECIMALS);
  const shares   = Number(s.totalShares) / Number(SHARE_DECIMALS);

  // Share price: NAV / total_shares (normalized to USDC per share)
  const sharePrice = s.totalShares > 0n
    ? navUsdc / shares
    : 1.0;

  // Annualized APY from NAV growth vs high water mark
  // hwm is stored as NAV-per-share * 1e9
  const hwmUsdc = Number(s.highWaterMark) / Number(SHARE_DECIMALS);
  let apy = 0;
  if (hwmUsdc > 0 && s.createdAt > 0n) {
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const elapsedSec = nowSec - s.createdAt;
    if (elapsedSec > 0n) {
      const growth = (sharePrice - hwmUsdc) / hwmUsdc;
      apy = growth * Number(SECONDS_PER_YEAR) / Number(elapsedSec) * 100;
    }
  }

  const statusLabel = ['active', 'paused', 'closed'][s.status] ?? 'unknown';
  const typeLabel   = s.strategyType === 0 ? 'yield' : 'agent';

  console.log('');
  console.log(`  Strategy:     ${s.name}`);
  console.log(`  Address:      ${strategyAddress.toBase58()}`);
  console.log(`  Type:         ${typeLabel}  |  Status: ${statusLabel}`);
  console.log(`  Fee:          ${s.feeBps / 100}%`);
  console.log(`  TVL:          $${tvlUsdc.toFixed(2)} USDC`);
  console.log(`  NAV:          $${navUsdc.toFixed(2)} USDC`);
  console.log(`  Total shares: ${shares.toFixed(6)}`);
  console.log(`  Share price:  $${sharePrice.toFixed(6)} USDC`);
  console.log(`  APY (est):    ${apy >= 0 ? '+' : ''}${apy.toFixed(2)}%`);
  console.log(`  Investors:    ${s.totalInvestors}`);
  console.log('');
}
