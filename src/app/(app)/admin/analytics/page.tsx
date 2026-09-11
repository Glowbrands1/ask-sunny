import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { AnalyticsScreen } from "@/features/admin/analytics/analytics-screen";
import { loadAnalyticsPage } from "@/features/admin/analytics/load";
import { requirePagePermission } from "@/lib/auth/page";

export const metadata: Metadata = {
  title: "Analytics",
};

/*
 * LIVE ON EVERY REQUEST, like the reports. Adoption figures that a manager is
 * about to act on must not be served from a cache built before the action they
 * are checking for.
 */
export const dynamic = "force-dynamic";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("view_analytics");
  const props = await loadAnalyticsPage("overview", await searchParams);

  return (
    <PermissionGate permission="view_analytics" adminOnly>
      <AnalyticsScreen {...props} />
    </PermissionGate>
  );
}
