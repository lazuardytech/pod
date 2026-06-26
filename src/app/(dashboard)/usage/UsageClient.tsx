"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CardSkeleton, RequestLogger, SegmentedControl, UsageStats } from "@/shared/components";
import MetricsLineChart from "./components/MetricsLineChart";
import RequestDetailsTab from "./components/RequestDetailsTab";

const PERIODS = [
  { value: "24h", label: "Today" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
];

export default function UsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsageContent />
    </Suspense>
  );
}

function UsageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [period, setPeriod] = useState("7d");

  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && ["overview", "logs", "details"].includes(tabFromUrl) ? tabFromUrl : "overview";

  const handleTabChange = (value) => {
    if (value === activeTab) return;
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.push(`/usage?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Tabs + period selector on same row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          options={[
            { value: "overview", label: "Overview" },
            { value: "details", label: "Details" },
          ]}
          value={activeTab}
          onChange={handleTabChange}
          size="sm"
          className="w-full sm:w-auto"
        />
        {activeTab === "overview" && (
          <SegmentedControl
            options={PERIODS}
            value={period}
            onChange={setPeriod}
            size="sm"
            className="w-full sm:w-auto"
          />
        )}
      </div>

      <>
        {activeTab === "overview" && (
          <Suspense fallback={<CardSkeleton />}>
            <MetricsLineChart period={period} />
            <UsageStats period={period} setPeriod={setPeriod} hidePeriodSelector />
          </Suspense>
        )}
        {activeTab === "logs" && <RequestLogger />}
        {activeTab === "details" && <RequestDetailsTab />}
      </>
    </div>
  );
}
