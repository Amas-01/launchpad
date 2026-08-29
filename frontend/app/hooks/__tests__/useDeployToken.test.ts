/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from "@testing-library/react";
import * as StellarSdk from "@stellar/stellar-sdk";
import * as tokenBindings from "@/lib/bindings/token/src/index";
import * as walletModule from "../useWallet";
import { useDeployToken } from "../useDeployToken";

type AnyModule = any;
const sdk = StellarSdk as AnyModule;
const tokenMock = tokenBindings as AnyModule;
const walletMock = walletModule as AnyModule;

// ── Mocks ───────────────────────────────────────────────────────────────────

jest.mock("@stellar/stellar-sdk", () => {
  const contractCalls: any[] = [];
  const mutable: any = {
    addressToString: "C-DEPLOYED-TOKEN-ADDRESS",
    simulateResult: null,
    sendResult: null,
    getTxResult: null,
  };

  class MockAddress {
    value: string;
    constructor(value: string) {
      this.value = value;
    }
    toScVal() {
      return { __address: this.value };
    }
    static fromScVal() {
      return new MockAddress(mutable.addressToString);
    }
    toString() {
      return this.value;
    }
  }

  class MockContract {
    constructor(public id: string) {}
    call(...args: any[]) {
      contractCalls.push(args);
      return { __invoke: args };
    }
  }

  class MockRpcServer {
    getAccount = jest.fn(async (pk: string) => ({ id: pk, sequence: "1" }));
    simulateTransaction = jest.fn(async () => mutable.simulateResult);
    sendTransaction = jest.fn(async () => mutable.sendResult);
    getTransaction = jest.fn(async () => mutable.getTxResult);
  }

  class MockTxBuilder {
    account: any;
    opts: any;
    op: any;
    constructor(account: any, opts: any) {
      this.account = account;
      this.opts = opts;
    }
    addOperation(op: any) {
      this.op = op;
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return { toXDR: () => "built-xdr" };
    }
    static fromXDR(xdr: string) {
      return { toXDR: () => xdr };
    }
  }

  return {
    __contractCalls: contractCalls,
    __mutable: mutable,
    Networks: { TESTNET: "Test SDF Network ; September 2015" },
    BASE_FEE: "100",
    rpc: {
      Server: MockRpcServer,
      assembleTransaction: () => ({
        build: () => ({ toXDR: () => "assembled-xdr" }),
      }),
      Api: {
        isSimulationError: (sim: any) => !!sim && sim.__error === true,
        isSimulationSuccess: (sim: any) => !!sim && sim.__success === true,
      },
    },
    Address: MockAddress,
    Contract: MockContract,
    Operation: { createCustomContract: jest.fn(() => ({ op: "create" })) },
    TransactionBuilder: MockTxBuilder,
    nativeToScVal: jest.fn((v: any) => v),
  };
});

jest.mock("../useWallet", () => {
  const wallet: any = {
    connected: true,
    publicKey: "GDEPLOYER0000000000000000000000000000000000000000000000",
    signTransaction: jest.fn(async () => "signed-xdr"),
  };
  return {
    __wallet: wallet,
    useWallet: () => wallet,
  };
});

jest.mock("../../providers/NetworkProvider", () => ({
  useNetwork: () => ({
    networkConfig: {
      rpcUrl: "https://soroban-testnet.stellar.org",
      passphrase: "Test SDF Network ; September 2015",
      network: "testnet",
    },
  }),
}));

jest.mock("@/lib/bindings/token/src/index", () => {
  const initialize = jest.fn();
  class MockTokenClient {
    constructor(public opts: any) {}
    initialize(args: any) {
      initialize(args);
      return Promise.resolve({ built: { toXDR: () => "init-built-xdr" } });
    }
  }
  return {
    __initialize: initialize,
    Client: MockTokenClient,
  };
});

jest.mock("@/lib/utils", () => ({
  toBaseUnits: (display: string | number, decimals: number) =>
    BigInt(Math.round(Number(display) * 10 ** decimals)),
}));

const baseParams = {
  name: "Test Token",
  symbol: "TST",
  decimals: 7,
  initialSupply: "1000",
  adminAddress: "GDEPLOYER0000000000000000000000000000000000000000000000",
};

const FACTORY_ADDRESS = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const TOKEN_WASM_HASH = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";

function resetMocks() {
  sdk.__contractCalls.length = 0;
  sdk.__mutable.addressToString = "C-DEPLOYED-TOKEN-ADDRESS";
  sdk.__mutable.simulateResult = { __success: true, result: { retval: {} } };
  sdk.__mutable.sendResult = { status: "PENDING", hash: "deadbeef" };
  sdk.__mutable.getTxResult = { status: "SUCCESS" };
  tokenMock.__initialize.mockClear();
}

function render() {
  const { result } = renderHook(() => useDeployToken());
  return result;
}

