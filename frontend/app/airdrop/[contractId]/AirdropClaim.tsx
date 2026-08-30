"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";
import { useToast } from "@/app/providers/ToastProvider";
import { useWallet } from "@/app/hooks/useWallet";
import { verifyProof, type ProofSet } from "@/lib/merkle";
import {
  buildClaimTx,
  fetchAirdropInfo,
  fetchClaimStatus,
  fetchTokenDecimals,
  formatTokenAmount,
  ledgersToApproxDuration,
  submitTx,
  type AirdropInfo,
  type ClaimStatus,
} from "@/lib/airdrop";

interface Props {
  contractId: string;
}

/** The connected wallet's entry, pulled out of an uploaded proof set. */
interface Allocation {
  amount: bigint;
  proof: string[];
}

function parseProofSet(text: string): ProofSet {
  const parsed: unknown = JSON.parse(text);

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as ProofSet).root !== "string" ||
    !Array.isArray((parsed as ProofSet).entries)
  ) {
    throw new Error("Not a SoroPad airdrop proof file");
  }

  return parsed as ProofSet;
}

export function AirdropClaim({ contractId }: Props) {
  const t = useTranslations("airdrop");
  const toast = useToast();
  const { connected, publicKey, connect, signTransaction } = useWallet();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [info, setInfo] = useState<AirdropInfo | null>(null);
  const [decimals, setDecimals] = useState(7);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [proofSet, setProofSet] = useState<ProofSet | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [status, setStatus] = useState<ClaimStatus | null>(null);
  const [claiming, setClaiming] = useState(false);

  /* ── Load the airdrop from chain ─────────────────────────────────── */

  const loadInfo = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = await fetchAirdropInfo(contractId);
      setInfo(loaded);
      try {
        setDecimals(await fetchTokenDecimals(loaded.token));
      } catch {
        // Non-fatal: fall back to Stellar's conventional 7 decimals.
        setDecimals(7);
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : t("loadFailedMessage"),
      );
    } finally {
      setLoading(false);
    }
  }, [contractId, t]);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  /* ── Locate the connected wallet in the proof set ─────────────────── */

  const allocation: Allocation | null = useMemo(() => {
    if (!proofSet || !publicKey) return null;

    const entry = proofSet.entries.find(
      (e) => e.address.toUpperCase() === publicKey.toUpperCase(),
    );
    if (!entry) return null;

    try {
      return { amount: BigInt(entry.amount), proof: entry.proof };
    } catch {
      return null;
    }
  }, [proofSet, publicKey]);

  /**
   * The proof file is untrusted input, so check it against the root the
   * contract actually published before showing anyone an allocation.
   */
  const rootMismatch =
    proofSet !== null &&
    info !== null &&
    proofSet.root.toLowerCase() !== info.merkleRoot.toLowerCase();

  const locallyValid = useMemo(() => {
    if (!allocation || !publicKey || !info) return false;
    return verifyProof(
      publicKey,
      allocation.amount,
      allocation.proof,
      info.merkleRoot,
    );
  }, [allocation, publicKey, info]);

  /* ── Confirm against the contract ────────────────────────────────── */

  const refreshStatus = useCallback(async () => {
    if (!allocation || !publicKey) {
      setStatus(null);
      return;
    }
    try {
      setStatus(
        await fetchClaimStatus(
          contractId,
          publicKey,
          allocation.amount,
          allocation.proof,
        ),
      );
    } catch {
      setStatus(null);
    }
  }, [allocation, publicKey, contractId]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  /* ── Proof file input ────────────────────────────────────────────── */

  const handleFile = useCallback(
    async (file: File) => {
      setProofError(null);
      try {
        setProofSet(parseProofSet(await file.text()));
      } catch (err) {
        setProofSet(null);
        setProofError(
          err instanceof Error ? err.message : t("proofFileInvalid"),
        );
      }
    },
    [t],
  );

  /* ── Claim ───────────────────────────────────────────────────────── */

  const handleClaim = useCallback(async () => {
    if (!allocation || !publicKey) return;

    setClaiming(true);
    try {
      const xdr = await buildClaimTx(
        contractId,
        publicKey,
        allocation.amount,
        allocation.proof,
      );
      await submitTx(await signTransaction(xdr));

      toast.show({
        title: t("claimSuccess"),
        message: t("claimSuccessMessage", {
          amount: formatTokenAmount(allocation.amount, decimals),
        }),
        variant: "success",
      });

      await Promise.all([loadInfo(), refreshStatus()]);
    } catch (err) {
      toast.show({
        title: t("claimFailed"),
        message: err instanceof Error ? err.message : t("claimFailed"),
        variant: "error",
      });
    } finally {
      setClaiming(false);
    }
  }, [
    allocation,
    publicKey,
    contractId,
    signTransaction,
    toast,
    t,
    decimals,
    loadInfo,
    refreshStatus,
  ]);

  /* ── Render ──────────────────────────────────────────────────────── */

  if (loading) {
    return <p className="text-gray-400">{t("loading")}</p>;
  }

  if (loadError || !info) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t("loadFailed")}</AlertTitle>
        <AlertDescription>{loadError ?? t("loadFailedMessage")}</AlertDescription>
      </Alert>
    );
  }

  const ledgersLeft = info.deadlineLedger - info.currentLedger;
  const closed = ledgersLeft < 0 || info.isReclaimed;

  return (
    <div className="flex flex-col gap-8">
      {/* Airdrop summary */}
      <section className="rounded-2xl border border-stellar-500/10 bg-void-800/40 p-6">
        <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              {t("stillAvailable")}
            </dt>
            <dd className="text-lg font-semibold text-white">
              {formatTokenAmount(info.remainingBalance, decimals)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              {t("totalClaimed")}
            </dt>
            <dd className="text-lg font-semibold text-white">
              {formatTokenAmount(info.totalClaimed, decimals)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              {t("deadlineLedger")}
            </dt>
            <dd className="text-lg font-semibold text-white">
              {info.deadlineLedger}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              {t("timeLeft")}
            </dt>
            <dd className="text-lg font-semibold text-white">
              {closed
                ? t("closed")
                : ledgersToApproxDuration(ledgersLeft)}
            </dd>
          </div>
        </dl>
      </section>

      {info.isReclaimed && (
        <Alert variant="warning">
          <AlertTitle>{t("reclaimedTitle")}</AlertTitle>
          <AlertDescription>{t("reclaimedMessage")}</AlertDescription>
        </Alert>
      )}

      {!info.isReclaimed && ledgersLeft < 0 && (
        <Alert variant="warning">
          <AlertTitle>{t("deadlinePassedTitle")}</AlertTitle>
          <AlertDescription>{t("deadlinePassedMessage")}</AlertDescription>
        </Alert>
      )}

      {/* Claim */}
      <section className="rounded-2xl border border-stellar-500/10 bg-void-800/40 p-6">
        <h2 className="mb-1 text-lg font-semibold text-white">
          {t("yourAllocation")}
        </h2>
        <p className="mb-5 text-sm text-gray-400">{t("proofFileHint")}</p>

        {!connected ? (
          <Button type="button" onClick={() => void connect()}>
            {t("connectWallet")}
          </Button>
        ) : (
          <div className="flex flex-col gap-5">
            <div>
              <Button
                variant="secondary"
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp className="h-4 w-4" aria-hidden="true" />
                {t("uploadProofs")}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                aria-label={t("uploadProofs")}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                  e.target.value = "";
                }}
              />
            </div>

            {proofError && (
              <Alert variant="destructive">
                <AlertTitle>{t("proofFileInvalid")}</AlertTitle>
                <AlertDescription>{proofError}</AlertDescription>
              </Alert>
            )}

            {rootMismatch && (
              <Alert variant="destructive">
                <AlertTitle>{t("rootMismatchTitle")}</AlertTitle>
                <AlertDescription>{t("rootMismatchMessage")}</AlertDescription>
              </Alert>
            )}

            {proofSet && !rootMismatch && !allocation && (
              <Alert>
                <AlertTitle>{t("notEligibleTitle")}</AlertTitle>
                <AlertDescription>{t("notEligibleMessage")}</AlertDescription>
              </Alert>
            )}

            {allocation && !rootMismatch && (
              <>
                <dl className="grid grid-cols-2 gap-5">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-gray-500">
                      {t("yourAllocation")}
                    </dt>
                    <dd className="text-2xl font-semibold text-stellar-300">
                      {formatTokenAmount(allocation.amount, decimals)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-gray-500">
                      {t("claimStatus")}
                    </dt>
                    <dd className="text-2xl font-semibold text-white">
                      {status?.claimed ? t("claimed") : t("unclaimed")}
                    </dd>
                  </div>
                </dl>

                {!locallyValid && (
                  <Alert variant="destructive">
                    <AlertTitle>{t("proofRejectedTitle")}</AlertTitle>
                    <AlertDescription>
                      {t("proofRejectedMessage")}
                    </AlertDescription>
                  </Alert>
                )}

                {status && !status.eligible && locallyValid && (
                  <Alert variant="destructive">
                    <AlertTitle>{t("proofRejectedTitle")}</AlertTitle>
                    <AlertDescription>
                      {t("proofRejectedOnChainMessage")}
                    </AlertDescription>
                  </Alert>
                )}

                <Button
                  type="button"
                  onClick={() => void handleClaim()}
                  isLoading={claiming}
                  disabled={
                    closed ||
                    !locallyValid ||
                    status?.claimed === true ||
                    status?.eligible === false
                  }
                >
                  {status?.claimed
                    ? t("alreadyClaimed")
                    : t("claimTokens", {
                        amount: formatTokenAmount(allocation.amount, decimals),
                      })}
                </Button>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
