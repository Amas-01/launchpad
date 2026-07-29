import {
  ADMIN_ACTIONS,
  scaleAmount,
  type AdminActionKey,
} from "../adminActions";

describe("scaleAmount", () => {
  it("scales a decimal string into base units", () => {
    expect(scaleAmount("1.5", 7)).toBe(15_000_000n);
    expect(scaleAmount("100", 0)).toBe(100n);
  });
});

describe("ADMIN_ACTIONS registry", () => {
  it("declares every action with a label and a resolver", () => {
    for (const [key, def] of Object.entries(ADMIN_ACTIONS)) {
      expect(typeof def.label).toBe("string");
      expect(def.label.length).toBeGreaterThan(0);
      expect(typeof def.resolve).toBe("function");
      // Guards against a typo'd key silently shadowing another action.
      expect(key).toBe(key.trim());
    }
  });

  it("covers every capability the panel exposes", () => {
    const expected: AdminActionKey[] = [
      "mint",
      "batch-mint",
      "clawback",
      "burn-admin",
      "transfer",
      "cancel-admin",
      "accept-admin",
      "revoke",
      "vesting",
      "extend-cliff",
      "vesting-revoke",
      "set-whale-cap",
      "disable-whale-cap",
      "set-compliance-node",
      "clear-compliance-node",
      "metadata-uri",
      "pause",
      "unpause",
      "freeze",
      "unfreeze",
      "authorize",
      "revoke-auth",
      "upgrade",
    ];
    expect(Object.keys(ADMIN_ACTIONS).sort()).toEqual(expected.sort());
  });

  it("skips preflight only for the actions that take no user input", () => {
    const skipped = Object.entries(ADMIN_ACTIONS)
      .filter(([, def]) => def.preflight === "none")
      .map(([key]) => key)
      .sort();
    expect(skipped).toEqual(
      ["batch-mint", "pause", "revoke", "unpause", "upgrade"].sort(),
    );
  });
});