describe("useDeployToken (factory path)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_USE_LEGACY_DEPLOY = "false";
    process.env.NEXT_PUBLIC_FACTORY_ADDRESS = FACTORY_ADDRESS;
    process.env.NEXT_PUBLIC_TOKEN_WASM_HASH = TOKEN_WASM_HASH;
    walletMock.__wallet.connected = true;
    resetMocks();
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_USE_LEGACY_DEPLOY;
    delete process.env.NEXT_PUBLIC_FACTORY_ADDRESS;
    delete process.env.NEXT_PUBLIC_TOKEN_WASM_HASH;
  });

  it("throws a validation error when the wallet is not connected", async () => {
    walletMock.__wallet.connected = false;
    const result = render();

    await expect(
      act(() => result.current.deployToken(baseParams)),
    ).rejects.toMatchObject({ type: "validation" });
  });

  it("throws a validation error when the factory address is not configured", async () => {
    process.env.NEXT_PUBLIC_FACTORY_ADDRESS = "";
    const result = render();

    await expect(
      act(() => result.current.deployToken(baseParams)),
    ).rejects.toMatchObject({ type: "validation" });
  });

  it("calls deploy_token with a valid TokenConfig and returns the token address", async () => {
    const result = render();

    let deployment: any;
    await act(async () => {
      deployment = await result.current.deployToken({
        ...baseParams,
        initialSupply: "1000",
        maxSupply: "5000",
        authorizationRequired: true,
        authorizationRevocable: false,
        complianceNodeAddress:
          "GCOMPLIANCE0000000000000000000000000000000000000000000",
      });
    });

    expect(deployment).toEqual({
      contractId: "C-DEPLOYED-TOKEN-ADDRESS",
      transactionHash: "deadbeef",
    });

    expect(sdk.__contractCalls.length).toBe(1);
    const [method, deployer, salt, config] = sdk.__contractCalls[0];
    expect(method).toBe("deploy_token");
    expect(deployer.__address).toBe(walletMock.__wallet.publicKey);
    expect(salt.byteLength ?? salt.length).toBe(32);

    // TokenConfig fields (nativeToScVal is identity-mocked, so we see the raw object)
    expect(config.admin).toBe(baseParams.adminAddress);
    expect(config.decimal).toBe(7);
    expect(config.name).toBe("Test Token");
    expect(config.symbol).toBe("TST");
    expect(config.initial_supply).toBe(10_000_000_000n);
    expect(config.max_supply).toBe(50_000_000_000n);
    expect(config.authorization_required).toBe(true);
    expect(config.authorization_revocable).toBe(false);
    expect(config.compliance_node).toBe(
      "GCOMPLIANCE0000000000000000000000000000000000000000000",
    );
  });

  it("passes None for optional config fields when omitted", async () => {
    const result = render();

    await act(async () => {
      await result.current.deployToken(baseParams);
    });

    const [, , , config] = sdk.__contractCalls[0];
    expect(config.max_supply).toBeNull();
    expect(config.compliance_node).toBeNull();
    expect(config.authorization_required).toBe(false);
  });
});

describe("useDeployToken (legacy path)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_USE_LEGACY_DEPLOY = "true";
    process.env.NEXT_PUBLIC_FACTORY_ADDRESS = FACTORY_ADDRESS;
    process.env.NEXT_PUBLIC_TOKEN_WASM_HASH = TOKEN_WASM_HASH;
    walletMock.__wallet.connected = true;
    resetMocks();
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_USE_LEGACY_DEPLOY;
    delete process.env.NEXT_PUBLIC_FACTORY_ADDRESS;
    delete process.env.NEXT_PUBLIC_TOKEN_WASM_HASH;
  });

  it("throws a validation error when the WASM hash is missing", async () => {
    process.env.NEXT_PUBLIC_TOKEN_WASM_HASH = "";
    const result = render();

    await expect(
      act(() => result.current.deployToken(baseParams)),
    ).rejects.toMatchObject({ type: "validation" });
  });

  it("deploys the contract then initializes it as a separate transaction", async () => {
    sdk.__mutable.addressToString = "C-LEGACY-TOKEN-ADDRESS";
    sdk.__mutable.getTxResult = {
      status: "SUCCESS",
      resultMetaXdr: {
        v3: () => ({
          sorobanMeta: () => ({ returnValue: () => ({}) }),
        }),
      },
    };
    const result = render();

    let deployment: any;
    await act(async () => {
      deployment = await result.current.deployToken(baseParams);
    });

    expect(deployment).toEqual({
      contractId: "C-LEGACY-TOKEN-ADDRESS",
      transactionHash: "deadbeef",
    });

    // The deploy step uses createCustomContract (no contract.call in the legacy path)
    expect(sdk.__contractCalls.length).toBe(0);
    // initialize() invoked on the token client with scaled supplies
    expect(tokenMock.__initialize).toHaveBeenCalledTimes(1);
    const initArgs = tokenMock.__initialize.mock.calls[0][0];
    expect(initArgs.admin).toBe(baseParams.adminAddress);
    expect(initArgs.initial_supply).toBe(10_000_000_000n);
    expect(initArgs.max_supply).toBeUndefined();
  });
});