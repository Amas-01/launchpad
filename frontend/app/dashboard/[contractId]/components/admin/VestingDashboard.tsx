"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Loader2,
  AlertCircle,
  Download,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { AdminCard } from "./AdminCard";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { fromBaseUnits } from "@/lib/utils";
import {
  useVestingDashboard,
  type RecipientRow,
  type ScheduleStatus,
  type UnlockProjectionPoint,
  type VestingDashboardSummary,
} from "../../hooks/useVestingDashboard";
import { formatTokenAmount } from "@/lib/vesting";
import type { ContractReadFn } from "../../hooks/useContractRead";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VestingDashboardProps {
  /** Optional pre-populated vesting contract address (e.g. from the VestingCard input). */
  vestingContractId?: string;
  /** The token contract — used for the solvency check. */
  tokenContractId: string;
  decimals: number;
  read: ContractReadFn;
}

// ---------------------------------------------------------------------------
// Status chip
// ---------------------------------------------------------------------------

const STATUS_META: Record<
  ScheduleStatus,
  { label: string; className: string; icon: React.ReactNode }
> = {
  cliff_pending: {
    label: "Cliff pending",
    className: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    icon: <Clock className="h-3 w-3" />,
  },
  vesting: {
    label: "Vesting",
    className: "bg-stellar-500/10 text-stellar-400 border-stellar-500/20",
    icon: <TrendingUp className="h-3 w-3" />,
  },
  fully_vested: {
    label: "Fully vested",
    className: "bg-green-500/10 text-green-400 border-green-500/20",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  revoked: {
    label: "Revoked",
    className: "bg-red-500/10 text-red-400 border-red-500/20",
    icon: <XCircle className="h-3 w-3" />,
  },
};

function StatusChip({ status }: { status: ScheduleStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${meta.className}`}
    >
      {meta.icon}
      {meta.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Solvency badge
// ---------------------------------------------------------------------------

function SolvencyBadge({ solvent }: { solvent: boolean | null }) {
  if (solvent === null) return null;
  return solvent ? (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-semibold text-green-400">
      <CheckCircle2 className="h-3.5 w-3.5" />
      Solvent
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-400">
      <AlertTriangle className="h-3.5 w-3.5" />
      Underfunded
    </span>
  );
}

// ---------------------------------------------------------------------------
// Summary strip
// ---------------------------------------------------------------------------

function SummaryStrip({
  summary,
  decimals,
  symbol,
}: {
  summary: VestingDashboardSummary;
  decimals: number;
  symbol?: string;
}) {
  const fmt = (v: bigint) => formatTokenAmount(v, decimals);
  const tick = symbol ? ` ${symbol}` : "";

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="glass-card p-3">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
          Total committed
        </p>
        <p className="mt-1 truncate text-base font-semibold text-white">
          {fmt(summary.totalCommitted)}
          {tick}
        </p>
      </div>
      <div className="glass-card p-3">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
          Total vested
        </p>
        <p className="mt-1 truncate text-base font-semibold text-stellar-400">
          {fmt(summary.totalVested)}
          {tick}
        </p>
      </div>
      <div className="glass-card p-3">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
          Total released
        </p>
        <p className="mt-1 truncate text-base font-semibold text-green-400">
          {fmt(summary.totalReleased)}
          {tick}
        </p>
      </div>
      <div className="glass-card p-3">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
          Remaining
        </p>
        <p className="mt-1 truncate text-base font-semibold text-white">
          {fmt(summary.totalRemaining)}
          {tick}
        </p>
        {summary.solvent !== null && (
          <div className="mt-2">
            <SolvencyBadge solvent={summary.solvent} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unlock projection chart
// ---------------------------------------------------------------------------

function ProjectionChart({
  projection,
  decimals,
}: {
  projection: UnlockProjectionPoint[];
  decimals: number;
}) {
  const data = projection.map((p) => ({
    label: p.label,
    amount: parseFloat(fromBaseUnits(p.amount, decimals)),
  }));

  const hasData = data.some((d) => d.amount > 0);

  if (!hasData) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-gray-500">
        No projected unlocks in the next 12 months.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="vestGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#2D7DFF" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#2D7DFF" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis
          dataKey="label"
          tick={{ fill: "#9ca3af", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fill: "#9ca3af", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={60}
          tickFormatter={(v: number) =>
            v >= 1_000_000
              ? `${(v / 1_000_000).toFixed(1)}M`
              : v >= 1_000
                ? `${(v / 1_000).toFixed(1)}K`
                : String(v)
          }
        />
        <Tooltip
          contentStyle={{
            background: "#0d0d1a",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "8px",
            color: "#fff",
            fontSize: "12px",
          }}
          formatter={(v: number) => [v.toLocaleString(), "Unlocks"]}
        />
        <Area
          type="monotone"
          dataKey="amount"
          stroke="#2D7DFF"
          strokeWidth={2}
          fill="url(#vestGrad)"
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Sortable table
// ---------------------------------------------------------------------------

type SortField =
  | "address"
  | "trancheCount"
  | "totalAmount"
  | "vested"
  | "released"
  | "remaining"
  | "nextUnlockDate"
  | "status";
type SortDir = "asc" | "desc";

const ITEMS_PER_PAGE = 10;

function SortIcon({
  field,
  active,
  dir,
}: {
  field: SortField;
  active: SortField;
  dir: SortDir;
}) {
  if (field !== active)
    return <ChevronUp className="h-3 w-3 text-gray-600" />;
  return dir === "asc" ? (
    <ChevronUp className="h-3 w-3 text-stellar-400" />
  ) : (
    <ChevronDown className="h-3 w-3 text-stellar-400" />
  );
}

// Module-level sortable header cell so it is NOT re-created on every render
// (react-hooks/static-components). Receives what it needs via props.
function SortableTh({
  field,
  children,
  className = "",
  active,
  dir,
  onSort,
}: {
  field: SortField;
  children: React.ReactNode;
  className?: string;
  active: SortField;
  dir: SortDir;
  onSort: (field: SortField) => void;
}) {
  return (
    <th
      className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-300 ${className}`}
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <SortIcon field={field} active={active} dir={dir} />
      </span>
    </th>
  );
}

