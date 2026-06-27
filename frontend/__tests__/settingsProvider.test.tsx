import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsProvider } from "@/app/providers/SettingsProvider";
import { useSettings } from "@/app/hooks/useSettings";

let mockNetwork: "testnet" | "mainnet" = "testnet";
let mockCustomRpc: string | null = null;
let mockCustomHorizon: string | null = null;

jest.mock("@/app/providers/NetworkProvider", () => ({
  useNetwork: () => ({
    networkConfig: {
      network: mockNetwork,
      rpcUrl:
        mockNetwork === "mainnet"
          ? "https://mainnet.stellar.org:443"
          : "https://soroban-testnet.stellar.org",
      horizonUrl:
        mockNetwork === "mainnet"
          ? "https://horizon.stellar.org"
          : "https://horizon-testnet.stellar.org",
      passphrase:
        mockNetwork === "mainnet"
          ? "Public Global Stellar Network ; September 2015"
          : "Test SDF Network ; September 2015",
    },
    customRpcUrl: mockCustomRpc,
    customHorizonUrl: mockCustomHorizon,
    setCustomRpcUrl: (url: string | null) => {
      mockCustomRpc = url;
      if (url === null) {
        localStorage.removeItem(`soropad_rpc_url:${mockNetwork}`);
      } else {
        localStorage.setItem(`soropad_rpc_url:${mockNetwork}`, url);
      }
    },
    setCustomHorizonUrl: (url: string | null) => {
      mockCustomHorizon = url;
      if (url === null) {
        localStorage.removeItem(`soropad_horizon_url:${mockNetwork}`);
      } else {
        localStorage.setItem(`soropad_horizon_url:${mockNetwork}`, url);
      }
    },
  }),
}));

function SettingsConsumer() {
  const {
    rpcUrl,
    horizonUrl,
    defaultRpcUrl,
    defaultHorizonUrl,
    setRpcUrl,
    setHorizonUrl,
    resetToDefaults,
  } = useSettings();

  return (
    <div>
      <div data-testid="rpc">{rpcUrl}</div>
      <div data-testid="horizon">{horizonUrl}</div>
      <div data-testid="default-rpc">{defaultRpcUrl}</div>
      <div data-testid="default-horizon">{defaultHorizonUrl}</div>
      <button onClick={() => setRpcUrl("https://custom-rpc.example.com")}>
        set rpc
      </button>
      <button
        onClick={() => setHorizonUrl("https://custom-horizon.example.com")}
      >
        set horizon
      </button>
      <button onClick={resetToDefaults}>reset</button>
    </div>
  );
}

function renderSettingsProvider() {
  return render(
    <SettingsProvider>
      <SettingsConsumer />
    </SettingsProvider>,
  );
}

