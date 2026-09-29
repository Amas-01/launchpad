"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Clock, Coins, Lock, Pause, Play, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";
import { ConfirmPanel } from "@/app/dashboard/[contractId]/components/admin/ConfirmPanel";
import { useToast } from "@/app/providers/ToastProvider";
import { useWallet } from "@/app/hooks/useWallet";
import { parseTokenAmount, truncateAddress } from "@/lib/stellar";
import {
  AirdropErrorCode,
  airdropErrorCode,
  buildAcceptAdminTx,
  buildCancelAdminProposalTx,
  buildExtendDeadlineTx,
  buildFundTx,
  buildPauseTx,
  buildProposeAdminTx,
  buildReclaimTx,
  buildRevokeAdminTx,
  buildUnpauseTx,
  formatTokenAmount,
  isAirdropClosedError,
  submitTx,
  type AirdropInfo,
} from "@/lib/airdrop";

/** The word an operator must type to revoke the admin role for good. */
const REVOKE_PHRASE = "REVOKE";

/** A standalone block inside the panel, matching the claim page's sections. */
function PanelCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-white/5 bg-void-800/40 p-4">
      <div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-gray-400">
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

interface Props {
  contractId: string;
  /** The airdrop as the claim page already loaded it. */
  info: AirdropInfo;
  decimals: number;
  /**
   * Called after a successful admin transaction so the caller can reload the
   * airdrop. The panel renders from `info`, so the reload is what updates it.
   */
  onChanged: () => void;
}

/**
 * Everything only the airdrop admin (or the wallet being handed the role) can
 * do: top the treasury up, push the deadline out, sweep what nobody claimed,
 * halt the contract, hand the role over, and lock it for good.
 *
 * Renders nothing for anyone else — a recipient's claim page stays exactly as
 * it was. The panel deliberately leans on `lib/airdrop`'s plain transaction
 * builders rather than the dashboard's generated bindings: no airdrop
 * bindings exist, and the two share nothing but the wallet and toast hooks.
 */
