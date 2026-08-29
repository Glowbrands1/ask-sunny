import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { ReportsScreen } from "@/features/reports/reports-screen";

export const metadata: Metadata = {
  title: "Reports & Analytics",
};

export default function ReportsPage() {
  return (
    <PermissionGate permission="view_reports">
      <ReportsScreen />
    </PermissionGate>
  );
}
