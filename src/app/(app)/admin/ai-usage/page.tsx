import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { AIUsageScreen } from "@/features/admin/ai-usage-screen";
import { requirePagePermission } from "@/lib/auth/page";

export const metadata: Metadata = {
  title: "AI Usage",
};

export const dynamic = "force-dynamic";

export default async function AIUsagePage() {
  await requirePagePermission("view_ai_usage");

  return (
    <PermissionGate permission="view_ai_usage" adminOnly>
      <AIUsageScreen />
    </PermissionGate>
  );
}
