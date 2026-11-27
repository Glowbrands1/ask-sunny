import "server-only";

import type { AuthenticatedIdentity } from "@/lib/auth/types";
import { activePermissionMatrix, canAccessAdminConsole, hasPermission } from "@/lib/permissions";
import { reportingScopeOf } from "@/lib/reporting/scope/authorized-salons";
import { salonByNumber } from "@/data/salons";
import { meetingEventsFromHub } from "./hub";
import { mergeSources } from "./merge";
import { validRange } from "./range";
import { followUpEvents, hrEvents, reminderEvents, reviewsEvents, reviewsSchedule, type FollowUpFact, type HrFact } from "./sources";
import { listVisibleReminders } from "./reminders.server";
import type { CalendarEvent, CalendarView, SourceResult } from "./types";

/**
 * ONE PERSON'S CALENDAR, for the /calendar page, the AI's read_calendar and the Leadership Hub's signed read
 * (POST /api/partner/calendar). Everything is read at call time from where it already lives, as this person:
 *
 * - Follow-ups: the Overview's queue for this account (`pageFormsAccess` + `readFollowUpQueue`), so exactly the forms
 *   the forms pages show them, and the one overdue rule (`followUpState`).
 * - HR approvals: HR's queue for an approver (only the forms still waiting on HR's decision, `needsHrDecision`: a form
 *   sent back or rejected is waiting on the manager and is off HR's calendar, as it is off HR's count and bell); for an
 *   administrator, those same forms as "With HR" (the owner, 27 Nov 2026: "all admins and [HR] can see this and the
 *   creator"); otherwise only the forms this person sent to HR (`readHrApprovalsFor`).
 * - Google Reviews: a weekly check per salon the person covers, only with `view_google_reviews`.
 * - Reminders: their own and their team's.
 * - L10 meetings and Hub reminders: from the Leadership Hub (`includeHub`), never stored here.
 * A source that fails adds a note and the others still show. Never time off; never Ask Bubbles' data.
 */
export type CalendarFor = { ok: true; view: CalendarView } | { ok: false; reason: "forbidden" | "invalid" };

