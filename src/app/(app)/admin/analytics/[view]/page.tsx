import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PermissionGate } from "@/components/permission-gate";
import {
  AnalyticsScreen,
  isAnalyticsView,
} from "@/features/admin/analytics/analytics-screen";
import { loadAnalyticsPage } from "@/features/admin/analytics/load";
import { requirePagePermission } from "@/lib/auth/page";

export const metadata: Metadata = {
  title: "Analytics",
};

export const dynamic = "force-dynamic";

/**
 * The three deeper views, each at its own URL so a filtered By Location is a
 * link somebody can send rather than a state somebody has to be talked into.
 *
 * An unknown view is a 404 rather than a silent fall back to Overview: a
 * mistyped URL that quietly renders a different page is how somebody ends up
 * quoting the wrong table in a meeting.
 */
export default async function AnalyticsViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ view: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("view_analytics");

  const { view } = await params;
  if (!isAnalyticsView(view) || view === "overview") notFound();

  const props = await loadAnalyticsPage(view, await searchParams);

  return (
    <PermissionGate permission="view_analytics" adminOnly>
      <AnalyticsScreen {...props} />
    </PermissionGate>
  );
}
