import { accountNames } from "@/lib/forms/follow-up-owner";
import type { Metadata } from "next";

import { FormsAccessNotice } from "@/features/forms/forms-gate";
import { Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell } from "@/components/ui/layout";
import { SYNTHETIC_DATA_NOTICE, formsIdentityIsUnverified } from "@/lib/forms/access";
import { businessToday } from "@/lib/business-date";
import { parseFollowUpFilter } from "@/lib/forms/follow-up";
import { readFollowUpQueue } from "@/lib/forms/follow-up-queue";
import {
  findDemoInstances,
  isDemoInstance,
  listInstances,
  type InstanceRow,
} from "@/lib/forms/instances";
import { privateAwareLimit, privateCreatorsActive } from "@/lib/forms/private-creators";
import {
  MonitoringTable,
  type MonitoredForm,
} from "@/features/forms/monitoring-table";
import { pageCan, requirePagePermission } from "@/lib/auth/page";
import {
  actorMaySeeInstance,
  instanceListFilterFor,
  withoutUnreadable,
} from "@/lib/forms/instance-scope";
import { pageFormsAccess } from "@/lib/forms/page-scope";
import { mayDeleteFinalizedForm } from "@/lib/forms/finalized-delete";
import type { Permission } from "@/types";
import { HrApprovalTabs, HrApprovedList, HrQueueList, MyFormsWithHr, SiblingHrQueueList } from "@/features/forms/hr-approval-lists";
import { fetchSiblingHrQueue, type SiblingHrQueue } from "@/lib/partner/sibling-hr-queue";
import { hrQueueSummary, listHrApproved, listHrQueue, listMyFormsWithHr, type HrApprovedRow, type HrQueueRow, type MyHrFormRow } from "@/lib/forms/hr-approval";
import { mayReadHrDecision } from "@/lib/forms/hr-approval-rules";
import { ACTIVE_BRAND } from "@/lib/brand";
import { mayUseEmployeeFormSearch, parseEmployeeSearchStatus, searchFormsByEmployee, type EmployeeFormSearch } from "@/lib/forms/employee-form-search";
import { EmployeeFormSearchBox, EmployeeFormSearchResults } from "@/form-revisions/employee-form-search";
import { noteAppUsage } from "@/lib/analytics/app-usage";

export const metadata: Metadata = { title: "Form Monitoring" };
export const dynamic = "force-dynamic";

