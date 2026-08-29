import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { IntegrationsScreen } from "@/features/admin/integrations-screen";

export const metadata: Metadata = {
  title: "Integrations",
};

export default function IntegrationsPage() {
  return (
    <PermissionGate permission="manage_integrations" adminOnly>
      <IntegrationsScreen />
    </PermissionGate>
  );
}
