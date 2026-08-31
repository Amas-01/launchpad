"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { ArrowUpDown, Snowflake } from "lucide-react";
import { type TokenHolder } from "@/lib/stellar";
import { ExplorerLink } from "@/components/ui/ExplorerLink";

type SortField = "address" | "balance" | "sharePercent";
type SortDir = "asc" | "desc";

export function exportHoldersCsv(
  holders: TokenHolder[],
  label: string = "holders",
) {
  const header = "Address,Balance,Share %";
  const rows = holders.map(
    (h) => `${h.address},${h.balance},${h.sharePercent.toFixed(2)}`,
  );
  const csv = [header, ...rows].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${label}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function HoldersTable({
  holders,
  emptyMessage = "No holder data available.",
  frozenAddresses,
}: {
  holders: TokenHolder[];
  emptyMessage?: string;
  frozenAddresses?: Set<string>;
}) {
  const t = useTranslations("dashboard.holders");
  const showStatus = frozenAddresses !== undefined;
  const [sortField, setSortField] = useState<SortField>("balance");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
    setCurrentPage(1);
  };

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return holders;
    const query = searchQuery.toLowerCase();
    return holders.filter((holder) =>
      holder.address.toLowerCase().includes(query),
    );
  }, [holders, searchQuery]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "address":
          cmp = a.address.localeCompare(b.address);
          break;
        case "balance":
          cmp = parseFloat(a.balance) - parseFloat(b.balance);
          break;
        case "sharePercent":
          cmp = a.sharePercent - b.sharePercent;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  const totalPages = Math.ceil(sorted.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedHolders = sorted.slice(startIndex, endIndex);

  if (holders.length === 0) {
    return (
      <div className="glass-card p-8 text-center text-gray-500">
        <p>{emptyMessage}</p>
        <p className="mt-1 text-xs">
          {t("sorobanNote")}
        </p>
      </div>
    );
  }

  const thClass =
    "px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 cursor-pointer select-none hover:text-gray-300 transition-colors";

  return (
    <div className="space-y-4">
      <div className="glass-card p-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder={t("searchPlaceholder")}
              className="w-full rounded-lg border border-white/10 bg-void-800 px-4 py-2 pl-10 text-sm text-white placeholder-gray-500 outline-none focus:border-stellar-500 focus:ring-1 focus:ring-stellar-500"
              aria-label={t("searchAria")}
            />
            <svg
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <button
            onClick={() =>
              exportHoldersCsv(
                paginatedHolders,
                searchQuery ? "filtered_holders" : "current_page_holders",
              )
            }
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:border-stellar-400/30 hover:bg-stellar-500/10 hover:text-stellar-300 whitespace-nowrap"
            title={
              searchQuery
                ? t("exportFiltered", { count: paginatedHolders.length })
                : t("exportCurrent", { count: paginatedHolders.length })
            }
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            {t("exportPage", { count: paginatedHolders.length })}
          </button>
        </div>
        {searchQuery && (
          <p className="mt-2 text-xs text-gray-400">
            {t("foundOf", { filtered: filtered.length, holders: holders.length })}
          </p>
        )}
      </div>

      <div className="glass-card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <p>{t("noMatching", { query: searchQuery })}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" role="table">
                <thead>
                  <tr className="border-b border-white/5">
                    <th
                      className={thClass}
                      onClick={() => toggleSort("address")}
                      aria-sort={
                        sortField === "address"
                          ? sortDir === "asc" ? "ascending" : "descending"
                          : "none"
                      }
                    >
                      <span className="inline-flex items-center gap-1">
                        {t("address")}
                        <ArrowUpDown className="h-3 w-3" />
                      </span>
                    </th>
                    <th
                      className={`${thClass} text-right`}
                      onClick={() => toggleSort("balance")}
                      aria-sort={
                        sortField === "balance"
                          ? sortDir === "asc" ? "ascending" : "descending"
                          : "none"
                      }
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        {t("balance")}
                        <ArrowUpDown className="h-3 w-3" />
                      </span>
                    </th>
                    <th
                      className={`${thClass} text-right`}
                      onClick={() => toggleSort("sharePercent")}
                      aria-sort={
                        sortField === "sharePercent"
                          ? sortDir === "asc" ? "ascending" : "descending"
                          : "none"
                      }
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        {t("sharePercent")}
                        <ArrowUpDown className="h-3 w-3" />
                      </span>
                    </th>
                    {showStatus && (
                      <th scope="col" className={`${thClass} text-right cursor-default`}>
                        {t("status")}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {paginatedHolders.map((holder, i) => (
                    <tr
                      key={holder.address}
                      className={`border-b border-white/5 transition-colors hover:bg-white/2 ${
                        i % 2 === 0 ? "bg-white/1" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-stellar-300">
                        <ExplorerLink
                          type="account"
                          identifier={holder.address}
                          truncate={true}
                          truncateChars={6}
                          showCopy={true}
                        />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-white">
                        {holder.balance}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-void-700 sm:block">
                            <div
                              className="h-full rounded-full bg-linear-to-r from-stellar-500 to-stellar-400"
                              style={{ width: `${Math.min(holder.sharePercent, 100)}%` }}
                            />
                          </div>
                          <span className="font-mono text-gray-300">
                            {holder.sharePercent.toFixed(2)}%
                          </span>
                        </div>
                      </td>
                      {showStatus && (
                        <td className="px-4 py-3 text-right">
                          {frozenAddresses.has(holder.address) ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-medium text-cyan-300">
                              <Snowflake className="h-3 w-3" aria-hidden="true" />
                              {t("frozen")}
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-500">{t("active")}</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-white/5 px-4 py-3">
                <div className="text-xs text-gray-400">
                  {t("pageInfo", { start: startIndex + 1, end: Math.min(endIndex, sorted.length), total: sorted.length })}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-stellar-400/30 hover:bg-stellar-500/10 hover:text-stellar-300 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={t("previousPage")}
                  >
                    {t("previousPage")}
                  </button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter((page) => page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1)
                      .map((page, idx, arr) => {
                        const prevPage = arr[idx - 1];
                        const showEllipsis = prevPage && page - prevPage > 1;
                        return (
                          <div key={page} className="flex items-center gap-1">
                            {showEllipsis && <span className="px-2 text-xs text-gray-500">...</span>}
                            <button
                              onClick={() => setCurrentPage(page)}
                              className={`h-8 w-8 rounded-lg text-xs font-medium transition-colors ${
                                currentPage === page
                                  ? "bg-stellar-500 text-white"
                                  : "border border-white/10 bg-white/5 text-gray-300 hover:border-stellar-400/30 hover:bg-stellar-500/10 hover:text-stellar-300"
                              }`}
                              aria-label={t("goToPage", { page })}
                              aria-current={currentPage === page ? "page" : undefined}
                            >
                              {page}
                            </button>
                          </div>
                        );
                      })}
                  </div>
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-stellar-400/30 hover:bg-stellar-500/10 hover:text-stellar-300 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={t("nextPage")}
                  >
                    {t("nextPage")}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