describe("SettingsProvider", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    mockNetwork = "testnet";
    mockCustomRpc = null;
    mockCustomHorizon = null;
    localStorage.clear();
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_SOROBAN_RPC_URL;
    delete process.env.NEXT_PUBLIC_HORIZON_URL;
    delete process.env.NEXT_PUBLIC_TESTNET_SOROBAN_RPC_URL;
    delete process.env.NEXT_PUBLIC_TESTNET_HORIZON_URL;
    delete process.env.NEXT_PUBLIC_MAINNET_SOROBAN_RPC_URL;
    delete process.env.NEXT_PUBLIC_MAINNET_RPC_URL;
    delete process.env.NEXT_PUBLIC_MAINNET_HORIZON_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("loads saved values for the active network from localStorage", () => {
    mockCustomRpc = "https://saved-testnet-rpc.example.com";
    mockCustomHorizon = "https://saved-testnet-horizon.example.com";

    renderSettingsProvider();

    expect(screen.getByTestId("rpc")).toHaveTextContent(
      "https://saved-testnet-rpc.example.com",
    );
    expect(screen.getByTestId("horizon")).toHaveTextContent(
      "https://saved-testnet-horizon.example.com",
    );
  });

  it("falls back to testnet environment defaults when no saved values exist", () => {
    process.env.NEXT_PUBLIC_TESTNET_SOROBAN_RPC_URL =
      "https://env-testnet-rpc.example.com";
    process.env.NEXT_PUBLIC_TESTNET_HORIZON_URL =
      "https://env-testnet-horizon.example.com";

    renderSettingsProvider();

    expect(screen.getByTestId("rpc")).toHaveTextContent(
      "https://env-testnet-rpc.example.com",
    );
    expect(screen.getByTestId("horizon")).toHaveTextContent(
      "https://env-testnet-horizon.example.com",
    );
    expect(screen.getByTestId("default-rpc")).toHaveTextContent(
      "https://env-testnet-rpc.example.com",
    );
    expect(screen.getByTestId("default-horizon")).toHaveTextContent(
      "https://env-testnet-horizon.example.com",
    );
  });

  it("falls back to mainnet environment defaults for the mainnet network", () => {
    mockNetwork = "mainnet";
    process.env.NEXT_PUBLIC_MAINNET_SOROBAN_RPC_URL =
      "https://env-mainnet-rpc.example.com";
    process.env.NEXT_PUBLIC_MAINNET_HORIZON_URL =
      "https://env-mainnet-horizon.example.com";

    renderSettingsProvider();

    expect(screen.getByTestId("rpc")).toHaveTextContent(
      "https://env-mainnet-rpc.example.com",
    );
    expect(screen.getByTestId("horizon")).toHaveTextContent(
      "https://env-mainnet-horizon.example.com",
    );
  });

  it("persists user updates under the active network keys", () => {
    renderSettingsProvider();

    fireEvent.click(screen.getByText("set rpc"));
    fireEvent.click(screen.getByText("set horizon"));

    expect(localStorage.getItem("soropad_rpc_url:testnet")).toBe(
      "https://custom-rpc.example.com",
    );
    expect(localStorage.getItem("soropad_horizon_url:testnet")).toBe(
      "https://custom-horizon.example.com",
    );
  });

  it("keeps saved settings isolated per network and resets only the active network", () => {
    mockCustomRpc = "https://saved-testnet-rpc.example.com";
    mockCustomHorizon = "https://saved-testnet-horizon.example.com";

    const view = renderSettingsProvider();
    expect(screen.getByTestId("rpc")).toHaveTextContent(
      "https://saved-testnet-rpc.example.com",
    );

    mockNetwork = "mainnet";
    mockCustomRpc = "https://saved-mainnet-rpc.example.com";
    mockCustomHorizon = "https://saved-mainnet-horizon.example.com";
    process.env.NEXT_PUBLIC_MAINNET_SOROBAN_RPC_URL =
      "https://env-mainnet-rpc.example.com";
    process.env.NEXT_PUBLIC_MAINNET_HORIZON_URL =
      "https://env-mainnet-horizon.example.com";

    view.rerender(
      <SettingsProvider>
        <SettingsConsumer />
      </SettingsProvider>,
    );

    expect(screen.getByTestId("rpc")).toHaveTextContent(
      "https://saved-mainnet-rpc.example.com",
    );
    expect(screen.getByTestId("horizon")).toHaveTextContent(
      "https://saved-mainnet-horizon.example.com",
    );

    fireEvent.click(screen.getByText("reset"));

    // Re-render so SettingsProvider picks up the updated mock state
    view.rerender(
      <SettingsProvider>
        <SettingsConsumer />
      </SettingsProvider>,
    );

    expect(screen.getByTestId("rpc")).toHaveTextContent(
      "https://env-mainnet-rpc.example.com",
    );
    expect(screen.getByTestId("horizon")).toHaveTextContent(
      "https://env-mainnet-horizon.example.com",
    );
    expect(mockCustomRpc).toBeNull();
    expect(mockCustomHorizon).toBeNull();
  });
});
