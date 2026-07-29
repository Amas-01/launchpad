"use client";

import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Percent } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import type { UseAdminActionResult } from "../../hooks/useAdminAction";
import { AdminCard } from "./AdminCard";
import {
  whaleCapSchema,
  complianceNodeSchema,
  type WhaleCapData,
  type ComplianceNodeData,
} from "./schemas";

/**
 * Transfer policy: whale protection and the compliance gating contract.
 * Both change how transfers are validated, so they share one card.
 */
export function PolicyCard({
  admin,
  disabled,
  whaleCap,
  complianceNode,
  onWhaleCapChanged,
  onComplianceNodeChanged,
}: {
  admin: UseAdminActionResult;
  disabled: boolean;
  whaleCap: number | null;
  complianceNode: string | null;
  onWhaleCapChanged: () => void;
  onComplianceNodeChanged: () => void;
}) {
  const whaleForm = useForm<WhaleCapData>({
    resolver: zodResolver(whaleCapSchema),
  });
  const complianceForm = useForm<ComplianceNodeData>({
    resolver: zodResolver(complianceNodeSchema),
  });

  const afterWhaleCap = (ok: boolean) => {
    if (!ok) return;
    whaleForm.reset();
    onWhaleCapChanged();
  };

  const afterComplianceNode = (ok: boolean) => {
    if (!ok) return;
    complianceForm.reset();
    onComplianceNodeChanged();
  };

  return (
    <AdminCard title="Transfer Policy" icon={Percent} wide>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 flex-grow">
        {/* Whale Protection */}
        <form
          onSubmit={whaleForm.handleSubmit(async (data) =>
            afterWhaleCap(await admin.run("set-whale-cap", data)),
          )}
          className="space-y-4 flex flex-col justify-between"
        >
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-semibold text-white mb-1">
                Whale Protection
              </h4>
              <p className="text-xs text-gray-400">
                Limits the maximum balance any non-admin account can hold, as a
                percentage of the total supply.
              </p>
            </div>
            <div className="text-xs text-stellar-200 bg-white/5 px-3 py-2 rounded-lg border border-white/10 flex items-center justify-between">
              <span>Current Max Balance Cap:</span>
              <span className="font-semibold text-stellar-400">
                {whaleCap !== null ? `${whaleCap}% of total supply` : "None"}
              </span>
            </div>
            <Input
              label="Percentage Cap (1-100)"
              type="number"
              placeholder="1-100"
              className="bg-white/5 border-white/10"
              {...whaleForm.register("cap")}
              error={whaleForm.formState.errors.cap?.message}
              disabled={disabled}
            />
          </div>
          <div className="flex gap-2 mt-4">
            <Button
              type="submit"
              className="flex-1 bg-stellar-500 hover:bg-stellar-600 text-white shadow-lg shadow-stellar-500/20"
              isLoading={admin.loading === "set-whale-cap"}
              disabled={disabled}
            >
              Set Cap
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="border-red-500/20 text-red-400 hover:border-red-500/40"
              isLoading={admin.loading === "disable-whale-cap"}
              disabled={disabled || whaleCap === null}
              onClick={async () =>
                afterWhaleCap(await admin.run("disable-whale-cap", {}))
              }
            >
              Disable
            </Button>
          </div>
        </form>

        {/* Compliance Node */}
        <form
          onSubmit={complianceForm.handleSubmit(async (data) =>
            afterComplianceNode(await admin.run("set-compliance-node", data)),
          )}
          className="space-y-4 flex flex-col justify-between border-t md:border-t-0 md:border-l border-white/10 pt-6 md:pt-0 md:pl-8"
        >
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-semibold text-white mb-1">
                Compliance Node
              </h4>
              <p className="text-xs text-gray-400">
                Set a compliance gating contract to inspect and authorize
                transfers.
              </p>
            </div>
            <div className="text-xs text-stellar-200 bg-white/5 px-3 py-2 rounded-lg border border-white/10 flex flex-col gap-1">
              <span className="text-gray-400">Current Node Address:</span>
              <span className="font-semibold text-stellar-400 break-all min-h-[1.5rem] flex items-center">
                {complianceNode ? (
                  <ExplorerLink
                    type="contract"
                    identifier={complianceNode}
                    truncate={true}
                    truncateChars={12}
                    showCopy={true}
                  />
                ) : (
                  "None"
                )}
              </span>
            </div>
            <Input
              label="Contract ID"
              placeholder="C..."
              className="bg-white/5 border-white/10"
              {...complianceForm.register("address")}
              error={complianceForm.formState.errors.address?.message}
              disabled={disabled}
            />
          </div>
          <div className="space-y-3 mt-4">
            <div className="flex gap-2">
              <Button
                type="submit"
                className="flex-1 bg-stellar-500 hover:bg-stellar-600 text-white shadow-lg shadow-stellar-500/20"
                isLoading={admin.loading === "set-compliance-node"}
                disabled={disabled}
              >
                Set Node
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="border-red-500/20 text-red-400 hover:border-red-500/40"
                isLoading={admin.loading === "clear-compliance-node"}
                disabled={disabled || !complianceNode}
                onClick={async () =>
                  afterComplianceNode(
                    await admin.run("clear-compliance-node", {}),
                  )
                }
              >
                Clear
              </Button>
            </div>

            <div className="flex items-start gap-2 text-[10px] leading-relaxed text-yellow-400 bg-yellow-500/5 p-2.5 rounded-lg border border-yellow-500/10">
              <AlertTriangle
                className="w-3.5 h-3.5 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <span>
                A compliance node must implement <code>can_trade</code>. The
                contract probes the address before storing it and rejects
                anything that does not answer, so an invalid node is refused
                rather than silently blocking every transfer. Clearing the node
                always works while an admin exists.
              </span>
            </div>
          </div>
        </form>
      </div>
    </AdminCard>
  );
}
