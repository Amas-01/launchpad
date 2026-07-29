"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { Download, FileText, Loader2, AlertCircle, ChevronDown } from "lucide-react";
import {
    formatTokenAmount,
    truncateAddress,
    type TransactionItem
} from "@/lib/stellar";
import { useSoroban } from "@/hooks/useSoroban";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

interface TransactionHistoryProps {
    contractId: string;
    decimals: number;
    symbol: string;
}

export default function TransactionHistory({
    contractId,
    decimals,
    symbol
}: TransactionHistoryProps) {
    const [history, setHistory] = useState<TransactionItem[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showExportOptions, setShowExportOptions] = useState(false);

    const { fetchTransactionHistory } = useSoroban();

    const loadHistory = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { items, nextCursor: cursor } = await fetchTransactionHistory(contractId);
            setHistory(items);
            setNextCursor(cursor);
        } catch (err) {
            console.error("Failed to load history:", err);
            setError("Failed to load transaction history. Please try again.");
        } finally {
            setLoading(false);
        }
    }, [contractId, fetchTransactionHistory]);

    const loadMore = useCallback(async () => {
        if (!nextCursor || loadingMore) return;
        setLoadingMore(true);
        try {
            const { items, nextCursor: cursor } = await fetchTransactionHistory(contractId, { cursor: nextCursor });
            setHistory((prev) => [...prev, ...items]);
            setNextCursor(cursor);
        } catch (err) {
            console.error("Failed to load more history:", err);
        } finally {
            setLoadingMore(false);
        }
    }, [contractId, fetchTransactionHistory, nextCursor, loadingMore]);

    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    const stats = useMemo(() => {
        let totalMinted = BigInt(0);
        const recipients = new Set<string>();

        history.forEach((tx) => {
            if (tx.type === "mint") {
                totalMinted += BigInt(tx.amount);
                if (tx.to) recipients.add(tx.to);
            } else if (tx.type === "transfer" && tx.to) {
                recipients.add(tx.to);
            }
        });

        return {
            totalMinted: formatTokenAmount(totalMinted.toString(), decimals),
            totalRecipients: recipients.size,
        };
    }, [history, decimals]);

    // Prepare common export data
    const prepareExportData = () => {
        return history.map(tx => ({
            type: tx.type.toUpperCase(),
            from: tx.from || "-",
            to: tx.to || "-",
            amount: formatTokenAmount(tx.amount, decimals),
            ledger: tx.ledger.toString(),
            transactionId: tx.id,
            timestamp: new Date(tx.timestamp).toISOString()
        }));
    };

    const exportPDF = () => {
        const doc = new jsPDF();

        // Add header
        doc.setFontSize(18);
        doc.text(`Token Transaction Report: ${symbol}`, 14, 22);

        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Contract ID: ${contractId}`, 14, 30);
        doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 37);

        // Add summary
        doc.setFontSize(14);
        doc.setTextColor(0);
        doc.text("Summary Statistics", 14, 50);

        doc.setFontSize(11);
        doc.text(`Total Minted: ${stats.totalMinted} ${symbol}`, 14, 58);
        doc.text(`Total Recipients: ${stats.totalRecipients}`, 14, 65);

        // Add table
        const tableData = history.map(tx => [
            tx.type.toUpperCase(),
            tx.from ? truncateAddress(tx.from, 8) : "-",
            tx.to ? truncateAddress(tx.to, 8) : "-",
            `${formatTokenAmount(tx.amount, decimals)} ${symbol}`,
            `L${tx.ledger}`,
            new Date(tx.timestamp).toLocaleString()
        ]);

        autoTable(doc, {
            startY: 75,
            head: [["Type", "From", "To", "Amount", "Ledger", "Timestamp"]],
            body: tableData,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [41, 128, 185] }
        });

        doc.save(`${symbol}_transaction_history.pdf`);
        setShowExportOptions(false);
    };

    const exportCSV = () => {
        const exportData = prepareExportData();

        // Create header rows
        const csvRows = [
            `Token Transaction Report: ${symbol}`,
            `Contract ID: ${contractId}`,
            `Generated: ${new Date().toLocaleString()}`,
            "",
            "Summary Statistics",
            `Total Minted: ${stats.totalMinted} ${symbol}`,
            `Total Recipients: ${stats.totalRecipients}`,
            "",
            "Type,From,To,Amount,Ledger,Transaction ID,Timestamp"
        ];

        // Add data rows
        exportData.forEach(tx => {
            csvRows.push(
                `${tx.type},${tx.from},${tx.to},"${tx.amount} ${symbol}",${tx.ledger},${tx.transactionId},${tx.timestamp}`
            );
        });

        // Create blob and download
        const csvContent = csvRows.join("\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        
        link.setAttribute("href", url);
        link.setAttribute("download", `${symbol}_transaction_history.csv`);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        setShowExportOptions(false);
    };

    if (loading && history.length === 0) {
        return (
            <div className="flex h-32 flex-col items-center justify-center gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-stellar-400" />
                <p className="text-sm text-gray-400">Loading history...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="glass-card p-4">
                    <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
                        Total Minted to Date
                    </span>
                    <p className="mt-1 text-xl font-bold text-white">
                        {stats.totalMinted} <span className="text-stellar-400 text-sm font-normal">{symbol}</span>
                    </p>
                </div>
                <div className="glass-card p-4">
                    <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
                        Total Recipients
                    </span>
                    <p className="mt-1 text-xl font-bold text-white">
                        {stats.totalRecipients}
                    </p>
                </div>
            </div>

            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Transaction History</h3>

                <div className="relative">
                    <button
                        onClick={() => setShowExportOptions(!showExportOptions)}
                        className="btn-secondary flex items-center gap-2 px-4 py-2 text-sm"
                    >
                        <Download className="h-4 w-4" />
                        Export Report
                        <ChevronDown className={`h-4 w-4 transition-transform ${showExportOptions ? "rotate-180" : ""}`} />
                    </button>

                    {showExportOptions && (
                        <div className="absolute right-0 top-full z-10 mt-2 w-48 overflow-hidden rounded-lg border border-white/10 bg-void-900 bg-opacity-95 shadow-xl backdrop-blur-md">
                            <button
                                onClick={exportPDF}
                                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-gray-300 transition-colors hover:bg-white/5 hover:text-white"
                            >
                                <FileText className="h-4 w-4 text-red-400" />
                                Export as PDF
                            </button>
                            <button
                                onClick={exportCSV}
                                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-gray-300 transition-colors hover:bg-white/5 hover:text-white"
                            >
                                <FileText className="h-4 w-4 text-blue-400" />
                                Export as CSV
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {error && (
                <div className="glass-card flex items-center gap-3 p-4 text-sm text-red-400">
                    <AlertCircle className="h-4 w-4" />
                    <p>{error}</p>
                </div>
            )}

            {history.length === 0 ? (
                <div className="glass-card flex flex-col items-center justify-center p-12 text-center text-gray-500">
                    <p>No transactions found for this token yet.</p>
                    <p className="mt-1 text-xs">Events may take a few moments to appear after a transaction.</p>
                </div>
            ) : (
                <div className="glass-card overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-white/5 bg-white/2">
                                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Type</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">From / To</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Amount</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Ledger</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {history.map((tx) => (
                                    <tr key={tx.id} className="transition-colors hover:bg-white/2">
                                        <td className="px-4 py-4">
                                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tx.type === "mint" ? "bg-green-500/10 text-green-400" :
                                                tx.type === "burn" ? "bg-red-500/10 text-red-400" :
                                                    "bg-blue-500/10 text-blue-400"
                                                }`}>
                                                {tx.type}
                                            </span>
                                        </td>
                                        <td className="px-4 py-4 font-mono text-xs">
                                            {tx.type === "mint" ? (
                                                <div className="flex flex-col">
                                                    <span className="text-gray-500">To:</span>
                                                    <span className="text-stellar-300">{truncateAddress(tx.to!, 6)}</span>
                                                </div>
                                            ) : tx.type === "burn" ? (
                                                <div className="flex flex-col">
                                                    <span className="text-gray-500">From:</span>
                                                    <span className="text-stellar-300">{truncateAddress(tx.from!, 6)}</span>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex items-center gap-1">
                                                        <span className="w-8 text-gray-500">From:</span>
                                                        <span className="text-stellar-300">{truncateAddress(tx.from!, 6)}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <span className="w-8 text-gray-500">To:</span>
                                                        <span className="text-stellar-300">{truncateAddress(tx.to!, 6)}</span>
                                                    </div>
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-4 text-right font-mono text-white">
                                            {formatTokenAmount(tx.amount, decimals)}
                                        </td>
                                        <td className="px-4 py-4 text-right text-xs text-gray-400">
                                            L{tx.ledger.toLocaleString()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {nextCursor && (
                <div className="flex justify-center">
                    <button
                        onClick={loadMore}
                        disabled={loadingMore}
                        className="btn-secondary flex items-center gap-2 px-6 py-2 text-sm disabled:opacity-50"
                    >
                        {loadingMore ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : null}
                        {loadingMore ? "Loading..." : "Load More"}
                    </button>
                </div>
            )}
        </div>
    );
}
