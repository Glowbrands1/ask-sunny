import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { IntegrationsScreen } from "@/features/admin/integrations-screen";
import { requirePagePermission } from "@/lib/auth/page";

export const metadata: Metadata = {
  title: "Integrations",
};

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  await requirePagePermission("manage_integrations");

  return (
    <PermissionGate permission="manage_integrations" adminOnly>
      <IntegrationsScreen />
    </PermissionGate>
  );
}
