import { Suspense } from "react";
import type { Metadata } from "next";

import { OverviewScreen } from "@/features/dashboard/overview";
import {
  PerformanceOverview,
  PerformanceOverviewSkeleton,
} from "@/features/dashboard/performance-overview";

export const metadata: Metadata = {
  title: "Overview",
};

/**
 * The homepage reads live reporting data, so it is rendered per request.
 *
 * Only the Performance Overview card actually needs the database, and it is
 * wrapped in `<Suspense>` so the rest of the page — which is client state —
 * paints without waiting on Supabase. The fallback holds the card's dimensions,
 * so nothing below it moves when the figures arrive.
 */
export const dynamic = "force-dynamic";

export default function OverviewPage() {
  return (
    <OverviewScreen
      performanceOverview={
        <Suspense fallback={<PerformanceOverviewSkeleton />}>
          <PerformanceOverview />
        </Suspense>
      }
    />
  );
}
