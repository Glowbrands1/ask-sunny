import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PermissionGate } from "@/components/permission-gate";
import { isWovenView, loadWovenView, viewShowsPeople } from "@/features/admin/woven/load";
import { WovenViewScreen } from "@/features/admin/woven/woven-view-screen";
import { requirePagePermission } from "@/lib/auth/page";

export const metadata: Metadata = {
  title: "Woven Employee Sync",
};

export const dynamic = "force-dynamic";

/**
 * THE WOVEN TABS BEYOND THE OVERVIEW, each at its own URL.
 *
 *   directory · changes · mappings · preview   names and emails, or decisions
 *                                              about them → Manage integrations
 *                                              AND Manage users
 *   runs                                       counts only → Manage integrations
 *
 * The guards run on the SERVER, before anything is read, so a refused page
 * never fetches the rows it would have shown. `PermissionGate` is the second
 * line, for demo mode. Both permissions already exist; the permission matrix
 * is unchanged.
 *
 * An unknown view is a 404 rather than a silent fall back to the Overview.
 */
export default async function WovenViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ view: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("manage_integrations");

  const { view } = await params;
  if (!isWovenView(view)) notFound();
  const people = viewShowsPeople(view);
  if (people) await requirePagePermission("manage_users");

  const query = await searchParams;
  const props = await loadWovenView(view, query);

  const screen = <WovenViewScreen props={props} params={query} />;
  return (
    <PermissionGate permission="manage_integrations" adminOnly>
      {people ? <PermissionGate permission="manage_users">{screen}</PermissionGate> : screen}
    </PermissionGate>
  );
}
