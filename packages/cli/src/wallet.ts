import { Keypair, Connection, clusterApiUrl } from '@solana/web3.js';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';

export function loadKeypair(path?: string): Keypair {
  const keypairPath =
    path ??
    process.env.ANCHOR_WALLET ??
    resolve(homedir(), '.config', 'solana', 'id.json');
  const raw = JSON.parse(readFileSync(keypairPath, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export function getConnection(rpc?: string): Connection {
  const url = rpc ?? process.env.SOLANA_RPC_URL ?? clusterApiUrl('devnet');
  return new Connection(url, 'confirmed');
}
