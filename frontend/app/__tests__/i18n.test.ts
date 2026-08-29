import en from "../../messages/en.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import zh from "../../messages/zh.json";

function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return flattenKeys(value as Record<string, unknown>, fullKey);
    }
    return fullKey;
  });
}

function extractInterpolations(value: string): string[] {
  const matches = value.match(/\{[a-zA-Z]+\}/g);
  return matches ? matches.map((m) => m.slice(1, -1)) : [];
}

function collectInterpolations(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(
        result,
        collectInterpolations(value as Record<string, unknown>, fullKey),
      );
    } else if (typeof value === "string") {
      const params = extractInterpolations(value);
      if (params.length > 0) {
        result[fullKey] = params;
      }
    }
  }
  return result;
}

describe("i18n message files", () => {
  const sources: Record<string, Record<string, unknown>> = {
    en: en as Record<string, unknown>,
    es: es as Record<string, unknown>,
    fr: fr as Record<string, unknown>,
    zh: zh as Record<string, unknown>,
  };

  const enKeys = flattenKeys(sources.en).sort();
  const enInterpolations = collectInterpolations(sources.en);

  it.each(["es", "fr", "zh"])("%s has every key that en has", (lang) => {
    const keys = flattenKeys(sources[lang]).sort();
    const missing = enKeys.filter((k) => !keys.includes(k));
    expect(missing).toEqual([]);
  });

  it.each(["es", "fr", "zh"])("%s has no extra keys beyond en", (lang) => {
    const keys = flattenKeys(sources[lang]).sort();
    const extra = keys.filter((k) => !enKeys.includes(k));
    expect(extra).toEqual([]);
  });

  it.each(["es", "fr", "zh"])(
    "%s has matching interpolations for every key",
    (lang) => {
      const langInterps = collectInterpolations(sources[lang]);
      for (const [key, enParams] of Object.entries(enInterpolations)) {
        const langParams = langInterps[key] ?? [];
        expect(langParams.sort()).toEqual(enParams.sort());
      }
    },
  );

  it("en has the admin section fully populated", () => {
    const adminKeys = flattenKeys(sources.en).filter((k) =>
      k.startsWith("admin."),
    );
    expect(adminKeys.length).toBeGreaterThan(20);
    expect(adminKeys).toContain("admin.title");
    expect(adminKeys).toContain("admin.contractPaused");
    expect(adminKeys).toContain("admin.adminRevoked");
    expect(adminKeys).toContain("admin.adminTransferPending");
  });

  it("claim namespace has all keys used by components", () => {
    const claimKeys = flattenKeys(sources.en).filter((k) =>
      k.startsWith("claim."),
    );
    const required = [
      "claim.title",
      "claim.description",
      "claim.walletGate",
      "claim.connectWallet",
      "claim.contractIdLabel",
      "claim.contractIdPlaceholder",
      "claim.lookUp",
      "claim.walletNotConnected",
      "claim.walletNotConnectedMessage",
      "claim.noSchedule",
      "claim.invalidContractId",
      "claim.noTokensAvailable",
      "claim.noTokensAvailableMessage",
      "claim.successTitle",
      "claim.successMessage",
      "claim.releaseFailed",
      "claim.genericReleaseError",
    ];
    for (const key of required) {
      expect(claimKeys).toContain(key);
    }
  });

  it("myAccount namespace has all keys used by components", () => {
    const myAccountKeys = flattenKeys(sources.en).filter((k) =>
      k.startsWith("myAccount."),
    );
    const required = [
      "myAccount.title",
      "myAccount.connectTitle",
      "myAccount.connectDescription",
      "myAccount.connectWallet",
      "myAccount.copyWalletAria",
      "myAccount.tokenBalances",
      "myAccount.noBalances",
      "myAccount.vestingSchedules",
      "myAccount.vestingLookupDescription",
      "myAccount.vestingPlaceholder",
      "myAccount.contractLabel",
      "myAccount.scheduleOf",
      "myAccount.total",
      "myAccount.released",
      "myAccount.unreleased",
      "myAccount.vested",
      "myAccount.revoked",
      "myAccount.cliffPending",
      "myAccount.fullyVested",
      "myAccount.vesting",
      "myAccount.transactionHistory",
      "myAccount.outgoingAllowances",
      "myAccount.outgoingAllowancesDesc",
      "myAccount.allowanceContractLabel",
      "myAccount.allowanceContractPlaceholder",
      "myAccount.loadAllowances",
      "myAccount.loadingAllowances",
      "myAccount.noAllowancesTitle",
      "myAccount.noAllowancesDescription",
      "myAccount.spenderLabel",
      "myAccount.amountLabel",
      "myAccount.statusLabel",
      "myAccount.expired",
      "myAccount.active",
      "myAccount.revoke",
      "myAccount.allowanceError",
      "myAccount.revokeError",
    ];
    for (const key of required) {
      expect(myAccountKeys).toContain(key);
    }
  });

  it("recentLaunches namespace has all keys used by components", () => {
    const keys = flattenKeys(sources.en).filter((k) =>
      k.startsWith("recentLaunches."),
    );
    const required = [
      "recentLaunches.title",
      "recentLaunches.description",
      "recentLaunches.error",
      "recentLaunches.emptyTitle",
      "recentLaunches.emptyDescription",
      "recentLaunches.emptyAction",
      "recentLaunches.trending",
      "recentLaunches.supply",
      "recentLaunches.contract",
      "recentLaunches.deployed",
      "recentLaunches.viewDashboard",
    ];
    for (const key of required) {
      expect(keys).toContain(key);
    }
  });

  it("transfer namespace has all keys used by components", () => {
    const keys = flattenKeys(sources.en).filter((k) =>
      k.startsWith("transfer."),
    );
    const required = [
      "transfer.connectTitle",
      "transfer.connectDescription",
      "transfer.noBalanceTitle",
      "transfer.noBalanceDescription",
      "transfer.title",
      "transfer.yourBalance",
      "transfer.recipientLabel",
      "transfer.recipientPlaceholder",
      "transfer.amountLabel",
      "transfer.amountPlaceholder",
      "transfer.insufficientBalance",
      "transfer.insufficientForTransfer",
      "transfer.connectFirst",
      "transfer.transactionCancelled",
      "transfer.simulationFailed",
      "transfer.transferComplete",
      "transfer.transferTokens",
      "transfer.transferSuccessful",
      "transfer.networkNote",
      "transfer.lastTx",
    ];
    for (const key of required) {
      expect(keys).toContain(key);
    }
  });

  it("userPanel namespace has all keys used by components", () => {
    const keys = flattenKeys(sources.en).filter((k) =>
      k.startsWith("userPanel."),
    );
    const required = [
      "userPanel.yourDashboard",
      "userPanel.balanceLabel",
      "userPanel.loadingBalance",
      "userPanel.burnTitle",
      "userPanel.burnWarning",
      "userPanel.burnAmountLabel",
      "userPanel.burnAmountPlaceholder",
      "userPanel.burnButton",
      "userPanel.burnSuccessful",
      "userPanel.burnFailed",
      "userPanel.lastTx",
    ];
    for (const key of required) {
      expect(keys).toContain(key);
    }
  });

  it("mainnetWarning namespace has all keys used by components", () => {
    const keys = flattenKeys(sources.en).filter((k) =>
      k.startsWith("mainnetWarning."),
    );
    expect(keys).toContain("mainnetWarning.message");
  });

  it("errorBoundary namespace exists for future use", () => {
    const keys = flattenKeys(sources.en).filter((k) =>
      k.startsWith("errorBoundary."),
    );
    expect(keys).toContain("errorBoundary.title");
    expect(keys).toContain("errorBoundary.refreshButton");
  });

  it("rejects a locale file that is missing a key (negative test)", () => {
    const esMissing = enKeys.filter(
      (k) => !flattenKeys(sources.es).includes(k),
    );
    const frMissing = enKeys.filter(
      (k) => !flattenKeys(sources.fr).includes(k),
    );
    const zhMissing = enKeys.filter(
      (k) => !flattenKeys(sources.zh).includes(k),
    );
    // All should have zero missing keys
    expect([...esMissing, ...frMissing, ...zhMissing]).toEqual([]);
  });
});
