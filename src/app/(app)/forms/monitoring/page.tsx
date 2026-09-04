import type { Metadata } from "next";

import { FormsAccessNotice } from "@/features/forms/forms-gate";
import { Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell } from "@/components/ui/layout";
import { SYNTHETIC_DATA_NOTICE, formsIdentityIsUnverified } from "@/lib/forms/access";
import { listInstances } from "@/lib/forms/instances";
import { MonitoringTable, type MonitoredForm } from "@/features/forms/monitoring-table";

export const metadata: Metadata = { title: "Form Monitoring" };
export const dynamic = "force-dynamic";

/**
 * FORM MONITORING, read from the database rather than from this browser.
 *
 * The prototype listed what the current browser happened to have created, which
 * meant every manager saw a different history and none of it survived a device
 * change. This reads the record.
 */
export default async function FormMonitoringPage() {
  let forms: MonitoredForm[] = [];
  let failure: string | null = null;

  try {
    const instances = await listInstances();
    forms = instances.map((instance) => ({
      id: instance.id,
      templateName: instance.templateName,
      templateShortName: instance.templateShortName,
      templateVersion: instance.templateVersion,
      variantKey: instance.variantKey,
      employeeName: instance.employeeName,
      locationName: instance.locationName,
      createdBy: instance.createdBy,
      createdByRole: instance.createdByRole,
      source: instance.source,
      status: instance.status,
      formDate: instance.formDate,
      followUpDate: instance.followUpDate,
      finalizedAt: instance.finalizedAt,
      exportedAt: instance.exportedAt,
      revisesInstanceId: instance.revisesInstanceId,
      updatedAt: instance.updatedAt,
    }));
  } catch (error) {
    failure = (error as Error).message;
  }

  return (
    <>
      <PageShell>
        <PageHeader
          eyebrow="Forms"
          title="Form Monitoring"
          description="Every form created in Ask Sunny, the template version it was filled from, and what is still outstanding."
        />

        <FormsAccessNotice permission="view_form_monitoring" />

        {failure ? (
          <Notice tone="attention" title="Form history could not be read">
            {failure}
          </Notice>
        ) : (
          <MonitoringTable
            forms={forms}
            notice={formsIdentityIsUnverified() ? SYNTHETIC_DATA_NOTICE : null}
          />
        )}
      </PageShell>
    </>
  );
}
