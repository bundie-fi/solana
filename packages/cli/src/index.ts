#!/usr/bin/env node
import { Command } from 'commander';
import { PublicKey } from '@solana/web3.js';
import { loadKeypair, getConnection } from './wallet.js';
import { createStrategy, DEVNET_USDC } from './commands/create-strategy.js';
import { buyStrategyShares } from './commands/buy-shares.js';
import { predict } from './commands/predict.js';
import { printNav } from './commands/nav.js';
import { createMarket } from './commands/create-market.js';
import { resolveMarket } from './commands/resolve-market.js';
import { listStrategies, formatStrategyTable } from './commands/list-strategies.js';

const program = new Command();

program
  .name('bundie-sol')
  .description('Bundie Solana CLI — agent surface for composing strategies, opening markets, and resolving outcomes on devnet')
  .version('0.1.0');

// ─── Global options ──────────────────────────────────────────────────────────

program
  .option('--keypair <path>', 'path to Solana keypair JSON (default: ~/.config/solana/id.json)')
  .option('--rpc <url>', 'Solana RPC endpoint (default: devnet)');

// ─── create-strategy ─────────────────────────────────────────────────────────

program
  .command('create-strategy')
  .description('Create a new investment strategy and optionally make an initial deposit')
  .requiredOption('--name <name>', 'strategy name (max 32 chars)')
  .option('--protocol <name|pubkey>', 'protocol name or address (kamino, marginfi, jupiter)', 'kamino')
  .option('--fee-bps <bps>', 'performance fee in basis points (e.g. 1000 = 10%)', '1000')
  .option('--deposit <usdc>', 'initial USDC deposit amount', '0')
  .option('--min-deposit <usdc>', 'minimum deposit for investors', '1')
  .option('--usdc-mint <pubkey>', 'USDC mint address', DEVNET_USDC.toBase58())
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent?.opts() ?? {};
    const conn   = getConnection(globalOpts.rpc);
    const payer  = loadKeypair(globalOpts.keypair);

    console.log(`\nCreating strategy "${opts.name}" on devnet...`);
    console.log(`  wallet: ${payer.publicKey.toBase58()}\n`);

    try {
      await createStrategy(conn, payer, {
        name:       opts.name,
        protocol:   opts.protocol,
        feeBps:     parseInt(opts.feeBps, 10),
        deposit:    parseFloat(opts.deposit),
        minDeposit: parseFloat(opts.minDeposit),
        usdcMint:   opts.usdcMint,
      });
      console.log('\n✓ Strategy created successfully.');
    } catch (e) {
      console.error('\n✗ Error:', (e as Error).message);
      process.exit(1);
    }
  });

// ─── buy-shares ──────────────────────────────────────────────────────────────

program
  .command('buy-shares')
  .description('Buy shares of an existing strategy (invest in it)')
  .requiredOption('--strategy <pubkey>', 'strategy account address')
  .requiredOption('--amount <usdc>', 'USDC amount to invest')
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent?.opts() ?? {};
    const conn    = getConnection(globalOpts.rpc);
    const payer   = loadKeypair(globalOpts.keypair);
    const strategy = new PublicKey(opts.strategy);
    const amount  = parseFloat(opts.amount);

    console.log(`\nBuying shares of strategy ${opts.strategy}...\n`);

    try {
      await buyStrategyShares(conn, payer, strategy, amount);
      console.log('\n✓ Shares purchased.');
    } catch (e) {
      console.error('\n✗ Error:', (e as Error).message);
      process.exit(1);
    }
  });

// ─── predict ─────────────────────────────────────────────────────────────────

program
  .command('predict')
  .description('Buy YES or NO shares on a prediction market')
  .requiredOption('--market <pubkey>', 'prediction market address')
  .requiredOption('--side <yes|no>', 'outcome to predict')
  .requiredOption('--amount <usdc>', 'USDC amount to stake')
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent?.opts() ?? {};
    const conn   = getConnection(globalOpts.rpc);
    const payer  = loadKeypair(globalOpts.keypair);
    const market = new PublicKey(opts.market);
    const side   = opts.side.toLowerCase() as 'yes' | 'no';
    const amount = parseFloat(opts.amount);

    if (side !== 'yes' && side !== 'no') {
      console.error('--side must be "yes" or "no"');
      process.exit(1);
    }

    console.log(`\nPredicting ${side.toUpperCase()} on market ${opts.market}...\n`);

    try {
      await predict(conn, payer, market, side, amount);
      console.log('\n✓ Prediction placed.');
    } catch (e) {
      console.error('\n✗ Error:', (e as Error).message);
      process.exit(1);
    }
  });

