import type { Metadata } from "next";

import { FormsAccessNotice } from "@/features/forms/forms-gate";
import { Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell } from "@/components/ui/layout";
import { SYNTHETIC_DATA_NOTICE, formsIdentityIsUnverified } from "@/lib/forms/access";
import { businessToday } from "@/lib/forms/business-date";
import { attentionSummary, parseFollowUpFilter } from "@/lib/forms/follow-up";
import {
  findDemoInstances,
  isDemoInstance,
  listInstances,
  listOutstandingFollowUps,
  type InstanceView,
} from "@/lib/forms/instances";
import {
  MonitoringTable,
  type MonitoredForm,
  type MonitoringView,
} from "@/features/forms/monitoring-table";
import { requirePagePermission } from "@/lib/auth/page";

export const metadata: Metadata = { title: "Form Monitoring" };
export const dynamic = "force-dynamic";

/**
 * FORM MONITORING, read from the database rather than from this browser.
 *
 * The prototype listed what the current browser happened to have created, which
 * meant every manager saw a different history and none of it survived a device
 * change. This reads the record — and it is the same record the Overview's
 * follow-up card reads, through the same module, which is what stops the two
 * screens disagreeing.
 *
 * `force-dynamic` is what makes it live: every navigation and every
 * `router.refresh()` after a write re-reads Supabase, so no cached count can
 * outlive the change that invalidated it. No realtime subscription is used —
 * see the note in the Overview page.
 */
export default async function FormMonitoringPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; followup?: string }>;
}) {
  await requirePagePermission("view_form_monitoring");

  const { view: requestedView, followup: requestedFollowUp } = await searchParams;
  /*
   * Both filters come from the URL so a view survives a refresh and can be
   * linked to, and both are narrowed here rather than trusted — an unknown
   * value shows the default rather than erroring.
   */
  const view: MonitoringView =
    requestedView === "archived" || requestedView === "all" ? requestedView : "active";
  const followUp = parseFollowUpFilter(requestedFollowUp);

  /*
   * TODAY IS RESOLVED ONCE, ON THE SERVER, in the business timezone — see
   * `business-date.ts` for why not UTC and why not the demo anchor. Passing the
   * same string to every derivation means a row's badge, the pill counts and
   * the banner cannot be computed against three slightly different "todays".
   */
  const today = businessToday();

  let forms: MonitoredForm[] = [];
  let attention = { overdue: 0, dueThisWeek: 0, needsAttention: 0 };
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
      followedUpAt: instance.followedUpAt,
      followedUpBy: instance.followedUpBy,
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
     * The banner counts OUTSTANDING WORK ACROSS THE ACTIVE SET, from the same
     * query the Overview uses — not from `forms`, which is shelf-filtered. A
     * manager looking at Followed up still needs to be told what is overdue.
     */
    attention = attentionSummary(await listOutstandingFollowUps(), today);

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
            followUp={followUp}
            today={today}
            attention={attention}
            demo={demo}
          />
        )}
      </PageShell>
    </>
  );
}
