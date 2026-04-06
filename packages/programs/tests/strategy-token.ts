import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { expect } from "chai";

describe("strategy-token", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // TODO: Load program from workspace once IDL is generated
  // const program = anchor.workspace.StrategyToken as Program;

  it("creates a strategy", async () => {
    // TODO: Test create_strategy instruction
    // 1. Generate keypairs for mint
    // 2. Call create_strategy with name and fee_bps
    // 3. Verify strategy account data
    // 4. Verify mint was created
    // 5. Verify nav_oracle was initialized
  });

  it("buys shares", async () => {
    // TODO: Test buy_shares instruction
  });

  it("redeems shares", async () => {
    // TODO: Test redeem_shares instruction
  });

  it("updates NAV", async () => {
    // TODO: Test update_nav instruction
  });
});
