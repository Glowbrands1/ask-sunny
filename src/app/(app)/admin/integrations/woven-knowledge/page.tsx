import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { loadWovenKnowledgePage } from "@/features/admin/woven-knowledge/load";
import { WovenKnowledgeScreen } from "@/features/admin/woven-knowledge/woven-knowledge-screen";
import { requirePagePermission } from "@/lib/auth/page";

export const metadata: Metadata = {
  title: "Woven Knowledge Sync",
};

export const dynamic = "force-dynamic";

/** Admin → Integrations → Woven Knowledge Sync. `manage_integrations`, like every setup surface. */
export default async function WovenKnowledgePage() {
  await requirePagePermission("manage_integrations");
  const props = await loadWovenKnowledgePage();
  return (
    <PermissionGate permission="manage_integrations" adminOnly>
      <WovenKnowledgeScreen {...props} />
    </PermissionGate>
  );
}
