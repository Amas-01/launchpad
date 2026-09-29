import { NETWORKS, type NetworkType } from "@/types/network";
import { fetchRegistryTokens, EXPLORE_WINDOW, type ExploreToken } from "@/lib/explore";
import { ExploreList } from "./ExploreList";

// Rendered on the server from the factory registry and cached, so the page
// works without a wallet.
export const revalidate = 60;

export const metadata = { title: "Explore launches — SoroPad" };

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ network?: string }>;
}) {
  const { network: requested } = await searchParams;
  const network: NetworkType = requested === "mainnet" ? "mainnet" : "testnet";
  const factoryAddress = process.env.NEXT_PUBLIC_FACTORY_ADDRESS;

  let tokens: ExploreToken[] = [];
  let error: string | null = null;
  if (!factoryAddress) {
    error = "Factory contract not configured (NEXT_PUBLIC_FACTORY_ADDRESS).";
  } else {
    try {
      tokens = await fetchRegistryTokens(NETWORKS[network], factoryAddress);
    } catch {
      error = "Unable to load launches from the factory registry.";
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-6 pb-16 pt-28">
      <h1 className="mb-2 text-3xl font-bold">Explore launches</h1>
      <p className="mb-8 text-sm text-gray-400">
        Latest {EXPLORE_WINDOW} tokens deployed through the SoroPad factory on {network}.
      </p>
      {error ? <p className="text-sm text-red-400">{error}</p> : <ExploreList tokens={tokens} />}
    </main>
  );
}
