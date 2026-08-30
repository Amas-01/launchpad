import { toBaseUnits, fromBaseUnits } from "../utils";
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

  it("correctly scales a 6-decimal token (not 7)", () => {
    // 1 token with 6 decimals = 1_000_000, NOT 10_000_000
    expect(toBaseUnits(1, 6)).toBe(1_000_000n);
  });

  it("correctly scales an 18-decimal token (not 7)", () => {
    expect(toBaseUnits(1, 18)).toBe(1_000_000_000_000_000_000n);
  });
});

describe("fromBaseUnits", () => {
  it("is the exact inverse of toBaseUnits for whole numbers", () => {
    expect(fromBaseUnits(toBaseUnits(100, 7), 7)).toBe("100");
  });

  it("is the exact inverse of toBaseUnits for fractional amounts", () => {
    expect(fromBaseUnits(toBaseUnits("1.5", 7), 7)).toBe("1.5");
  });

  it("handles 6-decimal tokens correctly", () => {
    // 1_000_000 raw units with 6 decimals = "1"
    expect(fromBaseUnits(1_000_000n, 6)).toBe("1");
  });

  it("handles 18-decimal tokens correctly", () => {
    expect(fromBaseUnits(1_000_000_000_000_000_000n, 18)).toBe("1");
  });

  it("handles 0 decimals", () => {
    expect(fromBaseUnits(42n, 0)).toBe("42");
  });

  it("trims trailing fractional zeros", () => {
    // 1_500_000 with 7 decimals = 0.15, not 0.1500000
    expect(fromBaseUnits(1_500_000n, 7)).toBe("0.15");
  });

  it("round-trips do not lose precision vs hand-rolled float division", () => {
    // This is the bug fromBaseUnits prevents: Number(amount) / 10 ** decimals
    // loses precision for large amounts on 18-decimal tokens.
    const raw = 1_234_567_890_123_456_789n;
    const result = fromBaseUnits(raw, 18);
    // Must not be the imprecise float result
    expect(result).not.toBe((Number(raw) / 1e18).toString());
    expect(result).toBe("1.234567890123456789");
  });
});
