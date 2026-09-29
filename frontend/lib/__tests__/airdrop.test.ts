import fs from "fs";
import path from "path";
import { AirdropErrorCode, airdropErrorCode, isAirdropClosedError } from "../airdrop";

/**
 * A reclaimed airdrop refuses `fund` so that tokens cannot be parked in a
 * contract with no function left to move them out. The builder's job is to
 * turn that refusal into "redeploy" rather than a raw `Error(Contract, #9)`,
 * which is what these tests pin down.
 */
describe("isAirdropClosedError", () => {
  it("recognises the airdrop's AlreadyReclaimed error", () => {
    expect(
      isAirdropClosedError(
        new Error("Simulation failed: HostError: Error(Contract, #9)"),
      ),
    ).toBe(true);
    expect(isAirdropClosedError("Error(Contract, #9)")).toBe(true);
  });

  it("ignores other contract error codes", () => {
    // The token refusing the transfer inside `fund` (insufficient balance).
    expect(isAirdropClosedError(new Error("Error(Contract, #8)"))).toBe(false);
    expect(
      isAirdropClosedError(new Error("Transaction failed on-chain")),
    ).toBe(false);
  });

  it("ignores values that are not errors", () => {
    expect(isAirdropClosedError(undefined)).toBe(false);
    expect(isAirdropClosedError({ code: 9 })).toBe(false);
  });
});

const CONTRACTS_DIR = path.resolve(__dirname, "../../../contracts");

/**
 * The admin panel names airdrop errors by number — "the airdrop is paused",
 * "that deadline is too far" — so a number that no longer means what the UI
 * says it means would misreport a failure to an operator holding a signing
 * wallet. Reading the Rust enum keeps the two from drifting.
 */
describe("AirdropErrorCode", () => {
  it("matches the contract's AirdropError enum exactly", () => {
    const source = fs.readFileSync(
      path.join(CONTRACTS_DIR, "airdrop", "src/lib.rs"),
      "utf8",
    );
    const production = source.split("#[cfg(test)]")[0];
    const fromContract = [...production.matchAll(/^\s{4}(\w+) = (\d+),/gm)]
      .reduce<Record<string, number>>((acc, [, name, value]) => {
        acc[name] = Number(value);
        return acc;
      }, {});

    expect(fromContract).not.toEqual({});
    expect({ ...AirdropErrorCode }).toEqual(fromContract);
  });
});

describe("airdropErrorCode", () => {
  it("reads the number out of either failure form", () => {
    expect(
      airdropErrorCode(
        new Error("Simulation failed: HostError: Error(Contract, #16)"),
      ),
    ).toBe(16);
    expect(airdropErrorCode("Error(Contract, #20)")).toBe(20);
  });

  it("returns null when the failure carries no contract error", () => {
    expect(airdropErrorCode(new Error("Transaction failed on-chain"))).toBe(
      null,
    );
    expect(airdropErrorCode(undefined)).toBe(null);
    expect(airdropErrorCode({ code: 15 })).toBe(null);
  });
});
