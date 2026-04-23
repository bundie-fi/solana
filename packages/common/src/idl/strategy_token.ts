/**
 * Strategy Token Program IDL — TypeScript re-export.
 *
 * NOTE: this program is built with pinocchio (no Anchor framework). The
 * "discriminators" in this IDL are an Anchor-compatibility wrapper around the
 * single-byte dispatch table in `programs/strategy-token/src/lib.rs`:
 *
 *   discriminator[0] = the actual on-wire dispatch byte (0..7)
 *   discriminator[1..8] = padding zeros
 *
 * Clients that build raw transactions MUST send only discriminator[0] (one
 * byte), followed by the args bytes — DO NOT prepend the full 8-byte array.
 *
 * Account discriminators (the entries under `accounts[]`) ARE 8 real bytes,
 * stored at offset 0 of each account by the program at init time.
 *
 * Source layout: see byte offsets in
 *   programs/strategy-token/src/state/{strategy,nav_oracle,position_snapshots}.rs
 *
 * The original IDL JSON lives at `./strategy_token.json` and is the source of
 * truth uploaded on-chain via `anchor idl init`.
 */
export type StrategyToken = {
  address: 'Bun4tBew11dWjx1mRuMmJZFmxsGsxYSYhdfe1w7JaHVm';
  metadata: {
    name: 'strategy_token';
    version: '0.1.0';
    spec: '0.1.0';
    description: string;
    docs: string[];
  };
  instructions: ReadonlyArray<{
    name: string;
    docs?: string[];
    discriminator: number[];
    accounts: ReadonlyArray<{
      name: string;
      docs?: string[];
      writable?: boolean;
      signer?: boolean;
      address?: string;
      pda?: {
        seeds: ReadonlyArray<
          | { kind: 'const'; value: number[] }
          | { kind: 'account'; path: string }
          | { kind: 'arg'; path: string }
        >;
      };
    }>;
    args: ReadonlyArray<{
      name: string;
      docs?: string[];
      type:
        | string
        | { defined: { name: string } }
        | { array: [string, number] }
        | { option: string }
        | { vec: string };
    }>;
  }>;
  accounts: ReadonlyArray<{ name: string; discriminator: number[] }>;
  types: ReadonlyArray<{ name: string; docs?: string[]; type: unknown }>;
  errors: ReadonlyArray<{ code: number; name: string; msg: string }>;
  constants: ReadonlyArray<{ name: string; type: string; value: string }>;
};
