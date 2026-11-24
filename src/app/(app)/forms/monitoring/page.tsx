import type { Metadata } from "next";

import { FormsAccessNotice } from "@/features/forms/forms-gate";
import { Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell } from "@/components/ui/layout";
import { SYNTHETIC_DATA_NOTICE, formsIdentityIsUnverified } from "@/lib/forms/access";
import { businessToday } from "@/lib/business-date";
import { attentionSummary, parseFollowUpFilter } from "@/lib/forms/follow-up";
import {
  findDemoInstances,
  isDemoInstance,
  listInstances,
  listOutstandingFollowUps,
  type InstanceView,
} from "@/lib/forms/instances";
import { privateAwareLimit, privateCreatorsActive } from "@/lib/forms/private-creators";
import {
  MonitoringTable,
  type MonitoredForm,
  type MonitoringView,
} from "@/features/forms/monitoring-table";
import { pageCan, requirePagePermission } from "@/lib/auth/page";
import {
  actorMaySeeInstance,
  instanceListFilterFor,
  withoutUnreadable,
} from "@/lib/forms/instance-scope";
import { pageFormsAccess } from "@/lib/forms/page-scope";
import type { Permission } from "@/types";
import { HrApprovalTabs, HrQueueList, MyFormsWithHr, SiblingHrQueueList } from "@/features/forms/hr-approval-lists";
import { fetchSiblingHrQueue, type SiblingHrQueue } from "@/lib/partner/sibling-hr-queue";
import { hrQueueSummary, listHrQueue, listMyFormsWithHr, type HrQueueRow, type MyHrFormRow } from "@/lib/forms/hr-approval";

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
  searchParams: Promise<{ view?: string; followup?: string; app?: string }>;
}) {
  const identity = await requirePagePermission("view_form_monitoring");

  const { view: requestedView, followup: requestedFollowUp, app: requestedApp } = await searchParams;
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

  /*
   * WHOSE FORMS. Decided on the server from the verified identity
   * (`resolveFormsVisibility`): administrators and designated accounts read
   * every salon; everyone else reads only their home salon, and an account with
   * none reads nothing and is told why. Every read below is narrowed by it —
   * rows, the overdue banner and the demo-sweep count.
   */
  const access = await pageFormsAccess(identity);
  const mayRead = (instance: Parameters<typeof actorMaySeeInstance>[1]) =>
    actorMaySeeInstance(access.actor, instance);

  /*
   * HR APPROVAL (FORMS_HR_APPROVAL_ENABLED). HR gets a "Pending HR approval" tab (`?view=hr`) listing every form
   * waiting for them; a manager sees their own forms HR has not approved yet. Nobody else sees either: a form waiting
   * for HR is not in anybody else's list at all (`instanceListFilterFor`).
   */
  const isHr = access.actor.hrApprover === true;
  const hrView = isHr && requestedView === "hr";
  let hrQueue: HrQueueRow[] = [];
  let hrSummary: { pending: number; overdue: number } | null = null;
  let myWithHr: MyHrFormRow[] = [];
  /*
   * THE SIBLING APP'S QUEUE, AS A TAB (owner, 23 Nov 2026: "1 tab for sunny 1 tab for bubbles"; then, of a link to the
   * sibling's page: "i dont want the sunny approval in a different page and link, just a tab pls"). For a verified HR
   * approver, asked of the sibling's server with this identity's email (`fetchSiblingHrQueue`), on every view so the
   * tab carries its count; listed here, on `?view=hr&app=sibling`. "off" (no shared secret) shows no tab.
   */
  let sibling: SiblingHrQueue = { status: "off" };
  const siblingView = hrView && requestedApp === "sibling";
  try {
    if (isHr) {
      const email = access.actor.verified && identity?.verified === true && identity.email ? identity.email : null;
      [hrSummary, hrQueue, sibling] = await Promise.all([
        hrQueueSummary(access.actor),
        hrView ? listHrQueue(access.actor) : Promise.resolve<HrQueueRow[]>([]),
        email ? fetchSiblingHrQueue(email) : Promise.resolve<SiblingHrQueue>({ status: "off" }),
      ]);
    }
    myWithHr = await listMyFormsWithHr(access.actor);
  } catch {
    // A failed approval read leaves the ordinary list as it is; the tab and the card simply do not show.
  }

  if (!access.noSalon) try {
    /*
     * EXIT FORMS ONLY FOR THOSE WHO MAY CREATE THEM. The Resignation/Exit Form
     * carries payroll, bonus, minimum-wage and rehire answers, so a reader
     * without `create_exit_form` does not get its rows, its counts or its
     * follow-ups. See `withoutUnreadable`.
     */
    const readsExit = await pageCan("create_exit_form");
    const holds = (permission: Permission) => (permission === "create_exit_form" ? readsExit : false);
    const instances = withoutUnreadable(
      // PRIVATE_CREATOR_FORMS: over-read, then trim to the default page of 200; off, as before.
      await listInstances(view satisfies InstanceView, privateCreatorsActive() ? privateAwareLimit(200) : undefined, instanceListFilterFor(access.actor)),
      holds,
    ).filter(mayRead).slice(0, 200);
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
    attention = attentionSummary(
      withoutUnreadable(await listOutstandingFollowUps(privateAwareLimit(50), access.locationIds, access.ownCreatedBy), holds).filter(mayRead).slice(0, 50),
      today,
    );

    /*
     * Counted on the server across EVERY shelf, so the sweep button can state a
     * real number. Counting the rows on screen would be wrong — this page is
     * filtered, and the count would change with the view.
     */
    const sweep = await findDemoInstances();
    demo = {
      deletable: sweep.deletable.filter(mayRead).length,
      protected: sweep.protected.filter(mayRead).length,
    };
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

        {hrSummary ? (
          <HrApprovalTabs
            active={siblingView ? "sibling" : hrView ? "hr" : "all"}
            pending={hrSummary.pending}
            overdue={hrSummary.overdue}
            sibling={
              sibling.status === "off"
                ? null
                : sibling.status === "ok"
                  ? {
                      name: sibling.app,
                      // Waiting for this approver, or sent back and replied to since: what the sibling counts.
                      pending: sibling.approver ? sibling.forms.filter((row) => row.state === "pending" || row.managerReplied).length : 0,
                    }
                  : { name: null, pending: null }
            }
          />
        ) : null}
        {!hrView ? <MyFormsWithHr rows={myWithHr} /> : null}

        {hrView && siblingView && sibling.status !== "off" ? (
          <SiblingHrQueueList queue={sibling} />
        ) : hrView ? (
          <HrQueueList rows={hrQueue} />
        ) : access.noSalon ? (
          <Notice tone="attention" title="No home salon assigned">
            Form Monitoring shows the forms for your own salon, and your account has no salon assigned yet. An administrator can set it in User Management.
          </Notice>
        ) : failure ? (
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
