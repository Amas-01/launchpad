"use client";

import { UserPlus } from "lucide-react";
import { truncateAddress } from "@/lib/stellar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";

export interface PendingAdminBannerProps {
  pendingAdmin: string;
  connectedWallet?: string | null;
  title?: string;
  /**
   * Extra guidance shown when the current wallet is not the pending admin.
   * This keeps the copy accurate across token and vesting admin panels.
   */
  nonPendingMessage?: string;
}

/**
 * Shared banner for the two-step admin transfer flow.
 *
 * The token dashboard already used this pattern inline. Pulling it into a
 * shared component lets other admin surfaces — including vesting — reuse the
 * same visibility affordance when a proposal is in flight.
 */
export function PendingAdminBanner({
  pendingAdmin,
  connectedWallet,
  title = "Admin transfer pending",
  nonPendingMessage = "It is not finalized until the pending admin accepts.",
}: PendingAdminBannerProps) {
  const isPendingAdmin =
    !!connectedWallet && connectedWallet === pendingAdmin;

  return (
    <Alert variant="default" className="mb-6">
      <div className="flex items-start gap-3">
        <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-stellar-400" />
        <div>
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>
            A two-step admin transfer is in progress. Pending admin →{" "}
            <span className="font-mono font-medium text-stellar-300">
              {truncateAddress(pendingAdmin)}
            </span>
            .{" "}
            {isPendingAdmin
              ? "Your connected wallet is the pending admin — accept the role below to finalize it."
              : nonPendingMessage}
          </AlertDescription>
        </div>
      </div>
    </Alert>
  );
}
