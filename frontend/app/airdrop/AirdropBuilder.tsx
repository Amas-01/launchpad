"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, FileUp, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";
import { CopyButton } from "@/components/ui/CopyButton";
import { useToast } from "@/app/providers/ToastProvider";
import { useWallet } from "@/app/hooks/useWallet";
import {
  buildProofSet,
  buildTree,
  parseAllocationsCsv,
  type CsvParseResult,
} from "@/lib/merkle";
import {
  CONTRACT_ID_RE,
  buildFundTx,
  buildInitializeTx,
  formatTokenAmount,
  submitTx,
} from "@/lib/airdrop";

/** How many parsed rows to show before collapsing the preview. */
const PREVIEW_ROWS = 8;

/** Cap on pasted/uploaded CSV size, to keep tree building responsive. */
const MAX_RECIPIENTS = 50_000;

interface BuiltTree {
  root: string;
  count: number;
  total: bigint;
  json: string;
}

export function AirdropBuilder() {
  const t = useTranslations("airdrop");
  const toast = useToast();
  const { connected, publicKey, connect, signTransaction } = useWallet();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [csv, setCsv] = useState("");
  const [decimals, setDecimals] = useState("7");
  const [built, setBuilt] = useState<BuiltTree | null>(null);

  // Publish step
  const [contractId, setContractId] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [funding, setFunding] = useState(false);

  const decimalsValue = useMemo(() => {
    const n = Number(decimals);
    return Number.isInteger(n) && n >= 0 && n <= 18 ? n : null;
  }, [decimals]);

  /** Re-parsed on every keystroke so errors surface before building. */
  const parsed: CsvParseResult | null = useMemo(() => {
    if (csv.trim() === "" || decimalsValue === null) return null;
    return parseAllocationsCsv(csv, decimalsValue);
  }, [csv, decimalsValue]);

  const tooManyRows =
    parsed !== null && parsed.allocations.length > MAX_RECIPIENTS;

  const canBuild =
    parsed !== null &&
    parsed.allocations.length > 0 &&
    parsed.errors.length === 0 &&
    !tooManyRows;

  /* ── CSV input ───────────────────────────────────────────────────── */

  const handleFile = useCallback(
    async (file: File) => {
      try {
        setCsv(await file.text());
        setBuilt(null);
      } catch {
        toast.show({
          title: t("fileReadFailed"),
          message: t("fileReadFailedMessage"),
          variant: "error",
        });
      }
    },
    [toast, t],
  );

  /* ── Build ───────────────────────────────────────────────────────── */

  const handleBuild = useCallback(() => {
    if (!parsed || !canBuild) return;

    try {
      const tree = buildTree(parsed.allocations);
      const proofSet = buildProofSet(tree);

      setBuilt({
        root: tree.root,
        count: parsed.allocations.length,
        total: parsed.total,
        json: JSON.stringify(proofSet, null, 2),
      });
    } catch (err) {
      toast.show({
        title: t("buildFailed"),
        message: err instanceof Error ? err.message : t("buildFailed"),
        variant: "error",
      });
    }
  }, [parsed, canBuild, toast, t]);

  const handleDownload = useCallback(() => {
    if (!built) return;

    const blob = new Blob([built.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `airdrop-proofs-${built.root.slice(0, 8)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [built]);

  /* ── Publish ─────────────────────────────────────────────────────── */

  const handlePublish = useCallback(async () => {
    if (!built || !publicKey) return;

    const airdropId = contractId.trim().toUpperCase();
    const token = tokenId.trim().toUpperCase();
    const deadlineLedger = Number(deadline);

    if (!CONTRACT_ID_RE.test(airdropId) || !CONTRACT_ID_RE.test(token)) {
      toast.show({
        title: t("invalidContractId"),
        message: t("invalidContractIdMessage"),
        variant: "error",
      });
      return;
    }
    if (!Number.isInteger(deadlineLedger) || deadlineLedger <= 0) {
      toast.show({
        title: t("invalidDeadline"),
        message: t("invalidDeadlineMessage"),
        variant: "error",
      });
      return;
    }

    setPublishing(true);
    try {
      const xdr = await buildInitializeTx(
        airdropId,
        token,
        publicKey,
        built.root,
        deadlineLedger,
      );
      await submitTx(await signTransaction(xdr));
      toast.show({
        title: t("publishSuccess"),
        message: t("publishSuccessMessage"),
        variant: "success",
      });
    } catch (err) {
      toast.show({
        title: t("publishFailed"),
        message: err instanceof Error ? err.message : t("publishFailed"),
        variant: "error",
      });
    } finally {
      setPublishing(false);
    }
  }, [built, publicKey, contractId, tokenId, deadline, signTransaction, toast, t]);

  const handleFund = useCallback(async () => {
    if (!built || !publicKey) return;

    const airdropId = contractId.trim().toUpperCase();
    if (!CONTRACT_ID_RE.test(airdropId)) {
      toast.show({
        title: t("invalidContractId"),
        message: t("invalidContractIdMessage"),
        variant: "error",
      });
      return;
    }

    setFunding(true);
    try {
      const xdr = await buildFundTx(airdropId, publicKey, built.total);
      await submitTx(await signTransaction(xdr));
      toast.show({
        title: t("fundSuccess"),
        message: t("fundSuccessMessage"),
        variant: "success",
      });
    } catch (err) {
      toast.show({
        title: t("fundFailed"),
        message: err instanceof Error ? err.message : t("fundFailed"),
        variant: "error",
      });
    } finally {
      setFunding(false);
    }
  }, [built, publicKey, contractId, signTransaction, toast, t]);

  /* ── Render ──────────────────────────────────────────────────────── */

  return (
    <div className="flex flex-col gap-8">
      {/* Step 1 — allocations */}
      <section className="rounded-2xl border border-stellar-500/10 bg-void-800/40 p-6">
        <h2 className="mb-1 text-lg font-semibold text-white">
          {t("step1Title")}
        </h2>
        <p className="mb-5 text-sm text-gray-400">{t("step1Description")}</p>

        <div className="mb-4 flex flex-wrap items-end gap-4">
          <Input
            label={t("decimalsLabel")}
            name="decimals"
            type="number"
            min={0}
            max={18}
            value={decimals}
            onChange={(e) => {
              setDecimals(e.target.value);
              setBuilt(null);
            }}
            className="max-w-40"
          />
          <Button
            variant="secondary"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp className="h-4 w-4" aria-hidden="true" />
            {t("uploadCsv")}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            aria-label={t("uploadCsv")}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
        </div>

        <label htmlFor="allocations" className="mb-1.5 ml-1 block text-sm font-medium text-gray-300">
          {t("csvLabel")}
        </label>
        <textarea
          id="allocations"
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setBuilt(null);
          }}
          rows={10}
          spellCheck={false}
          placeholder={t("csvPlaceholder")}
          className="w-full rounded-xl border border-stellar-500/10 bg-void-800/50 px-4 py-3 font-mono text-xs text-white placeholder:text-gray-500 focus:border-stellar-500/40 focus:outline-none focus:ring-1 focus:ring-stellar-500/20"
        />

        {decimalsValue === null && (
          <p className="mt-2 text-xs text-red-400">{t("invalidDecimals")}</p>
        )}

        {parsed && (
          <div className="mt-5 flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">
                  {t("recipients")}
                </dt>
                <dd className="text-lg font-semibold text-white">
                  {parsed.allocations.length}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">
                  {t("totalAllocated")}
                </dt>
                <dd className="text-lg font-semibold text-white">
                  {formatTokenAmount(parsed.total, decimalsValue ?? 7)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">
                  {t("rejectedRows")}
                </dt>
                <dd
                  className={`text-lg font-semibold ${parsed.errors.length > 0 ? "text-red-400" : "text-white"}`}
                >
                  {parsed.errors.length}
                </dd>
              </div>
            </dl>

            {tooManyRows && (
              <Alert variant="destructive">
                <AlertTitle>{t("tooManyRecipients")}</AlertTitle>
                <AlertDescription>
                  {t("tooManyRecipientsMessage", { max: MAX_RECIPIENTS })}
                </AlertDescription>
              </Alert>
            )}

            {parsed.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>
                  <span className="inline-flex items-center gap-2">
                    <TriangleAlert className="h-4 w-4" aria-hidden="true" />
                    {t("fixRowsFirst")}
                  </span>
                </AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-xs">
                    {parsed.errors.slice(0, 50).map((err) => (
                      <li key={err}>{err}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {parsed.allocations.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-white/5">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/5 text-gray-400">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-medium">
                        {t("address")}
                      </th>
                      <th scope="col" className="px-4 py-2 text-right font-medium">
                        {t("amount")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-gray-300">
                    {parsed.allocations.slice(0, PREVIEW_ROWS).map((a) => (
                      <tr key={a.address} className="border-t border-white/5">
                        <td className="px-4 py-2">{a.address}</td>
                        <td className="px-4 py-2 text-right">
                          {formatTokenAmount(a.amount, decimalsValue ?? 7)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.allocations.length > PREVIEW_ROWS && (
                  <p className="border-t border-white/5 px-4 py-2 text-xs text-gray-500">
                    {t("andMore", {
                      count: parsed.allocations.length - PREVIEW_ROWS,
                    })}
                  </p>
                )}
              </div>
            )}

            <Button type="button" onClick={handleBuild} disabled={!canBuild}>
              {t("buildTree")}
            </Button>
          </div>
        )}
      </section>

      {/* Step 2 — root + proof export */}
      {built && (
        <section className="rounded-2xl border border-stellar-500/10 bg-void-800/40 p-6">
          <h2 className="mb-1 text-lg font-semibold text-white">
            {t("step2Title")}
          </h2>
          <p className="mb-5 text-sm text-gray-400">{t("step2Description")}</p>

          <div className="mb-5">
            <span className="mb-1.5 ml-1 block text-sm font-medium text-gray-300">
              {t("merkleRoot")}
            </span>
            <div className="flex items-center gap-2 rounded-xl border border-stellar-500/10 bg-void-800/50 px-4 py-3">
              <code className="flex-1 break-all font-mono text-xs text-stellar-300">
                {built.root}
              </code>
              <CopyButton value={built.root} label={t("copyRoot")} />
            </div>
          </div>

          <Alert variant="warning" className="mb-5">
            <AlertTitle>{t("keepProofsTitle")}</AlertTitle>
            <AlertDescription>{t("keepProofsMessage")}</AlertDescription>
          </Alert>

          <Button variant="secondary" type="button" onClick={handleDownload}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {t("downloadProofs", { count: built.count })}
          </Button>
        </section>
      )}

      {/* Step 3 — publish on chain */}
      {built && (
        <section className="rounded-2xl border border-stellar-500/10 bg-void-800/40 p-6">
          <h2 className="mb-1 text-lg font-semibold text-white">
            {t("step3Title")}
          </h2>
          <p className="mb-5 text-sm text-gray-400">{t("step3Description")}</p>

          {!connected ? (
            <Button type="button" onClick={() => void connect()}>
              {t("connectWallet")}
            </Button>
          ) : (
            <div className="flex flex-col gap-4">
              <Input
                label={t("airdropContractId")}
                name="airdropContractId"
                value={contractId}
                onChange={(e) => setContractId(e.target.value)}
                placeholder={t("contractIdPlaceholder")}
                spellCheck={false}
              />
              <Input
                label={t("tokenContractId")}
                name="tokenContractId"
                value={tokenId}
                onChange={(e) => setTokenId(e.target.value)}
                placeholder={t("contractIdPlaceholder")}
                spellCheck={false}
              />
              <Input
                label={t("deadlineLedgerLabel")}
                name="deadlineLedger"
                type="number"
                min={1}
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                placeholder={t("deadlineLedgerPlaceholder")}
              />

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  onClick={() => void handlePublish()}
                  isLoading={publishing}
                >
                  {t("publishRoot")}
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => void handleFund()}
                  isLoading={funding}
                >
                  {t("fundAirdrop", {
                    amount: formatTokenAmount(built.total, decimalsValue ?? 7),
                  })}
                </Button>
              </div>

              <p className="text-xs text-gray-500">{t("publishHint")}</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
