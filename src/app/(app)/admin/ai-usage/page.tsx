import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { AIUsageScreen } from "@/features/admin/ai-usage-screen";

export const metadata: Metadata = {
  title: "AI Usage",
};

export default function AIUsagePage() {
  return (
    <PermissionGate permission="view_ai_usage" adminOnly>
      <AIUsageScreen />
    </PermissionGate>
  );
}
