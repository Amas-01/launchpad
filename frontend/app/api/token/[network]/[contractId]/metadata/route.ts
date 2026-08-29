import { NextRequest, NextResponse } from "next/server";
import { fetchTokenInfo } from "@/lib/stellar";
import { NETWORKS, type NetworkType } from "@/types/network";

function resolveNetwork(network: string): NetworkType {
  return network === "mainnet" ? "mainnet" : "testnet";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ network: string; contractId: string }> }
) {
  try {
    const { network, contractId } = await params;
    const resolvedNetwork = resolveNetwork(network);
    const tokenInfo = await fetchTokenInfo(contractId, NETWORKS[resolvedNetwork]);
    
    return NextResponse.json(tokenInfo);
  } catch (error) {
    console.error("Error fetching token metadata:", error);
    return NextResponse.json(
      { error: "Failed to fetch token metadata" },
      { status: 404 }
    );
  }
}