export async function loadCalendarFor(
  identity: AuthenticatedIdentity,
  range: { from: string; to: string },
  /** includeHolidays: US holidays (src/config/holidays.ts) for this person's own calendar; never in a partner answer. */
  options: { origin: string; includeHub: boolean; includeHolidays?: boolean; now?: Date },
): Promise<CalendarFor> {
  if (!validRange(range.from, range.to)) return { ok: false, reason: "invalid" };
  const matrix = activePermissionMatrix();
  if (!identity.verified || !hasPermission(matrix, identity.role, "view_overview")) return { ok: false, reason: "forbidden" };
  const now = options.now ?? new Date();
  const today = now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const { origin } = options;

  const attempt = async (read: () => Promise<CalendarEvent[]>): Promise<SourceResult> => {
    try {
      return { source: "ask-sunny", state: "ok", events: await read() };
    } catch {
      return { source: "ask-sunny", state: "failed" };
    }
  };

  /**
   * WHO SEES THE EMPLOYEE'S NAME on a calendar entry for a form (the owner, 27 Nov 2026: "all admins and wren can see this
   * and the creator but for others they wont see the name"): admins (canAccessAdminConsole), HR approvers (an unrevoked row
   * in form_hr_approvers, resolveHrApprover) and the person who created the form. Everyone else gets the entry without the
   * name, without a link that would show it (Form Monitoring lists names), and marked nameHidden. Decided here, on the
   * server, before anything reaches a page or the AI.
   */
  const seesEveryName = (async () => {
    if (canAccessAdminConsole(identity.role)) return true;
    const { resolveHrApprover } = await import("@/lib/forms/hr-approval-approvers");
    return resolveHrApprover(identity.subject);
  })().catch(() => false);
  const mayNameEmployee = async (createdBy: string | null | undefined) => (createdBy && createdBy === identity.subject) || (await seesEveryName);

  const followUps = attempt(async () => {
    const [{ pageFormsAccess }, { readFollowUpQueue }, { followUpState }] = await Promise.all([
      import("@/lib/forms/page-scope"),
      import("@/lib/forms/follow-up-queue"),
      import("@/lib/forms/follow-up"),
    ]);
    const access = await pageFormsAccess(identity);
    const readsExit = hasPermission(matrix, identity.role, "create_exit_form");
    const queue = await readFollowUpQueue(access, { readsExit, today });
    const everyName = await seesEveryName;
    const facts: FollowUpFact[] = queue.forms.flatMap((f) =>
      f.followUpDate
        ? [
            {
              id: f.id,
              employeeName: f.employeeName,
              templateName: f.templateName,
              locationName: f.locationName,
              followUpDate: f.followUpDate,
              overdue: followUpState(f, today) === "overdue",
              ...(everyName || f.createdBy === identity.subject ? {} : { nameHidden: true }),
            },
          ]
        : [],
    );
    return followUpEvents(facts, today, origin);
  });

  const hr = attempt(async () => {
    const [{ readHrApprovalsFor, listHrQueue, needsHrDecision }, { overdueFrom, isOverdue }] = await Promise.all([import("@/lib/forms/hr-approval"), import("@/lib/forms/hr-approval-rules")]);
    const read = await readHrApprovalsFor(identity.subject, identity.verified, now);
    const due = (at: string | null) => (at ? overdueFrom(new Date(at)).date : today);
    let facts: HrFact[] = [];
    if (read.kind === "hr") {
      facts = read.queue.filter(needsHrDecision).map((r) => ({ id: r.id, line: r.line, dueDate: due(r.requestedAt), overdue: r.overdue, locationName: r.locationName, label: "Approve" }));
    } else if (read.kind === "manager") {
      facts = read.forms
        .filter((r) => r.state === "pending" || r.state === "changes_requested")
        .map((r) => ({ id: r.id, line: r.line, bareLine: r.bareLine, createdBy: r.createdBy, dueDate: due(r.requestedAt), overdue: r.state === "pending" && isOverdue(r.requestedAt, now), label: r.state === "pending" ? "With HR" : "Changes requested" }));
      // Someone HR sent it to who did not create it (and is no admin) sees it without the name.
      facts = await Promise.all(
        facts.map(async ({ bareLine, createdBy, ...f }: HrFact & { bareLine?: string; createdBy?: string | null }) =>
          (await mayNameEmployee(createdBy)) || !bareLine ? f : { ...f, line: bareLine, nameHidden: true },
        ),
      );
    }
    // An administrator who is not an HR approver sees what is waiting on HR (with the name), besides their own forms.
    if (read.kind !== "hr" && read.kind !== "off" && identity.verified && canAccessAdminConsole(identity.role)) {
      const queue = await listHrQueue({ id: identity.subject, role: null, verified: true, scope: null, visibility: null, hrApprover: true } as never, now);
      const mine = new Set(facts.map((f) => f.id));
      facts = [
        ...facts,
        ...queue
          .filter((r) => needsHrDecision(r) && !mine.has(r.id))
          .map((r) => ({ id: r.id, line: r.line, dueDate: due(r.requestedAt), overdue: r.overdue, locationName: r.locationName, label: "With HR" })),
      ];
    }
    return hrEvents(facts, today, origin);
  });

  const scope = reportingScopeOf(identity.scope);
  const reviews = attempt(async () => {
    if (!hasPermission(matrix, identity.role, "view_google_reviews")) return [];
    const salons = scope.unrestricted
      ? ({ all: true } as const)
      : ({ all: false, salons: scope.salonNumbers.map((n) => ({ number: n, name: salonByNumber(n)?.name ?? `Salon ${n}` })) } as const);
    return reviewsEvents(salons, range.from, range.to, reviewsSchedule(process.env), origin);
  });

  const reminders = attempt(async () => {
    const rows = await listVisibleReminders({ subject: identity.subject, coverage: scope.unrestricted ? null : scope.salonNumbers, manager: true }, range);
    return reminderEvents(rows, identity.subject, origin);
  });

  const hub: Promise<SourceResult> = options.includeHub ? meetingEventsFromHub(identity.email, range) : Promise.resolve({ source: "leadership-hub", state: "off" });

  const holidays: Promise<SourceResult> = (async () => {
    if (!options.includeHolidays) return { source: "ask-sunny", state: "off" } as SourceResult;
    const { holidaysBetween, holidayId, holidayTitle } = await import("./holidays");
    const events: CalendarEvent[] = holidaysBetween(range.from, range.to).map((h) => ({
      id: holidayId("sunny", h),
      source: "ask-sunny",
      kind: "holiday",
      title: holidayTitle(h),
      date: h.date,
      href: `${origin}/calendar`,
    }));
    return { source: "ask-sunny", state: "ok", events } as SourceResult;
  })();

  const results = await Promise.all([followUps, hr, reviews, reminders, hub, holidays]);
  return { ok: true, view: mergeSources(range.from, range.to, results) };
}
