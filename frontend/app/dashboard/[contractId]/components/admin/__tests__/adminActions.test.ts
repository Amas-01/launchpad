import { Address, scValToNative, xdr } from "@stellar/stellar-sdk";
import {
  ADMIN_ACTIONS,
  scaleAmount,
  type AdminActionContext,
  type AdminActionKey,
} from "../adminActions";

/**
 * `AdminPanel` had no test at all, because nothing inside a 2,351-line
 * component with two parallel if/else chains was independently reachable.
 * With the capabilities declared as data, the mapping from form input to
 * contract call is now directly assertable.
 */

const TOKEN = "CBTSFDGN5MU5NRKWSIBCMAMUGCHOC52H7KLZ44OKSGLC26BUKBZCCERJ";
const VESTING = "CD6RZ6E2HJHMSRRHEPCE2FWZWWVC543P67QSOPYKRAC7FIX52MZ6LMOF";
const ALICE = "GAEQZ5WIT3VJQ35W2JCQXFFKGUKOCKSCUZGWGVXQLZCMNXKXWKFQ7TV6";
const ADMIN = "GBONK2FUFJBONR6E7H6UN7H26ZNQYUCCF6YQRATRYWK3FOJGDBD3MXKX";

/** `create_schedule` / `extend_cliff` resolve ledgers relative to "now". */
const CURRENT_LEDGER = 1_000_000;
const LEDGERS_PER_DAY = 17280;

function makeContext(): AdminActionContext {
  return {
    contractId: TOKEN,
    decimals: 7,
    publicKey: ADMIN,
    server: {
      getLatestLedger: async () => ({ sequence: CURRENT_LEDGER }),
    } as unknown as AdminActionContext["server"],
    simulator: {} as AdminActionContext["simulator"],
  };
}

/** Decode an Address ScVal back to its strkey. */
function addressOf(value: xdr.ScVal): string {
  return Address.fromScVal(value).toString();
}

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
});

describe("action resolution", () => {
  it("scales mint amounts by the token's decimals", async () => {
    const call = await ADMIN_ACTIONS.mint.resolve(
      { to: ALICE, amount: "2.5" },
      makeContext(),
    );
    expect(call.method).toBe("mint");
    expect(addressOf(call.args[0])).toBe(ALICE);
    expect(scValToNative(call.args[1])).toBe(25_000_000n);
  });

  it("routes burn and clawback to distinct contract methods", async () => {
    const ctx = makeContext();
    const data = { from: ALICE, amount: "1" };
    expect((await ADMIN_ACTIONS.clawback.resolve(data, ctx)).method).toBe(
      "clawback",
    );
    expect((await ADMIN_ACTIONS["burn-admin"].resolve(data, ctx)).method).toBe(
      "burn_admin",
    );
  });

  it("cancels a pending transfer by re-proposing the current admin", async () => {
    // There is no on-chain cancel; overwriting with self neutralizes it.
    const call = await ADMIN_ACTIONS["cancel-admin"].resolve({}, makeContext());
    expect(call.method).toBe("propose_admin");
    expect(addressOf(call.args[0])).toBe(ADMIN);
  });

  it("targets the vesting contract, not the token, for schedule actions", async () => {
    const call = await ADMIN_ACTIONS.vesting.resolve(
      {
        vestingContract: VESTING,
        recipient: ALICE,
        amount: "10",
        cliffDays: "30",
        durationDays: "365",
      },
      makeContext(),
    );
    expect(call.contractId).toBe(VESTING);
    expect(call.method).toBe("create_schedule");

    const cliffLedger = CURRENT_LEDGER + 30 * LEDGERS_PER_DAY;
    expect(scValToNative(call.args[2])).toBe(cliffLedger);
    expect(scValToNative(call.args[3])).toBe(
      cliffLedger + 365 * LEDGERS_PER_DAY,
    );
  });

  it("encodes an omitted schedule index as Soroban None", async () => {
    const ctx = makeContext();
    const base = { vestingContract: VESTING, recipient: ALICE, newCliffDays: "" };

    const none = await ADMIN_ACTIONS["vesting-revoke"].resolve(
      { ...base, scheduleIndex: "" },
      ctx,
    );
    expect(none.args[1].switch()).toBe(xdr.ScValType.scvVoid());

    const some = await ADMIN_ACTIONS["vesting-revoke"].resolve(
      { ...base, scheduleIndex: "2" },
      ctx,
    );
    expect(scValToNative(some.args[1])).toBe(2);
  });

  it("clears optional policy values with a void argument", async () => {
    const ctx = makeContext();
    const whale = await ADMIN_ACTIONS["disable-whale-cap"].resolve({}, ctx);
    expect(whale.method).toBe("set_max_balance_per_account");
    expect(whale.args[0].switch()).toBe(xdr.ScValType.scvVoid());

    const node = await ADMIN_ACTIONS["clear-compliance-node"].resolve({}, ctx);
    expect(node.method).toBe("set_compliance_node");
    expect(node.args[0].switch()).toBe(xdr.ScValType.scvVoid());
  });

  it("maps the input-free lifecycle actions to their contract methods", async () => {
    const ctx = makeContext();
    const cases: [AdminActionKey, string][] = [
      ["pause", "pause"],
      ["unpause", "unpause"],
      ["revoke", "revoke_admin"],
      ["accept-admin", "accept_admin"],
    ];

    for (const [key, method] of cases) {
      const def = ADMIN_ACTIONS[key] as (typeof ADMIN_ACTIONS)["pause"];
      expect((await def.resolve({}, ctx)).method).toBe(method);
    }
  });

  it("maps the per-account freeze actions to their contract methods", async () => {
    const ctx = makeContext();
    const freeze = await ADMIN_ACTIONS.freeze.resolve({ address: ALICE }, ctx);
    const unfreeze = await ADMIN_ACTIONS.unfreeze.resolve(
      { address: ALICE },
      ctx,
    );

    expect(freeze.method).toBe("freeze_account");
    expect(unfreeze.method).toBe("unfreeze_account");
    expect(addressOf(freeze.args[0])).toBe(ALICE);
    expect(addressOf(unfreeze.args[0])).toBe(ALICE);
    // Both target the token itself, not a secondary contract.
    expect(freeze.contractId).toBeUndefined();
  });

  it("maps the holder authorization actions to their contract methods", async () => {
    const ctx = makeContext();
    const grant = await ADMIN_ACTIONS.authorize.resolve({ address: ALICE }, ctx);
    const revoke = await ADMIN_ACTIONS["revoke-auth"].resolve(
      { address: ALICE },
      ctx,
    );

    expect(grant.method).toBe("authorize_holder");
    expect(revoke.method).toBe("revoke_authorization");
    expect(addressOf(grant.args[0])).toBe(ALICE);
    expect(addressOf(revoke.args[0])).toBe(ALICE);
  });

  it("decodes the upgrade WASM hash into 32 raw bytes", async () => {
    const wasmHash = "ab".repeat(32);
    const call = await ADMIN_ACTIONS.upgrade.resolve(
      { wasmHash, confirmSymbol: "TST" },
      makeContext(),
    );
    expect(call.method).toBe("upgrade");
    expect(call.args[0].bytes()).toHaveLength(32);
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
