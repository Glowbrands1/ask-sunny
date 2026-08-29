import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { FormTemplatesScreen } from "@/features/forms/form-templates-screen";

export const metadata: Metadata = {
  title: "Form Templates",
};

export default function FormTemplatesPage() {
  return (
    <PermissionGate permission="manage_form_templates">
      <FormTemplatesScreen />
    </PermissionGate>
  );
}
