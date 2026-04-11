import { PublicKey } from '@solana/web3.js';
import { createHash } from 'crypto';

/** Compute the 8-byte Anchor instruction discriminator for Anchor 1.0 (snake_case names) */
export function anchorDisc(ixName: string): Buffer {
  return createHash('sha256').update(`global:${ixName}`).digest().subarray(0, 8);
}

// Pre-computed discriminators for prediction-market instructions
export const DISC = {
  createMarket: anchorDisc('create_market'),
  buyShares:    anchorDisc('buy_shares'),
  sellShares:   anchorDisc('sell_shares'),
  resolve:      anchorDisc('resolve'),
  redeem:       anchorDisc('redeem'),
} as const;

/** Sequential Borsh reader for deserializing on-chain account data */
export class BorshReader {
  private offset: number;
  constructor(private buf: Buffer, startOffset = 0) {
    this.offset = startOffset;
  }

  u8(): number { return this.buf.readUInt8(this.offset++); }
  u16(): number { const v = this.buf.readUInt16LE(this.offset); this.offset += 2; return v; }
  u32(): number { const v = this.buf.readUInt32LE(this.offset); this.offset += 4; return v; }
  u64(): bigint { const v = this.buf.readBigUInt64LE(this.offset); this.offset += 8; return v; }
  i64(): bigint { const v = this.buf.readBigInt64LE(this.offset); this.offset += 8; return v; }
  u128(): bigint {
    const lo = this.buf.readBigUInt64LE(this.offset);
    const hi = this.buf.readBigUInt64LE(this.offset + 8);
    this.offset += 16;
    return lo | (hi << 64n);
  }
  pubkey(): PublicKey {
    const bytes = this.buf.subarray(this.offset, this.offset + 32);
    this.offset += 32;
    return new PublicKey(bytes);
  }
  string(): string {
    const len = this.u32();
    const s = this.buf.subarray(this.offset, this.offset + len).toString('utf8');
    this.offset += len;
    return s;
  }
  option<T>(reader: () => T): T | null {
    return this.u8() ? reader.call(this) : null;
  }
  bytes(len: number): Buffer {
    const b = Buffer.from(this.buf.subarray(this.offset, this.offset + len));
    this.offset += len;
    return b;
  }
}
