import { z } from "zod";
import { addDays } from "./range";
import type { CalendarEvent, CalendarSource } from "./types";

/**
 * This app's own calendar events, built from what the existing pages already read (nothing is copied, nothing new is
 * decided here). Pure: the loaders in load.server.ts pass in the rows.
 *
 * - Follow-ups: the Overview's follow-up queue (`readFollowUpQueue`), with its one overdue rule (`followUpState`).
 * - HR approvals: HR's queue, or a manager's own forms with HR, due one business day after they were sent
 *   (`overdueFrom`, the reminder's own rule).
 * - Google Reviews: a weekly check per salon the person covers (CALENDAR_REVIEWS_WEEKDAY / _TIME, default Monday 9:30 CT).
 * - Reminders: the person's own, and their team's shared ones.
 * Time off is never an event.
 */
export const SOURCE: CalendarSource = "ask-sunny";

export interface FollowUpFact {
  readonly id: string;
  readonly employeeName: string;
  readonly templateName: string;
  readonly locationName: string | null;
  readonly followUpDate: string;
  readonly overdue: boolean;
  /** True: this person may not see the employee's name (see load.server.ts, mayNameEmployee). */
  readonly nameHidden?: boolean;
}

/** All-day "Employee · form" on the follow-up date, opening that employee's follow-ups in Form Monitoring. */
export function followUpEvents(forms: readonly FollowUpFact[], today: string, origin: string): CalendarEvent[] {
  return forms.map((f) => ({
    id: `sunny:follow-up:${f.id}`,
    source: SOURCE,
    kind: "form-follow-up" as const,
    title: (f.nameHidden ? f.templateName : `${f.employeeName} · ${f.templateName}`).slice(0, 300),
    date: f.followUpDate,
    status: f.overdue ? ("overdue" as const) : f.followUpDate === today ? ("due" as const) : ("upcoming" as const),
    ...(f.locationName ? { location: f.locationName } : {}),
    ...(f.nameHidden
      ? { href: `${origin}/calendar`, nameHidden: true }
      : { href: `${origin}/forms/monitoring?followup=${f.overdue ? "overdue" : "open"}&employee=${encodeURIComponent(f.employeeName)}` }),
  }));
}

export interface HrFact {
  readonly id: string;
  readonly line: string;
  /** The day HR's answer is due (one business day after it was sent, Central), YYYY-MM-DD. */
  readonly dueDate: string;
  readonly overdue: boolean;
  readonly locationName?: string | null;
  /** "Approve" for HR's queue, "With HR" for a manager's own form. */
  readonly label: string;
  /** True: `line` already leaves the employee's name out, and the entry does not open the form. */
  readonly nameHidden?: boolean;
}

export function hrEvents(rows: readonly HrFact[], today: string, origin: string): CalendarEvent[] {
  return rows.map((r) => ({
    id: `sunny:hr-approval:${r.id}`,
    source: SOURCE,
    kind: "hr-approval" as const,
    title: `${r.label}: ${r.line}`.slice(0, 300),
    date: r.dueDate,
    status: r.overdue ? ("overdue" as const) : r.dueDate === today ? ("due" as const) : ("upcoming" as const),
    ...(r.locationName ? { location: r.locationName } : {}),
    ...(r.nameHidden ? { href: `${origin}/calendar`, nameHidden: true } : { href: `${origin}/forms/hr-approval/${encodeURIComponent(r.id)}` }),
  }));
}

/** The weekly Google Reviews check: weekday 0 (Sunday) to 6 and a Central HH:MM, from the environment. */
export function reviewsSchedule(env: Record<string, string | undefined>): { weekday: number; time: string } {
  const day = Number(env.CALENDAR_REVIEWS_WEEKDAY);
  const time = env.CALENDAR_REVIEWS_TIME ?? "";
  return {
    weekday: Number.isInteger(day) && day >= 0 && day <= 6 && env.CALENDAR_REVIEWS_WEEKDAY?.trim() !== "" ? day : 1,
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : "09:30",
  };
}

/**
 * One check a week per salon the person covers; for an account with no salon limit (admins), one check for every
 * salon rather than dozens. Never for a salon outside the person's scope.
 */
export function reviewsEvents(
  salons: { all: true } | { all: false; salons: readonly { number: string; name: string }[] },
  from: string,
  to: string,
  schedule: { weekday: number; time: string },
  origin: string,
): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (new Date(`${d}T12:00:00Z`).getUTCDay() !== schedule.weekday) continue;
    const list = salons.all ? [{ number: "all", name: "" }] : salons.salons;
    for (const s of list) {
      out.push({
        id: `sunny:google-reviews:${s.number}:${d}`,
        source: SOURCE,
        kind: "google-reviews",
        title: salons.all ? "Check Google Reviews: every salon" : `Check Google Reviews: ${s.name}`,
        date: d,
        startTime: schedule.time,
        ...(salons.all ? {} : { location: s.name }),
        href: `${origin}/reviews`,
      });
    }
  }
  return out;
}

export const REMINDER_ROW = z.object({
  id: z.string().regex(/^[0-9a-f-]{36}$/i),
  owner_subject: z.string(),
  owner_name: z.string().nullable().optional(),
  title: z.string().min(1).max(200),
  on_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  visibility: z.enum(["only_me", "my_team"]),
  team_salon_numbers: z.array(z.string()).nullable().optional(),
});
export type ReminderRow = z.infer<typeof REMINDER_ROW>;

/** The salons a viewer covers: null = no limit (admins). */
export type Coverage = readonly string[] | null;

/**
 * May this viewer see this reminder? Their own, always. A team reminder: the leaders above and below its owner, which
 * here means a manager-level viewer whose salons overlap the salons the owner covered (an unlimited side overlaps
 * everything). Never an "only me" reminder of someone else.
 */
export function mayView(row: Pick<ReminderRow, "owner_subject" | "visibility" | "team_salon_numbers">, viewer: { subject: string; coverage: Coverage; manager: boolean }): boolean {
  if (row.owner_subject === viewer.subject) return true;
  if (row.visibility !== "my_team" || !viewer.manager) return false;
  const team = row.team_salon_numbers ?? null;
  if (team === null || viewer.coverage === null) return true;
  const mine = new Set(viewer.coverage);
  return team.some((n) => mine.has(n));
}

export function reminderEvents(rows: readonly ReminderRow[], viewerSubject: string, origin: string): CalendarEvent[] {
  return rows.map((r) => {
    const mine = r.owner_subject === viewerSubject;
    return {
      id: `sunny:reminder:${r.id}`,
      source: SOURCE,
      kind: "reminder" as const,
      title: r.title,
      date: r.on_date,
      ...(r.start_time ? { startTime: r.start_time.slice(0, 5) } : {}),
      href: `${origin}/calendar?month=${r.on_date.slice(0, 7)}`,
      visibility: r.visibility,
      mine,
      ...(!mine && r.owner_name ? { by: r.owner_name.slice(0, 120) } : {}),
      reminderId: r.id,
    };
  });
}
