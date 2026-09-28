import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { loadWovenSyncPage } from "@/features/admin/woven/load";
import { WovenSyncScreen } from "@/features/admin/woven/woven-sync-screen";
import { requirePagePermission } from "@/lib/auth/page";

export const metadata: Metadata = {
  title: "Woven Employee Sync",
};

export const dynamic = "force-dynamic";

/**
 * THE WOVEN EMPLOYEE SYNC SCREEN — `manage_integrations`, like every setup
 * surface here. The guard runs on the server before anything is read;
 * `PermissionGate` is the second line, for demo mode.
 */
export default async function WovenSyncPage() {
  await requirePagePermission("manage_integrations");

  const props = await loadWovenSyncPage();

  return (
    <PermissionGate permission="manage_integrations" adminOnly>
      <WovenSyncScreen {...props} />
    </PermissionGate>
  );
}
