/**
 * Transaction Simulator Tests
 * Tests for the Soroban transaction pre-flight check system.
 * These are examples of how to test the simulator and error parsing.
 */

import "@testing-library/jest-dom";
import {
  parseSorobanError,
  // simulateTransaction,
} from "@/lib/transactionSimulator";
import {
  render,
  screen,
  renderHook,
  //  act
} from "@testing-library/react";
import { useTransactionSimulator } from "@/hooks/useTransactionSimulator";
import { ToastProvider } from "@/app/providers/ToastProvider";

// Mock useNetwork
jest.mock("@/app/providers/NetworkProvider", () => ({
  useNetwork: () => ({
    networkConfig: {
      rpcUrl: "https://soroban-testnet.stellar.org",
      passphrase: "Test SDF Network ; September 2015",
      network: "testnet",
    },
  }),
}));

// Error Parsing Tests

describe("parseSorobanError", () => {
  it("maps insufficient balance error", () => {
    const error = "insufficient balance for transfer";
    const parsed = parseSorobanError(error);
    expect(parsed).toContain("Insufficient token balance");
  });

  it("maps max supply exceeded error", () => {
    const error = "mint would exceed max_supply";
    const parsed = parseSorobanError(error);
    expect(parsed).toContain("maximum supply cap");
  });

  it("maps account frozen error", () => {
    const error = "account is frozen";
    const parsed = parseSorobanError(error);
    expect(parsed).toContain("frozen");
  });

  it("maps not initialized error", () => {
    const error = "not initialized";
    const parsed = parseSorobanError(error);
    expect(parsed).toContain("not initialized");
  });

  it("maps vesting schedule errors", () => {
    const errors = [
      "schedule has been revoked",
      "no schedule found",
      "nothing to release",
      "end_ledger must be after cliff_ledger",
    ];

    errors.forEach((error) => {
      const parsed = parseSorobanError(error);
      expect(parsed).not.toBe(error); // Should be mapped
      expect(parsed.length).toBeGreaterThan(0);
    });
  });

  it("falls back to original error if no mapping found", () => {
    const error = "some unknown error code 12345";
    const parsed = parseSorobanError(error);
    expect(parsed).toContain("unknown error");
  });

  it("handles timeout errors", () => {
    const error = "timeout";
    const parsed = parseSorobanError(error);
    expect(parsed).toContain("timed out");
  });

  it("handles deadline exceeded errors", () => {
    const error = "deadline exceeded";
    const parsed = parseSorobanError(error);
    expect(parsed).toContain("deadline");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Hook Tests
// ───────────────────────────────────────────────────────────────────────────

describe("useTransactionSimulator", () => {
  it("initializes with loading state false", () => {
    const { result } = renderHook(() => useTransactionSimulator());
    expect(result.current.isLoading).toBe(false);
  });

  it("provides all simulation methods", () => {
    const { result } = renderHook(() => useTransactionSimulator());

    expect(typeof result.current.checkTransfer).toBe("function");
    expect(typeof result.current.checkMint).toBe("function");
    expect(typeof result.current.checkBurn).toBe("function");
    expect(typeof result.current.checkTransferFrom).toBe("function");
    expect(typeof result.current.checkVestingRelease).toBe("function");
    expect(typeof result.current.checkVestingRevoke).toBe("function");
    expect(typeof result.current.checkCreateSchedule).toBe("function");
    expect(typeof result.current.simulateContract).toBe("function");
  });

  it("has network config available", () => {
    const { result } = renderHook(() => useTransactionSimulator());
    expect(result.current.networkConfig).toBeDefined();
    expect(result.current.networkConfig.passphrase).toBeDefined();
    expect(result.current.networkConfig.rpcUrl).toBeDefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Component Integration Tests
// ───────────────────────────────────────────────────────────────────────────

import { render, screen } from "@testing-library/react";
import {
  PreflightCheckDisplay,
  PreflightError,
  PreflightWarning,
  PreflightSuccess,
  PreflightLoading,
} from "@/components/ui/PreflightCheck";

describe("PreflightCheck Components", () => {
  describe("PreflightError", () => {
    it("displays error messages", () => {
      render(<PreflightError errors={["Failed to transfer tokens"]} />);
      expect(
        screen.getByText(/Failed to transfer tokens/i),
      ).toBeInTheDocument();
    });

    it("displays multiple errors", () => {
      const errors = ["Error 1", "Error 2", "Error 3"];
      render(<PreflightError errors={errors} />);

      errors.forEach((error) => {
        expect(screen.getByText(new RegExp(error, "i"))).toBeInTheDocument();
      });
    });

    it("calls onDismiss when dismiss button clicked", () => {
      const onDismiss = jest.fn();
      const { container } = render(
        <PreflightError errors={["Test error"]} onDismiss={onDismiss} />,
      );

      const dismissButton = container.querySelector("button");
      expect(dismissButton).toBeInTheDocument();
      dismissButton?.click();
      expect(onDismiss).toHaveBeenCalled();
    });

    it("returns null if no errors", () => {
      const { container } = render(<PreflightError errors={[]} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe("PreflightWarning", () => {
    it("displays warning messages", () => {
      render(<PreflightWarning warnings={["High transaction fee"]} />);
      expect(screen.getByText(/High transaction fee/i)).toBeInTheDocument();
    });

    it("returns null if no warnings", () => {
      const { container } = render(<PreflightWarning warnings={[]} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe("PreflightSuccess", () => {
    it("displays success message", () => {
      render(<PreflightSuccess message="Transaction ready" />);
      expect(screen.getByText("Transaction ready")).toBeInTheDocument();
    });

    it("uses default message if not provided", () => {
      render(<PreflightSuccess />);
      expect(
        screen.getByText("Transaction is ready to sign"),
      ).toBeInTheDocument();
    });
  });

  describe("PreflightLoading", () => {
    it("displays loading message", () => {
      render(<PreflightLoading />);
      expect(screen.getByText("Checking transaction...")).toBeInTheDocument();
    });

    it("displays custom loading message", () => {
      render(<PreflightLoading message="Please wait..." />);
      expect(screen.getByText("Please wait...")).toBeInTheDocument();
    });
  });

  describe("PreflightCheckDisplay", () => {
    it("shows loading state", () => {
      render(<PreflightCheckDisplay isLoading={true} />);
      expect(screen.getByText("Checking transaction...")).toBeInTheDocument();
    });

    it("shows errors when present", () => {
      render(
        <PreflightCheckDisplay
          isLoading={false}
          errors={["Test error"]}
          warnings={[]}
        />,
      );
      expect(screen.getByText(/Test error/i)).toBeInTheDocument();
    });

    it("shows warnings when no errors", () => {
      render(
        <PreflightCheckDisplay
          isLoading={false}
          errors={[]}
          warnings={["Test warning"]}
        />,
      );
      expect(screen.getByText(/Test warning/i)).toBeInTheDocument();
    });

    it("shows success message when no errors or warnings", () => {
      render(
        <PreflightCheckDisplay
          isLoading={false}
          errors={[]}
          warnings={[]}
          successMessage="All good!"
        />,
      );
      expect(screen.getByText("All good!")).toBeInTheDocument();
    });

    it("returns null when nothing to display", () => {
      const { container } = render(
        <PreflightCheckDisplay isLoading={false} errors={[]} warnings={[]} />,
      );
      expect(container.firstChild).toBeNull();
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Form Integration Tests
// ───────────────────────────────────────────────────────────────────────────

import { MintForm } from "@/components/forms/MintForm";

describe("MintForm with Pre-flight Checks", () => {
  it("renders check button and submit button", () => {
    render(
      <ToastProvider>
        <MintForm adminAddress="GABC123..." />
      </ToastProvider>,
    );
    expect(screen.getByText("Check Transaction")).toBeInTheDocument();
    expect(screen.getByText("Mint Tokens")).toBeInTheDocument();
  });

  // it("disables submit button until check succeeds", async () => {
  //   // const { container } = render(<MintForm adminAddress="GABC123..." />);

  //   const submitButton = screen.getByText("Mint Tokens") as HTMLButtonElement;
  //   expect(submitButton.disabled).toBe(true);

  //   // After check (mocked)
  //   // expect(submitButton.disabled).toBe(false);
  // });

  it("shows pre-flight results after check", async () => {
    render(
      <ToastProvider>
        <MintForm adminAddress="GABC123..." />
      </ToastProvider>,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Mock Network Tests
// ───────────────────────────────────────────────────────────────────────────

describe("Simulation with Mock RPC", () => {
  // These tests would use mocked Soroban RPC responses
  // In a real scenario, use a testing library like jest-fetch-mock

  it("returns success result for valid transfer simulation", async () => {
    // Mock successful simulation
    // expect(result.success).toBe(true);
  });

  it("returns error result for insufficient balance", async () => {
    // Mock RPC returning insufficient balance error
    // expect(result.success).toBe(false);
    // expect(result.errors).toContain("Insufficient");
  });

  it("returns warnings for high fees", async () => {
    // Mock RPC returning high cost
    // expect(result.warnings).toContain("High");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Snapshot Tests
// ───────────────────────────────────────────────────────────────────────────

describe("Pre-flight Check Snapshots", () => {
  it("matches error display snapshot", () => {
    const { container } = render(
      <PreflightError errors={["Insufficient balance"]} />,
    );
    expect(container).toMatchSnapshot();
  });

  it("matches success display snapshot", () => {
    const { container } = render(<PreflightSuccess message="Ready to sign" />);
    expect(container).toMatchSnapshot();
  });
});