// ─── nav ─────────────────────────────────────────────────────────────────────

program
  .command('nav')
  .description('Read a strategy\'s NAV, share price, and estimated APY')
  .requiredOption('--strategy <pubkey>', 'strategy account address')
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent?.opts() ?? {};
    const conn     = getConnection(globalOpts.rpc);
    const strategy = new PublicKey(opts.strategy);

    try {
      await printNav(conn, strategy);
    } catch (e) {
      console.error('\n✗ Error:', (e as Error).message);
      process.exit(1);
    }
  });

// ─── create-market ───────────────────────────────────────────────────────────

program
  .command('create-market')
  .description('Open a prediction market on an existing strategy (market-maker archetype)')
  .requiredOption('--strategy <pubkey>', 'strategy the market predicts on')
  .requiredOption('--question <text>', 'market question (max 128 chars)')
  .requiredOption('--threshold-bps <bps>', 'APY threshold in basis points (e.g. 1000 = 10%)')
  .option('--resolution-days <days>', 'days until the market can be resolved', '7')
  .option('--initial-subsidy <usdc>', 'initial LS-LMSR liquidity subsidy in USDC', '10')
  .option('--fee-bps <bps>', 'market trading fee in basis points', '100')
  .option('--strategy-b <pubkey>', 'second strategy for Relative markets (optional)')
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent?.opts() ?? {};
    const conn = getConnection(globalOpts.rpc);
    const payer = loadKeypair(globalOpts.keypair);
    const strategy = new PublicKey(opts.strategy);
    const strategyB = opts.strategyB ? new PublicKey(opts.strategyB) : undefined;

    // Convert days → absolute slot (Solana ≈ 400ms/slot → 216,000 slots/day).
    // We read the current slot and add N * SLOTS_PER_DAY.
    const SLOTS_PER_DAY = 216_000n;
    const currentSlot = BigInt(await conn.getSlot('confirmed'));
    const resolutionSlot = currentSlot + BigInt(opts.resolutionDays) * SLOTS_PER_DAY;

    console.log(`\nOpening market on strategy ${opts.strategy}...\n`);

    try {
      await createMarket(conn, payer, {
        strategy,
        strategyB,
        question: opts.question,
        thresholdBps: parseInt(opts.thresholdBps, 10),
        resolutionSlot,
        initialSubsidy: parseFloat(opts.initialSubsidy),
        feeBps: parseInt(opts.feeBps, 10),
      });
      console.log('\n✓ Market opened.');
    } catch (e) {
      console.error('\n✗ Error:', (e as Error).message);
      process.exit(1);
    }
  });

// ─── resolve-market ──────────────────────────────────────────────────────────

program
  .command('resolve-market')
  .description('Permissionlessly resolve a market after its resolution slot (reads strategy NAV via on-chain oracle)')
  .requiredOption('--market <pubkey>', 'prediction market address')
  .action(async (opts, cmd) => {
    const globalOpts = cmd.parent?.opts() ?? {};
    const conn = getConnection(globalOpts.rpc);
    const payer = loadKeypair(globalOpts.keypair);
    const market = new PublicKey(opts.market);

    console.log(`\nResolving market ${opts.market}...\n`);

    try {
      const { outcome } = await resolveMarket(conn, payer, market);
      console.log(`\n✓ Market resolved → ${outcome}.`);
    } catch (e) {
      console.error('\n✗ Error:', (e as Error).message);
      process.exit(1);
    }
  });

// ─── list-strategies ─────────────────────────────────────────────────────────

program
  .command('list-strategies')
  .description('List all on-chain strategies (agents use this to discover markets to open)')
  .action(async (_opts, cmd) => {
    const globalOpts = cmd.parent?.opts() ?? {};
    const conn = getConnection(globalOpts.rpc);

    try {
      const strategies = await listStrategies(conn);
      console.log();
      console.log(formatStrategyTable(strategies));
      console.log();
      console.log(`(${strategies.length} strategies)`);
    } catch (e) {
      console.error('\n✗ Error:', (e as Error).message);
      process.exit(1);
    }
  });

// ─── Run ─────────────────────────────────────────────────────────────────────

program.parse();
