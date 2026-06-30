"use client";

import type { VestingScheduleInfo } from "@/lib/stellar";
import { VestingCard } from "./VestingCard";
import { VestingLookup } from "./VestingLookup";

export function VestingSection({
  vestingContractId,
  onVestingContractChange,
  onLookup,
  loading,
  error,
  schedules,
  currentLedger,
}: {
  vestingContractId: string;
  onVestingContractChange: (value: string) => void;
  onLookup: () => void;
  loading: boolean;
  error: string | null;
  schedules: VestingScheduleInfo[];
  currentLedger: number;
}) {
  return (
    <section aria-label="Vesting schedules" className="mb-10">
      <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-500">
        Vesting Schedules
      </h2>
      <VestingLookup
        vestingContractId={vestingContractId}
        onChange={onVestingContractChange}
        onLookup={onLookup}
        loading={loading}
        error={error}
      />

      {schedules.length > 0 && (
        <div className="mt-4 space-y-4">
          {schedules.map((schedule) => (
            <VestingCard
              key={schedule.scheduleIndex ?? 0}
              schedule={schedule}
              contractId={vestingContractId}
              currentLedger={currentLedger}
            />
          ))}
        </div>
      )}
    </section>
  );
}
