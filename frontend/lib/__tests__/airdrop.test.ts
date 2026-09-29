import { isAirdropClosedError } from "../airdrop";

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