/** The list's page of rows: the newest this many forms. */
const LIST_LIMIT = 200;

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
  searchParams: Promise<{ view?: string; followup?: string; app?: string; employee?: string; status?: string }>;
}) {
  const identity = await requirePagePermission("view_form_monitoring");
  noteAppUsage(identity, "form_monitoring");

  const { view: requestedView, followup: requestedFollowUp, app: requestedApp, employee: requestedEmployee, status: requestedStatus } = await searchParams;
  /*
   * The follow-up filter comes from the URL so a view survives a refresh and can be
   * linked to, and it is narrowed here rather than trusted — an unknown
   * value shows the default rather than erroring.
   */
  const followUp = parseFollowUpFilter(requestedFollowUp);

  /*
   * TODAY IS RESOLVED ONCE, ON THE SERVER, in the business timezone — see
   * `business-date.ts` for why not UTC and why not the demo anchor. Passing the
   * same string to every derivation means a row's badge, the pill counts and
   * the banner cannot be computed against three slightly different "todays".
   */
  const today = businessToday();

  let forms: MonitoredForm[] = [];
  /* The follow-up queue every screen counts (`readFollowUpQueue`): the banner, and the Open and Overdue pills and lists. */
  let outstanding: MonitoredForm[] = [];
  let outstandingExcluded = 0;
  /** Whether the list read stopped at its page of rows, so the other pills count only those. */
  let listCapped = false;
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
  // HR's Approved tab, this app's and the sibling's (owner, 24 Nov 2026), on `?view=hr&app=approved`.
  const approvedView = hrView && requestedApp === "approved";
  let hrApproved: HrApprovedRow[] = [];
  try {
    if (isHr) {
      const email = access.actor.verified && identity?.verified === true && identity.email ? identity.email : null;
      [hrSummary, hrQueue, sibling, hrApproved] = await Promise.all([
        hrQueueSummary(access.actor),
        hrView && !approvedView ? listHrQueue(access.actor) : Promise.resolve<HrQueueRow[]>([]),
        email ? fetchSiblingHrQueue(email) : Promise.resolve<SiblingHrQueue>({ status: "off" }),
        approvedView ? listHrApproved(access.actor) : Promise.resolve<HrApprovedRow[]>([]),
      ]);
    }
    myWithHr = await listMyFormsWithHr(access.actor);
  } catch {
    // A failed approval read leaves the ordinary list as it is; the tab and the card simply do not show.
  }

  /*
   * FIND AN EMPLOYEE'S FORMS (leadership meeting, 24 Nov 2026): HR and administrators only, `?employee=<name>`. Read
   * on its own so a person's older forms are found past the list's 200 rows, and narrowed by the list's own filter and
   * per-row check, so it can never show a form the list would not. See `employee-form-search.ts`.
   */
  const employeeSearchOffered = mayUseEmployeeFormSearch(access.actor) && !hrView && !access.noSalon;
  const employeeQuery = employeeSearchOffered && typeof requestedEmployee === "string" ? requestedEmployee.trim().slice(0, 120) : "";
  const employeeStatus = parseEmployeeSearchStatus(requestedStatus);
  let employeeSearch: EmployeeFormSearch | null = null;
  let employeeSearchFailure: string | null = null;
  if (employeeQuery) {
    try {
      const readsExit = await pageCan("create_exit_form");
      const holds = (permission: Permission) => (permission === "create_exit_form" ? readsExit : false);
      employeeSearch = await searchFormsByEmployee(access.actor, employeeQuery, {
        filter: instanceListFilterFor(access.actor),
        status: employeeStatus,
        keep: (rows) => withoutUnreadable(rows, holds).filter(mayRead),
      });
    } catch (error) {
      employeeSearchFailure = (error as Error).message;
    }
  }

  if (!access.noSalon && !employeeQuery) try {
    /*
     * EXIT FORMS ONLY FOR THOSE WHO MAY CREATE THEM. The Resignation/Exit Form
     * carries payroll, bonus, minimum-wage and rehire answers, so a reader
     * without `create_exit_form` does not get its rows, its counts or its
     * follow-ups. See `withoutUnreadable`.
     */
    const readsExit = await pageCan("create_exit_form");
    const holds = (permission: Permission) => (permission === "create_exit_form" ? readsExit : false);
    // PRIVATE_CREATOR_FORMS: over-read, then trim to the page of 200; one row more than the page either way, so the
    // page can say when it stopped (QA, 24 Nov 2026: a count of loaded rows must say that is what it is).
    const requested = privateCreatorsActive() ? privateAwareLimit(LIST_LIMIT + 1) : LIST_LIMIT + 1;
    const read = await listInstances(requested, instanceListFilterFor(access.actor));
    const instances = withoutUnreadable(read, holds).filter(mayRead);
    listCapped = read.length >= requested || instances.length > LIST_LIMIT;
    instances.splice(LIST_LIMIT);
    const toMonitored = (instance: InstanceRow): MonitoredForm => ({
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
      /*
       * PROVENANCE, NOT A NAME MATCH. `isDemoInstance` reads the `demo:` actor
       * prefix the server wrote when the row was created. A real employee
       * called "… (test)" is not demo data and is not marked as such here.
       */
      isDemo: isDemoInstance(instance),
      /*
       * "Approved by HR" for the form's creator, its senders and HR (owner, 24 Nov 2026: "the manager will be able to see
       * that in form monitoring with a note "approved""). Nobody else is told it went through HR (`mayReadHrDecision`).
       */
      hrApproved: instance.hrApprovalState === "approved" && mayReadHrDecision(access.actor, instance),
      followUpOwner: instance.followUpOwner ?? null,
      updatedAt: instance.updatedAt,
    });
    forms = instances.map(toMonitored);

    /*
     * THE BANNER AND THE OPEN AND OVERDUE PILLS COUNT ONE QUEUE (QA, 24 Nov 2026: the banner said 19 overdue, the
     * Overdue pill 8 and Open 6, because the pills counted the 200 newest rows and the banner the first 50
     * follow-ups). `readFollowUpQueue` is every outstanding follow-up this reader may open, uncapped, test records
     * left out, the same forms the Overview and the rail badge count. A manager looking at Followed up still needs to
     * be told what is overdue.
     */
    const queue = await readFollowUpQueue(access, { readsExit, today });
    attention = queue.attention;
    outstanding = queue.forms.map(toMonitored);
    outstandingExcluded = queue.excluded;

    // WHO OWNS EACH FOLLOW-UP (the owner, 27 Nov 2026): the name of the person the creator handed it to.
    const owners = await accountNames([...forms, ...outstanding].map((form) => form.followUpOwner));
    const named = (form: MonitoredForm): MonitoredForm => (form.followUpOwner ? { ...form, followUpOwnerName: owners.get(form.followUpOwner) ?? "Another manager" } : form);
    forms = forms.map(named);
    outstanding = outstanding.map(named);

    /*
     * Counted on the server, so the sweep button can state a
     * real number. Counting the rows on screen would be wrong — this page is
     * capped, and the count would change.
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
            active={approvedView ? "approved" : siblingView ? "sibling" : hrView ? "hr" : "all"}
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

        {approvedView ? (
          <HrApprovedList
            appName={ACTIVE_BRAND.productName}
            rows={hrApproved.map((row) => ({ line: row.line, from: row.createdByName, approvedAt: row.approvedAt, approvedBy: row.approvedByName, href: `/forms/hr-approval/${row.id}` }))}
            sibling={sibling}
          />
        ) : hrView && siblingView && sibling.status !== "off" ? (
          <SiblingHrQueueList queue={sibling} />
        ) : hrView ? (
          <HrQueueList rows={hrQueue} />
        ) : access.noSalon ? (
          <Notice tone="attention" title="No home salon assigned">
            Form Monitoring shows the forms for your own salon, and your account has no salon assigned yet. An administrator can set it in User Management.
          </Notice>
        ) : employeeQuery ? (
          <>
            <EmployeeFormSearchBox query={employeeQuery} status={employeeStatus} />
            <EmployeeFormSearchResults
              query={employeeQuery}
              searchable={employeeSearchFailure !== null || (employeeSearch?.words.length ?? 0) > 0}
              rows={employeeSearch?.results ?? []}
              capped={employeeSearch?.capped ?? false}
              failure={employeeSearchFailure}
              filtered={employeeStatus !== "all"}
            />
          </>
        ) : failure ? (
          <Notice tone="attention" title="Form history could not be read">
            {failure}
          </Notice>
        ) : (
          <>
          <MonitoringTable
            forms={forms}
            notice={formsIdentityIsUnverified() ? SYNTHETIC_DATA_NOTICE : null}
            followUp={followUp}
            today={today}
            attention={attention}
            outstanding={outstanding}
            outstandingExcluded={outstandingExcluded}
            listLimit={listCapped ? LIST_LIMIT : null}
            demo={demo}
            mayDeleteFinalized={mayDeleteFinalizedForm(identity)}
            search={employeeSearchOffered ? <EmployeeFormSearchBox query="" className="" /> : null}
          />
          </>
        )}
      </PageShell>
    </>
  );
}
