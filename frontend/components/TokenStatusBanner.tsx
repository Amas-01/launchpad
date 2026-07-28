"use client";

import type React from "react";
import { PauseCircle, ShieldCheck, ShieldAlert, Lock, SnowflakeIcon } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/Alert";
import type { TokenInfo, WalletTokenState } from "@/lib/stellar";

interface TokenStatusBannerProps {
  tokenInfo: Pick<TokenInfo, "isPaused" | "isLocked" | "authorizationRequired">;
  /** Wallet-specific state, when a wallet is connected. */
  walletState?: WalletTokenState | null;
}

/**
 * Reason a transfer/claim CTA should be disabled for the current token +
 * wallet state, or null if nothing blocks the action.
 */
export function getTokenActionBlockedReason(
  tokenInfo: Pick<TokenInfo, "isPaused">,
  walletState?: WalletTokenState | null,
): string | null {
  if (tokenInfo.isPaused) {
    return "This token is currently paused by its admin — transfers are halted.";
  }
  if (walletState?.isFrozen) {
    return "Your wallet is frozen for this token and cannot send or receive it.";
  }
  if (walletState && !walletState.isAuthorized) {
    return "Your wallet is not authorized to hold or transfer this token.";
  }
  return null;
}

/**
 * Live status banner surfacing token pause/lock/authorization state, plus
 * the connected wallet's authorization/freeze state when available.
 */
export function TokenStatusBanner({
  tokenInfo,
  walletState,
}: TokenStatusBannerProps) {
  const banners: React.ReactElement[] = [];

  if (tokenInfo.isPaused) {
    banners.push(
      <Alert key="paused" variant="warning">
        <div className="flex items-start gap-3">
          <PauseCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <AlertTitle>Token is paused</AlertTitle>
            <AlertDescription>
              The admin has paused this token. Transfers and other
              state-changing operations are halted until it is unpaused.
            </AlertDescription>
          </div>
        </div>
      </Alert>,
    );
  }

  if (walletState?.isFrozen) {
    banners.push(
      <Alert key="frozen" variant="destructive">
        <div className="flex items-start gap-3">
          <SnowflakeIcon className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <AlertTitle>Your wallet is frozen</AlertTitle>
            <AlertDescription>
              This wallet has been frozen by the token admin and cannot send
              or receive this token.
            </AlertDescription>
          </div>
        </div>
      </Alert>,
    );
  } else if (walletState && !walletState.isAuthorized) {
    banners.push(
      <Alert key="unauthorized" variant="destructive">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <AlertTitle>Your wallet is not authorized</AlertTitle>
            <AlertDescription>
              This token requires authorization, and this wallet does not
              currently have it. Contact the token admin to request
              authorization.
            </AlertDescription>
          </div>
        </div>
      </Alert>,
    );
  }

  if (tokenInfo.authorizationRequired) {
    banners.push(
      <Alert key="auth-required" variant="default">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <AlertTitle>Authorization required</AlertTitle>
            <AlertDescription>
              Holders must be authorized by the token admin before they can
              transact with this token.
            </AlertDescription>
          </div>
        </div>
      </Alert>,
    );
  }

  if (tokenInfo.isLocked) {
    banners.push(
      <Alert key="locked" variant="success">
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <AlertTitle>Immutable token</AlertTitle>
            <AlertDescription>
              Admin control has been permanently revoked. Supply and
              permissions for this token can no longer change — a strong
              trust signal for holders.
            </AlertDescription>
          </div>
        </div>
      </Alert>,
    );
  }

  if (banners.length === 0) return null;

  return <div className="mb-6 flex flex-col gap-3">{banners}</div>;
}
