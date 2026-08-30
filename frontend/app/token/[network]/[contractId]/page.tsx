import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchTokenInfo, validateTokenContract } from "@/lib/stellar";
import { isValidContractId } from "@/lib/contractValidation";
import { NETWORKS, type NetworkType } from "@/types/network";
import PublicTokenPage from "./PublicTokenPage";

// Cache each token page for 60 seconds, matching the precedent set by the
// /api/tokens/recent in-memory cache.  Prevents every crawler hit from
// triggering a fresh RPC round-trip.
export const revalidate = 60;

interface PageProps {
  params: Promise<{ network: string; contractId: string }>;
}

function resolveNetwork(network: string): NetworkType {
  return network === "mainnet" ? "mainnet" : "testnet";
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { network, contractId } = await params;

  // Reject malformed contract IDs before touching RPC.
  if (!isValidContractId(contractId)) {
    return {
      title: "Invalid Contract ID | SoroPad",
      description: "The supplied contract ID is not a valid Stellar contract address.",
    };
  }

  const resolvedNetwork = resolveNetwork(network);

  try {
    // SEP-41 compliance check (on-chain) before fetching full token info.
    const validation = await validateTokenContract(contractId, NETWORKS[resolvedNetwork]);

    if (!validation.isValid) {
      // Return fallback metadata for invalid contracts
      return {
        title: `Invalid Token Contract — ${contractId.slice(0, 8)}... | SoroPad`,
        description: `The contract ${contractId} does not appear to be a valid SEP-41 token contract.`,
        openGraph: {
          title: `Invalid Token Contract — ${contractId.slice(0, 8)}...`,
          description: `This contract does not implement the SEP-41 token standard`,
          type: "website",
        },
      };
    }

    const tokenInfo = await fetchTokenInfo(contractId, NETWORKS[resolvedNetwork]);

    return {
      title: `${tokenInfo.name} (${tokenInfo.symbol}) — ${tokenInfo.totalSupply} Supply | SoroPad`,
      description: `View ${tokenInfo.name} token details, total supply of ${tokenInfo.totalSupply}, and holder distribution on Stellar Soroban.`,
      openGraph: {
        title: `${tokenInfo.name} (${tokenInfo.symbol})`,
        description: `Total Supply: ${tokenInfo.totalSupply} • View token details and holder distribution on Stellar Soroban`,
        type: "website",
        images: [
          {
            // Relative URL — resolved to absolute by metadataBase in root layout
            url: `/api/og/token/${network}/${contractId}`,
            width: 1200,
            height: 630,
            alt: `${tokenInfo.name} (${tokenInfo.symbol}) Token`,
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title: `${tokenInfo.name} (${tokenInfo.symbol})`,
        description: `Total Supply: ${tokenInfo.totalSupply} • View token details on Stellar Soroban`,
        images: [`/api/og/token/${network}/${contractId}`],
      },
    };
  } catch (error) {
    console.error("Failed to fetch token metadata for OG:", error);
  }

  // Fallback metadata
  return {
    title: `Token Details — ${contractId.slice(0, 8)}... | SoroPad`,
    description: `View token details and holder distribution for contract ${contractId} on Stellar Soroban.`,
    openGraph: {
      title: `Token Details — ${contractId.slice(0, 8)}...`,
      description: `View token details and holder distribution on Stellar Soroban`,
      type: "website",
    },
  };
}

export default async function PublicTokenPageRoute({ params }: PageProps) {
  const { network, contractId } = await params;

  // Reject malformed contract IDs with a 404 before any RPC work.
  if (!isValidContractId(contractId)) {
    notFound();
  }

  return <PublicTokenPage contractId={contractId} network={network} />;
}
