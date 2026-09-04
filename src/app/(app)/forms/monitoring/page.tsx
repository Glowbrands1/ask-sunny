import type { Metadata } from "next";

import { FormsAccessNotice } from "@/features/forms/forms-gate";
import { Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell } from "@/components/ui/layout";
import { SYNTHETIC_DATA_NOTICE, formsIdentityIsUnverified } from "@/lib/forms/access";
import {
  findDemoInstances,
  isDemoInstance,
  listInstances,
  type InstanceView,
} from "@/lib/forms/instances";
import {
  MonitoringTable,
  type MonitoredForm,
  type MonitoringView,
} from "@/features/forms/monitoring-table";

export const metadata: Metadata = { title: "Form Monitoring" };
export const dynamic = "force-dynamic";

/**
 * FORM MONITORING, read from the database rather than from this browser.
 *
 * The prototype listed what the current browser happened to have created, which
 * meant every manager saw a different history and none of it survived a device
 * change. This reads the record.
 */
export default async function FormMonitoringPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view: requested } = await searchParams;
  /*
   * The shelf comes from the URL so it survives a refresh and can be linked to,
   * and it is narrowed to the three known values here rather than trusted — an
   * unknown `?view=` shows the active list rather than erroring.
   */
  const view: MonitoringView =
    requested === "archived" || requested === "all" ? requested : "active";

  let forms: MonitoredForm[] = [];
  let demo = { deletable: 0, protected: 0 };
  let failure: string | null = null;

  try {
    const instances = await listInstances(view satisfies InstanceView);
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
      archivedAt: instance.archivedAt,
      /*
       * PROVENANCE, NOT A NAME MATCH. `isDemoInstance` reads the `demo:` actor
       * prefix the server wrote when the row was created. A real employee
       * called "… (test)" is not demo data and is not marked as such here.
       */
      isDemo: isDemoInstance(instance),
      updatedAt: instance.updatedAt,
    }));

    /*
     * Counted on the server across EVERY shelf, so the sweep button can state a
     * real number. Counting the rows on screen would be wrong — this page is
     * filtered, and the count would change with the view.
     */
    const sweep = await findDemoInstances();
    demo = { deletable: sweep.deletable.length, protected: sweep.protected.length };
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
            view={view}
            demo={demo}
          />
        )}
      </PageShell>
    </>
  );
}
