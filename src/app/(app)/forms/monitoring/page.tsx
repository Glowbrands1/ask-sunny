import { Suspense } from "react";
import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { FormMonitoringScreen } from "@/features/forms/form-monitoring-screen";

export const metadata: Metadata = {
  title: "Form Monitoring",
};

export default function FormMonitoringPage() {
  return (
    <PermissionGate permission="view_form_monitoring">
      <Suspense fallback={null}>
        <FormMonitoringScreen />
      </Suspense>
    </PermissionGate>
  );
}
