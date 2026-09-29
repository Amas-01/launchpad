"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { filterAndSort, type ExploreSort, type ExploreToken } from "@/lib/explore";

export function ExploreList({ tokens }: { tokens: ExploreToken[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ExploreSort>("newest");
  const rows = useMemo(() => filterAndSort(tokens, query, sort), [tokens, query, sort]);

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Search by name or symbol</span>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or symbol"
            className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-400">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as ExploreSort)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">No launches match.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((t) => (
            <li key={t.contractId}>
              <Link
                href={`/token/${t.contractId}`}
                className="block rounded-xl border border-white/10 bg-white/5 p-4 transition-colors hover:border-white/20"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold">{t.name}</span>
                  <span className="text-xs text-gray-400">{t.symbol}</span>
                </div>
                <p className="mt-2 text-xs text-gray-500">Supply: {t.totalSupply}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