export function AirdropAdminPanel({
  contractId,
  info,
  decimals,
  onChanged,
}: Props) {
  const t = useTranslations("airdrop");
  const toast = useToast();
  const { connected, publicKey, signTransaction } = useWallet();

  const [busy, setBusy] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [newDeadline, setNewDeadline] = useState("");
  const [newAdmin, setNewAdmin] = useState("");
  const [newAdminError, setNewAdminError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<null | "sweep" | "revoke">(
    null,
  );
  const [revokePhrase, setRevokePhrase] = useState("");

  const isAdmin = !!publicKey && info.admin === publicKey;
  const isPendingAdmin = !!publicKey && info.pendingAdmin === publicKey;
  const deadlinePassed = info.deadlineLedger <= info.currentLedger;

  /**
   * Name an airdrop error when the number can only be the airdrop's.
   *
   * Soroban prints `Error(Contract, #n)` with no contract attached, so this
   * is only handed to actions that invoke nothing else. `fund` and
   * `reclaim_unclaimed` also touch the token and keep their raw message.
   */
  const explainAirdropError = useCallback(
    (err: unknown): string | null => {
      switch (airdropErrorCode(err)) {
        case AirdropErrorCode.Locked:
          return t("adminErrLocked");
        case AirdropErrorCode.Paused:
          return t("adminErrPaused");
        case AirdropErrorCode.InvalidDeadline:
          return t("adminErrInvalidDeadline");
        case AirdropErrorCode.DeadlineTooFar:
          return t("adminErrDeadlineTooFar");
        case AirdropErrorCode.AlreadyReclaimed:
          return t("adminErrReclaimed");
        case AirdropErrorCode.ProposalExpired:
          return t("adminErrProposalExpired");
        case AirdropErrorCode.NoPendingAdmin:
          return t("adminErrNoPendingAdmin");
        case AirdropErrorCode.InvalidAdmin:
          return t("adminErrInvalidAdmin");
        default:
          return null;
      }
    },
    [t],
  );

  /**
   * One transaction's worth of: build → sign → submit → toast → reload.
   *
   * Every action below is the same five steps with different copy, so the
   * sequence lives here once. Resolves `true` only on success, so callers
   * that opened a confirmation panel can close it either way without
   * leaving the operator staring at a stale form.
   *
   * `actionTitle` names the action both toasts are about, so the failure
   * reads "Sweep unclaimed tokens failed" rather than quoting a contract
   * error number with no subject.
   */
  const run = useCallback(
    async (
      key: string,
      build: () => Promise<string>,
      success: { title: string; message?: string },
      actionTitle: string,
      explain: boolean,
    ): Promise<boolean> => {
      if (!publicKey) return false;
      setBusy(key);
      try {
        const xdr = await build();
        await submitTx(await signTransaction(xdr));
        toast.show({
          title: success.title,
          message: success.message,
          variant: "success",
        });
        onChanged();
        return true;
      } catch (err) {
        toast.show({
          title: t("adminActionFailedTitle", { action: actionTitle }),
          message:
            (explain ? explainAirdropError(err) : null) ??
            // A swept-closed airdrop refuses `fund` with a bare `#9`; name it
            // rather than handing the operator a number to look up.
            (isAirdropClosedError(err)
              ? t("fundClosedMessage")
              : err instanceof Error
                ? err.message
                : t("adminActionFailed")),
          variant: "error",
        });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [publicKey, signTransaction, toast, onChanged, explainAirdropError, t],
  );

  /* ── Actions ─────────────────────────────────────────────────────── */

  const handleFund = useCallback(async () => {
    if (!publicKey) return;
    let raw: bigint;
    try {
      raw = parseTokenAmount(amount, decimals);
      if (raw <= 0n) throw new Error("zero");
      setAmountError(null);
    } catch {
      setAmountError(t("adminInvalidAmount"));
      return;
    }
    const shown = formatTokenAmount(raw, decimals);
    const ok = await run(
      "fund",
      () => buildFundTx(contractId, publicKey, raw),
      {
        title: t("adminFundSuccess"),
        message: t("adminFundSuccessMessage", { amount: shown }),
      },
      t("adminFundTitle"),
      false,
    );
    if (ok) setAmount("");
  }, [publicKey, amount, decimals, run, contractId, t]);

  const handleExtend = useCallback(async () => {
    if (!publicKey) return;
    const ledger = Number(newDeadline);
    if (
      !Number.isInteger(ledger) ||
      ledger <= info.currentLedger ||
      ledger <= info.deadlineLedger
    ) {
      toast.show({
        title: t("adminExtendTitle"),
        message: t("adminExtendInvalid", { deadline: info.deadlineLedger }),
        variant: "error",
      });
      return;
    }
    await run(
      "extend",
      () => buildExtendDeadlineTx(contractId, publicKey, ledger),
      {
        title: t("adminExtendSuccess"),
        message: t("adminExtendSuccessMessage", { ledger }),
      },
      t("adminExtendTitle"),
      true,
    );
  }, [publicKey, newDeadline, info, run, contractId, toast, t]);

  const handleSweep = useCallback(async () => {
    if (!publicKey) return;
    const remaining = info.remainingBalance;
    const ok = await run(
      "sweep",
      () => buildReclaimTx(contractId, publicKey),
      {
        title: t("adminSweepSuccess"),
        message: t("adminSweepSuccessMessage", {
          amount: formatTokenAmount(remaining, decimals),
        }),
      },
      t("adminSweepTitle"),
      false,
    );
    if (ok) setConfirming(null);
  }, [publicKey, info.remainingBalance, decimals, run, contractId, t]);

  const handlePauseToggle = useCallback(() => {
    if (!publicKey) return;
    const pausing = !info.isPaused;
    void run(
      "pause",
      () =>
        pausing
          ? buildPauseTx(contractId, publicKey)
          : buildUnpauseTx(contractId, publicKey),
      pausing
        ? {
            title: t("adminPausedSuccess"),
            message: t("adminPausedSuccessMessage"),
          }
        : {
            title: t("adminUnpausedSuccess"),
            message: t("adminUnpausedSuccessMessage"),
          },
      t("adminPauseTitle"),
      true,
    );
  }, [publicKey, info.isPaused, run, contractId, t]);

  const handlePropose = useCallback(async () => {
    if (!publicKey) return;
    const candidate = newAdmin.trim().toUpperCase();
    if (!/^G[A-Z2-7]{55}$/.test(candidate)) {
      setNewAdminError(t("adminInvalidAddress"));
      return;
    }
    setNewAdminError(null);
    const ok = await run(
      "propose",
      () => buildProposeAdminTx(contractId, publicKey, candidate),
      {
        title: t("adminTransferSuccess"),
        message: t("adminTransferSuccessMessage", {
          address: truncateAddress(candidate),
        }),
      },
      t("adminTransferTitle"),
      true,
    );
    if (ok) setNewAdmin("");
  }, [publicKey, newAdmin, run, contractId, t]);

  const handleAccept = useCallback(() => {
    if (!publicKey) return;
    void run(
      "accept",
      () => buildAcceptAdminTx(contractId, publicKey),
      {
        title: t("adminAcceptSuccess"),
        message: t("adminAcceptSuccessMessage"),
      },
      t("adminTransferTitle"),
      true,
    );
  }, [publicKey, run, contractId, t]);

  const handleCancelProposal = useCallback(() => {
    if (!publicKey) return;
    void run(
      "cancel",
      () => buildCancelAdminProposalTx(contractId, publicKey),
      {
        title: t("adminCancelSuccess"),
        message: t("adminCancelSuccessMessage"),
      },
      t("adminTransferTitle"),
      true,
    );
  }, [publicKey, run, contractId, t]);

  const handleRevoke = useCallback(async () => {
    if (!publicKey || revokePhrase.trim() !== REVOKE_PHRASE) return;
    const ok = await run(
      "revoke",
      () => buildRevokeAdminTx(contractId, publicKey),
      {
        title: t("adminRevokeSuccess"),
        message: t("adminRevokeSuccessMessage"),
      },
      t("adminRevokeTitle"),
      true,
    );
    if (ok) {
      setConfirming(null);
      setRevokePhrase("");
    }
  }, [publicKey, revokePhrase, run, contractId, t]);

  /* ── Render ──────────────────────────────────────────────────────── */

  if (!connected || (!isAdmin && !isPendingAdmin)) return null;

  const anyoneBusy = busy !== null;
  const remainingLabel = formatTokenAmount(info.remainingBalance, decimals);

  return (
    <section
      className="flex flex-col gap-5 rounded-2xl border border-stellar-500/10 bg-void-800/40 p-6"
      aria-label={t("adminTitle")}
    >
      <div>
        <h2 className="text-lg font-semibold text-white">{t("adminTitle")}</h2>
        <p className="mt-1 text-sm text-gray-400">{t("adminDescription")}</p>
      </div>

      {info.isLocked && (
        <Alert variant="warning">
          <AlertTitle>{t("adminLockedTitle")}</AlertTitle>
          <AlertDescription>{t("adminLockedMessage")}</AlertDescription>
        </Alert>
      )}

      {info.isPaused && (
        <Alert variant="warning">
          <AlertTitle>{t("adminPausedTitle")}</AlertTitle>
          <AlertDescription>{t("adminPausedMessage")}</AlertDescription>
        </Alert>
      )}

      {info.pendingAdmin && (
        <Alert variant="default">
          <AlertTitle>{t("adminPendingTitle")}</AlertTitle>
          <AlertDescription>
            {t("adminPendingMessage", {
              address: truncateAddress(info.pendingAdmin),
            })}
          </AlertDescription>
        </Alert>
      )}

      {info.isReclaimed && (
        <Alert variant="default">
          <AlertTitle>{t("adminSweepDoneTitle")}</AlertTitle>
          <AlertDescription>{t("adminSweepDoneMessage")}</AlertDescription>
        </Alert>
      )}

      {isAdmin && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Top up */}
          <PanelCard
            title={t("adminFundTitle")}
            description={t("adminFundDescription")}
          >
            <Input
              label={t("adminFundAmountLabel")}
              name="adminFundAmount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setAmountError(null);
              }}
              placeholder={t("adminFundPlaceholder")}
              error={amountError ?? undefined}
              disabled={anyoneBusy}
            />
            <p className="text-xs text-gray-500">
              {t("adminFundRemaining", { amount: remainingLabel })}
            </p>
            <Button
              type="button"
              onClick={() => void handleFund()}
              isLoading={busy === "fund"}
              disabled={
                anyoneBusy || info.isPaused || info.isLocked || info.isReclaimed
              }
            >
              <Coins className="h-4 w-4" aria-hidden="true" />
              {t("adminFundButton")}
            </Button>
          </PanelCard>

          {/* Extend the claim window */}
          <PanelCard
            title={t("adminExtendTitle")}
            description={t("adminExtendDescription")}
          >
            <Input
              label={t("adminExtendLabel")}
              name="adminExtendDeadline"
              type="number"
              min={1}
              value={newDeadline}
              onChange={(e) => setNewDeadline(e.target.value)}
              placeholder={t("adminExtendPlaceholder")}
              disabled={anyoneBusy}
            />
            <p className="text-xs text-gray-500">
              {t("adminExtendCurrent", { deadline: info.deadlineLedger })}
            </p>
            <Button
              type="button"
              onClick={() => void handleExtend()}
              isLoading={busy === "extend"}
              disabled={anyoneBusy || info.isLocked}
            >
              <Clock className="h-4 w-4" aria-hidden="true" />
              {t("adminExtendButton")}
            </Button>
          </PanelCard>

          {/* Sweep what nobody claimed */}
          <PanelCard
            title={t("adminSweepTitle")}
            description={t("adminSweepDescription")}
          >
            {info.isReclaimed ? (
              <p className="text-xs text-gray-500">{t("adminSweepDoneTitle")}</p>
            ) : deadlinePassed ? (
              confirming === "sweep" ? (
                <ConfirmPanel
                  accent="red"
                  title={t("adminSweepConfirmTitle")}
                  message={t("adminSweepConfirmMessage", {
                    amount: remainingLabel,
                  })}
                  confirmLabel={t("adminSweepButton")}
                  isLoading={busy === "sweep"}
                  onCancel={() => setConfirming(null)}
                  onConfirm={() => void handleSweep()}
                />
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  className="border-red-500/20 text-red-400 hover:border-red-500/40"
                  onClick={() => setConfirming("sweep")}
                  disabled={anyoneBusy || info.isLocked}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {t("adminSweepButton")}
                </Button>
              )
            ) : (
              <p className="text-xs text-gray-500">{t("adminSweepBlocked")}</p>
            )}
          </PanelCard>

          {/* Halt everything */}
          <PanelCard
            title={t("adminPauseTitle")}
            description={t("adminPauseDescription")}
          >
            <Button
              type="button"
              variant="secondary"
              onClick={handlePauseToggle}
              isLoading={busy === "pause"}
              disabled={anyoneBusy || info.isLocked}
            >
              {info.isPaused ? (
                <Play className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Pause className="h-4 w-4" aria-hidden="true" />
              )}
              {info.isPaused
                ? t("adminUnpauseButton")
                : t("adminPauseButton")}
            </Button>
          </PanelCard>

          {/* Hand the role over */}
          <PanelCard
            title={t("adminTransferTitle")}
            description={t("adminTransferDescription")}
          >
            <Input
              label={t("adminTransferLabel")}
              name="adminTransferAddress"
              value={newAdmin}
              onChange={(e) => {
                setNewAdmin(e.target.value);
                setNewAdminError(null);
              }}
              placeholder={t("adminTransferPlaceholder")}
              spellCheck={false}
              error={newAdminError ?? undefined}
              disabled={anyoneBusy}
            />
            <Button
              type="button"
              onClick={() => void handlePropose()}
              isLoading={busy === "propose"}
              disabled={anyoneBusy || info.isLocked}
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              {t("adminTransferButton")}
            </Button>
            {!info.pendingAdmin ? (
              <p className="text-xs text-gray-500">{t("adminTransferNone")}</p>
            ) : (
              <Button
                type="button"
                variant="secondary"
                onClick={() => void handleCancelProposal()}
                isLoading={busy === "cancel"}
                disabled={anyoneBusy}
              >
                {t("adminCancelButton")}
              </Button>
            )}
          </PanelCard>

          {/* Lock it for good */}
          <PanelCard
            title={t("adminRevokeTitle")}
            description={t("adminRevokeDescription")}
          >
            {info.isLocked ? (
              <p className="text-xs text-gray-500">{t("adminLockedTitle")}</p>
            ) : confirming === "revoke" ? (
              <ConfirmPanel
                accent="red"
                title={t("adminRevokeConfirmTitle")}
                message={t("adminRevokeConfirmMessage", {
                  phrase: REVOKE_PHRASE,
                })}
                confirmLabel={t("adminRevokeConfirmButton")}
                isLoading={busy === "revoke"}
                confirmDisabled={revokePhrase.trim() !== REVOKE_PHRASE}
                onCancel={() => {
                  setConfirming(null);
                  setRevokePhrase("");
                }}
                onConfirm={() => void handleRevoke()}
              >
                <Input
                  name="adminRevokePhrase"
                  value={revokePhrase}
                  onChange={(e) => setRevokePhrase(e.target.value)}
                  placeholder={REVOKE_PHRASE}
                  aria-label={t("adminRevokePhraseLabel")}
                  disabled={busy === "revoke"}
                  className="bg-white/5 border-white/10"
                />
              </ConfirmPanel>
            ) : (
              <>
                <Alert variant="warning">
                  <AlertTitle>{t("adminRevokeWarnTitle")}</AlertTitle>
                  <AlertDescription>
                    {t("adminRevokeWarnMessage", { amount: remainingLabel })}
                  </AlertDescription>
                </Alert>
                <Button
                  type="button"
                  variant="secondary"
                  className="border-red-500/20 text-red-400 hover:border-red-500/40"
                  onClick={() => setConfirming("revoke")}
                  disabled={anyoneBusy}
                >
                  <Lock className="h-4 w-4" aria-hidden="true" />
                  {t("adminRevokeButton")}
                </Button>
              </>
            )}
          </PanelCard>
        </div>
      )}

      {isPendingAdmin && !isAdmin && (
        <div className="rounded-xl border border-stellar-500/20 bg-stellar-950/20 p-4">
          <p className="mb-3 text-sm text-stellar-200">
            {t("adminAcceptPrompt")}
          </p>
          <Button
            type="button"
            onClick={() => void handleAccept()}
            isLoading={busy === "accept"}
            disabled={anyoneBusy || info.isLocked || info.isPaused}
          >
            {t("adminAcceptButton")}
          </Button>
        </div>
      )}
    </section>
  );
}
