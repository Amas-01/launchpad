import { toBaseUnits } from "../utils";
import * as StellarSdk from "@stellar/stellar-sdk";

describe("toBaseUnits", () => {
  it("scales 1,000,000 supply with 7 decimals to 10_000_000_000_000n", () => {
    const display = 1000000;
    const decimals = 7;
    const expected = 10000000000000n;
    expect(toBaseUnits(display, decimals)).toBe(expected);
  });
  
  it("handles string inputs correctly", () => {
    expect(toBaseUnits("1000000", 7)).toBe(10000000000000n);
  });

  it("handles decimal inputs correctly", () => {
    expect(toBaseUnits(0.1, 7)).toBe(1000000n);
  });

  it("asserts the ScVal built for a 1,000,000 / 7-decimal token equals 10_000_000_000_000n in ScVal", () => {
    const scVal = StellarSdk.nativeToScVal(toBaseUnits(1000000, 7), { type: "i128" });
    const expectedScVal = StellarSdk.nativeToScVal(10000000000000n, { type: "i128" });
    expect(scVal.toXDR("base64")).toEqual(expectedScVal.toXDR("base64"));
  });
});
