import type { Metadata } from "next";
import Link from "next/link";
import TokenDashboard from "./TokenDashboard";

interface PageProps {
  params: Promise<{ contractId: string }>;
}

// basic sanity check for contract format
const isValidContractId = (id: string) => {
  return typeof id === "string" && id.length > 10;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { contractId } = await params;

  return {
    title: `Token Dashboard — ${contractId.slice(0, 8)}... | SoroPad`,
    description: `View token details and holder distribution for contract ${contractId}`,
  };
}

export default async function TokenDashboardPage({ params }: PageProps) {
  const { contractId } = await params;

  // 🚨 early guard (prevents obvious invalid contract crashes)
  if (!isValidContractId(contractId)) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center">
        <h2 className="text-xl font-semibold">
          Invalid contract ID
        </h2>

        <p className="text-gray-500 mt-2">
          The contract ID provided is not valid.
        </p>

        <Link href="/dashboard" className="mt-4 text-blue-500 underline">
          Back to search
        </Link>
      </div>
    );
  }

  return <TokenDashboard contractId={contractId} />;
}