function VestingTable({
  rows,
  decimals,
  symbol,
}: {
  rows: RecipientRow[];
  decimals: number;
  symbol?: string;
}) {
  const [sortField, setSortField] = useState<SortField>("totalAmount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const fmt = (v: bigint) => formatTokenAmount(v, decimals);
  const tick = symbol ? ` ${symbol}` : "";

  const toggleSort = (f: SortField) => {
    if (f === sortField) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(f); setSortDir("desc"); }
    setPage(1);
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) => r.address.toLowerCase().includes(q));
  }, [rows, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "address":
          cmp = a.address.localeCompare(b.address);
          break;
        case "trancheCount":
          cmp = a.trancheCount - b.trancheCount;
          break;
        case "totalAmount":
          cmp = a.totalAmount < b.totalAmount ? -1 : a.totalAmount > b.totalAmount ? 1 : 0;
          break;
        case "vested":
          cmp = a.vested < b.vested ? -1 : a.vested > b.vested ? 1 : 0;
          break;
        case "released":
          cmp = a.released < b.released ? -1 : a.released > b.released ? 1 : 0;
          break;
        case "remaining":
          cmp = a.remaining < b.remaining ? -1 : a.remaining > b.remaining ? 1 : 0;
          break;
        case "nextUnlockDate":
          cmp =
            (a.nextUnlockDate?.getTime() ?? Infinity) -
            (b.nextUnlockDate?.getTime() ?? Infinity);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / ITEMS_PER_PAGE));
  const paginated = sorted.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE,
  );

  return (
    <div className="space-y-3">
      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        placeholder="Filter by address…"
        className="w-full rounded-lg border border-white/10 bg-void-800 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-stellar-500 focus:ring-1 focus:ring-stellar-500"
      />

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-white/5">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-white/5 bg-white/2">
            <tr>
              <SortableTh field="address" active={sortField} dir={sortDir} onSort={toggleSort}>Recipient</SortableTh>
              <SortableTh field="trancheCount" className="text-center" active={sortField} dir={sortDir} onSort={toggleSort}>Tranches</SortableTh>
              <SortableTh field="totalAmount" active={sortField} dir={sortDir} onSort={toggleSort}>Total</SortableTh>
              <SortableTh field="vested" active={sortField} dir={sortDir} onSort={toggleSort}>Vested</SortableTh>
              <SortableTh field="released" active={sortField} dir={sortDir} onSort={toggleSort}>Released</SortableTh>
              <SortableTh field="remaining" active={sortField} dir={sortDir} onSort={toggleSort}>Remaining</SortableTh>
              <SortableTh field="nextUnlockDate" active={sortField} dir={sortDir} onSort={toggleSort}>Next unlock</SortableTh>
              <SortableTh field="status" active={sortField} dir={sortDir} onSort={toggleSort}>Status</SortableTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {paginated.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="py-8 text-center text-sm text-gray-500"
                >
                  {search ? "No recipients match your filter." : "No vesting schedules found."}
                </td>
              </tr>
            ) : (
              paginated.map((row) => (
                <tr
                  key={row.address}
                  className="transition-colors hover:bg-white/2"
                >
                  <td className="px-3 py-2.5">
                    <ExplorerLink
                      type="account"
                      identifier={row.address}
                      truncate
                      truncateChars={6}
                      showCopy
                    />
                  </td>
                  <td className="px-3 py-2.5 text-center text-gray-300">
                    {row.trancheCount}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-gray-200">
                    {fmt(row.totalAmount)}
                    {tick}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-stellar-400">
                    {fmt(row.vested)}
                    {tick}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-green-400">
                    {fmt(row.released)}
                    {tick}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-white">
                    {fmt(row.remaining)}
                    {tick}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-400">
                    {row.nextUnlockDate
                      ? row.nextUnlockDate.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusChip status={row.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            {filtered.length} recipient{filtered.length !== 1 ? "s" : ""}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded p-1 hover:bg-white/5 disabled:opacity-30"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded p-1 hover:bg-white/5 disabled:opacity-30"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function exportVestingCsv(
  rows: RecipientRow[],
  decimals: number,
  label: string,
) {
  const fmt = (v: bigint) => formatTokenAmount(v, decimals);
  const header =
    "Recipient,Tranches,Total,Vested,Released,Remaining,Next Unlock,Status";
  const csvRows = rows.flatMap((r) =>
    r.schedules.map(
      (s, i) =>
        `${r.address},${i === 0 ? r.trancheCount : ""},` +
        `${i === 0 ? fmt(r.totalAmount) : ""},` +
        `${fmt(s.vested)},` +
        `${fmt(s.released)},` +
        `${fmt(s.remaining)},` +
        `${s.nextUnlockDate ? s.nextUnlockDate.toISOString().split("T")[0] : ""},` +
        `${s.status}`,
    ),
  );
  const csv = [header, ...csvRows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${label}-vesting.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function VestingDashboard({
  vestingContractId: initialVestingContractId,
  tokenContractId,
  decimals,
  read,
}: VestingDashboardProps) {
  const { data, loading, error, load } = useVestingDashboard(read);

  // Allow the admin to override the vesting contract address directly in the
  // dashboard (the prop is a sensible default from the token contract context,
  // but an admin may manage multiple vesting contracts).
  const [vestingInput, setVestingInput] = useState(
    initialVestingContractId ?? "",
  );

  // Propagate external prop changes into the input. This is the documented
  // "adjust state when a prop changes" pattern (an admin-editable input seeded
  // from an external default) — there is no render-time derivation that keeps
  // the field editable without an effect.
  useEffect(() => {
    if (initialVestingContractId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- prop -> state sync for an editable controlled input
      setVestingInput(initialVestingContractId);
    }
  }, [initialVestingContractId]);

  const handleLoad = () => {
    if (vestingInput.trim()) {
      load(vestingInput.trim(), tokenContractId);
    }
  };

  const symbol = undefined; // callers can pass tokenSymbol via props if needed.

  return (
    <AdminCard
      title="Vesting Dashboard"
      icon={BarChart2}
      wide
      description="All recipients, schedules, obligations, and solvency in one view."
      headerAction={
        <div className="flex items-center gap-2">
          {data && (
            <button
              onClick={() =>
                exportVestingCsv(
                  data.rows,
                  decimals,
                  vestingInput.slice(0, 8) || "vesting",
                )
              }
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10"
              title="Export CSV"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>
          )}
          <button
            onClick={handleLoad}
            disabled={loading || !vestingInput.trim()}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10 disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
            {data ? "Refresh" : "Load"}
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Vesting contract address input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={vestingInput}
            onChange={(e) => setVestingInput(e.target.value)}
            placeholder="Vesting contract address (C…)"
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-stellar-500 focus:ring-1 focus:ring-stellar-500"
            onKeyDown={(e) => e.key === "Enter" && handleLoad()}
          />
          <button
            onClick={handleLoad}
            disabled={loading || !vestingInput.trim()}
            className="btn-primary shrink-0 px-4 py-2 text-sm disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Load"
            )}
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin text-stellar-400" />
            Fetching all recipients and schedules…
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Content */}
        {!loading && data && (
          <>
            {/* Summary strip */}
            <SummaryStrip
              summary={data.summary}
              decimals={decimals}
              symbol={symbol}
            />

            {/* Paused warning */}
            {data.summary.isPaused && (
              <div className="flex items-center gap-2 rounded-xl border border-orange-500/30 bg-orange-500/5 px-4 py-3 text-sm text-orange-400">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Vesting contract is currently paused — releases are blocked.
              </div>
            )}

            {/* 12-month projection chart */}
            {data.rows.length > 0 && (
              <div>
                <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-500">
                  Projected unlocks — next 12 months
                </h4>
                <ProjectionChart
                  projection={data.projection}
                  decimals={decimals}
                />
              </div>
            )}

            {/* Recipient table */}
            <div>
              <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-500">
                Recipients ({data.rows.length})
              </h4>
              {data.rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-500">
                  No vesting schedules found on this contract.
                </p>
              ) : (
                <VestingTable
                  rows={data.rows}
                  decimals={decimals}
                  symbol={symbol}
                />
              )}
            </div>
          </>
        )}
      </div>
    </AdminCard>
  );
}
