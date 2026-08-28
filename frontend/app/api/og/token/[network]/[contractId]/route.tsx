import { ImageResponse } from "next/og";
import { fetchTokenInfo } from "@/lib/stellar";
import { isValidContractId } from "@/lib/contractValidation";
import { NETWORKS, type NetworkType } from "@/types/network";

export const runtime = "edge";

// Cache lifetime for OG images — 60 s fresh, then serve stale while revalidating
// for up to an additional 60 s.  Mirrors the /api/tokens/recent TTL precedent.
const CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=60";

function resolveNetwork(network: string): NetworkType {
  return network === "mainnet" ? "mainnet" : "testnet";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ network: string; contractId: string }> }
) {
  const { network, contractId } = await params;

  // Reject malformed contract IDs immediately — no RPC call needed.
  if (!isValidContractId(contractId)) {
    return new Response("Invalid contract ID", { status: 400 });
  }

  try {
    const resolvedNetwork = resolveNetwork(network);
    const tokenInfo = await fetchTokenInfo(contractId, NETWORKS[resolvedNetwork]);

    return new ImageResponse(
      (
        <div
          style={{
            height: "100%",
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#0a0a0a",
            backgroundImage: "linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%)",
            color: "white",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              padding: "40px",
            }}
          >
            {/* Token Icon/Logo placeholder */}
            <div
              style={{
                width: "80px",
                height: "80px",
                borderRadius: "50%",
                backgroundColor: "#7c3aed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: "24px",
                fontSize: "32px",
                fontWeight: "bold",
              }}
            >
              {tokenInfo.symbol.slice(0, 2).toUpperCase()}
            </div>

            {/* Token Name and Symbol */}
            <h1
              style={{
                fontSize: "48px",
                fontWeight: "bold",
                margin: "0 0 8px 0",
                color: "#ffffff",
              }}
            >
              {tokenInfo.name}
            </h1>

            <p
              style={{
                fontSize: "32px",
                margin: "0 0 24px 0",
                color: "#a78bfa",
              }}
            >
              ({tokenInfo.symbol})
            </p>

            {/* Token Details */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                fontSize: "20px",
                color: "#d1d5db",
              }}
            >
              <div>
                <strong>Total Supply:</strong> {tokenInfo.totalSupply}
              </div>
              <div>
                <strong>Decimals:</strong> {tokenInfo.decimals}
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                position: "absolute",
                bottom: "40px",
                fontSize: "16px",
                color: "#9ca3af",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <div
                style={{
                  width: "20px",
                  height: "20px",
                  borderRadius: "50%",
                  backgroundColor: "#7c3aed",
                }}
              />
              SoroPad • Stellar Soroban
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        headers: { "Cache-Control": CACHE_CONTROL },
      }
    );
  } catch (error) {
    console.error("Error generating OG image:", error);

    // Fallback image — also cached so a single bad/transient fetch
    // does not hammer the RPC endpoint on every retry.
    return new ImageResponse(
      (
        <div
          style={{
            height: "100%",
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#0a0a0a",
            color: "white",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h1
            style={{
              fontSize: "48px",
              fontWeight: "bold",
              margin: "0 0 16px 0",
            }}
          >
            Token Details
          </h1>
          <p
            style={{
              fontSize: "24px",
              margin: "0",
              color: "#9ca3af",
            }}
          >
            View on SoroPad
          </p>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        headers: { "Cache-Control": CACHE_CONTROL },
      }
    );
  }
}
