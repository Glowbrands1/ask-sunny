import type { NewNotification } from "@/lib/notifications/types";

/**
 * ============================================================================
 * HIRED, TERMINATED, LINK SENT — WHO HEARS ABOUT IT, FROM WOVEN
 * ============================================================================
 *
 * Pau, 28 Nov 2026: "create a notification when a new person is onboarded like
 * a manager, assistant etc. for admins only for now backfill it when creating
 * the notification that a new employee [name], email address in woven has been
 * hired as X position in X salon, and list if they have any other additional
 * salon". Then: "admin, owner and developer, also can you add if that person is
 * in any salon the manager there will get notified too, also add coleen for
 * this notification coz she is HR all hires and all terminated", "backfill
 * only 2 weeks pls", and "can you also send me a notification in my personal
 * email … when someone join and get terminated and if they get the link".
 *
 * After each successful, stored Woven directory sync (the daily cron and an
 * admin's manual sync):
 *
 *   HIRED       an ACTIVE employee whose Woven hire date is in the window. The
 *               bell of every active admin (admin, owner, developer), of every
 *               active salon manager of any salon the person is in (primary or
 *               additional: Salon Director, Assistant Salon Director), and of
 *               everyone on WOVEN_HR_NOTIFY_EMAILS.
 *   TERMINATED  the sync recorded a `terminated` change in the window. The
 *               bell of everyone on WOVEN_HR_NOTIFY_EMAILS.
 *   LINK SENT   the hourly new-hire run emailed the person their sign-in link
 *               (`new-hire-invites.ts`). No bell.
 *
 * All three are also POSTed to WOVEN_EVENTS_WEBHOOK_URL when it is set (Pau's
 * n8n, which emails her), with WOVEN_EVENTS_WEBHOOK_SECRET in the
 * `x-ask-webhook-secret` header. The app itself sends no email: the only mail
 * it has is Supabase's sign-in email, two an hour.
 *
 * BACKFILL: the window is the last NEW_HIRE_NOTICE_BACKFILL_DAYS days (14 by
 * default, today included), so the first run announces the last two weeks.
 * Each event is announced ONCE, ever (`woven_employee_notices`): removing the
 * notice does not bring it back and the next sync does not repeat it. A
 * webhook that failed is retried by the next sync while the event is in the
 * window.
 *
 *   NEW_HIRE_NOTICES_ENABLED        the switch. Off (default): nothing is read.
 *   NEW_HIRE_NOTICE_BACKFILL_DAYS   1–365; anything else is 14.
 *   WOVEN_HR_NOTIFY_EMAILS          comma-separated; HR hears of every hire and
 *                                   every termination.
 *   WOVEN_EVENTS_WEBHOOK_URL        https only; unset: no webhook.
 *   WOVEN_EVENTS_WEBHOOK_SECRET     sent with every webhook call.
 *
 * The notice repeats what Woven says, nothing more. This file is pure;
 * `new-hire-notices.server.ts` reads the directory and writes the bell.
 */

export const NEW_HIRE_NOTICES_ENABLED_ENV = "NEW_HIRE_NOTICES_ENABLED";
export const NEW_HIRE_NOTICE_BACKFILL_DAYS_ENV = "NEW_HIRE_NOTICE_BACKFILL_DAYS";
export const WOVEN_HR_NOTIFY_EMAILS_ENV = "WOVEN_HR_NOTIFY_EMAILS";
export const WOVEN_EVENTS_WEBHOOK_URL_ENV = "WOVEN_EVENTS_WEBHOOK_URL";
export const WOVEN_EVENTS_WEBHOOK_SECRET_ENV = "WOVEN_EVENTS_WEBHOOK_SECRET";
export const WEBHOOK_SECRET_HEADER = "x-ask-webhook-secret";

/** This app's name in a webhook, so one n8n workflow can serve both apps. */
export const APP_NAME = "Ask Sunny";
/** The roles that manage a salon, who hear of a hire at any salon they cover. */
export const SALON_MANAGER_ROLES = ["salon_director", "assistant_salon_director"] as const;
export const SALON_SCOPE_LEVEL = "salon";
/** What this app calls a location, in notice text. */
export const LOCATION_WORD = "Salon";

export const NEW_HIRE_NOTICE_KIND = "woven_new_hire";
export const TERMINATION_NOTICE_KIND = "woven_termination";
/** Where an admin's notice opens: the Woven employee directory (admins only). Others get no link. */
export const NEW_HIRE_NOTICE_HREF = "/admin/integrations/woven/directory";
export const DEFAULT_BACKFILL_DAYS = 14;

export type EmployeeEvent = "hired" | "terminated" | "invite_sent";

export interface NewHireNoticeConfig {
  enabled: boolean;
  backfillDays: number;
  hrEmails: string[];
  webhookUrl: string | null;
  webhookSecret: string | null;
}

const on = (raw: string | undefined) => ["1", "true", "yes", "on"].includes((raw ?? "").trim().toLowerCase());

export function emailList(raw: string | undefined): string[] {
  return [...new Set((raw ?? "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
}

function httpsUrl(raw: string | undefined): string | null {
  try {
    const url = new URL((raw ?? "").trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function readNewHireNoticeConfig(env: Record<string, string | undefined> = process.env): NewHireNoticeConfig {
  const raw = (env[NEW_HIRE_NOTICE_BACKFILL_DAYS_ENV] ?? "").trim();
  const days = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  return {
    enabled: on(env[NEW_HIRE_NOTICES_ENABLED_ENV]),
    backfillDays: days >= 1 && days <= 365 ? days : DEFAULT_BACKFILL_DAYS,
    hrEmails: emailList(env[WOVEN_HR_NOTIFY_EMAILS_ENV]),
    webhookUrl: httpsUrl(env[WOVEN_EVENTS_WEBHOOK_URL_ENV]),
    webhookSecret: (env[WOVEN_EVENTS_WEBHOOK_SECRET_ENV] ?? "").trim() || null,
  };
}

/** The first date that counts, YYYY-MM-DD: `days` days before today, so the window holds `days` + today. */
export function windowStart(today: string, days: number): string {
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days);
  return start.toISOString().slice(0, 10);
}

/** One Woven location the person is in, with the app's salon area when it is mapped to one. */
export interface EmployeeLocation {
  wovenLocationId: string;
  locationName: string | null;
  locationNumber: string | null;
  accessType: string;
  expiresOn: string | null;
  /** `loc-<salon number>` when Woven's location is mapped to a salon; null otherwise. */
  areaId?: string | null;
}

/** One Woven employee, as far as a notice needs them. */
export interface HiredEmployee {
  externalEmployeeId: string;
  firstName: string | null;
  lastName: string | null;
  preferredFirstName: string | null;
  emailAddress: string | null;
  employmentStatus: string;
  hireDate: string | null;
  terminationDate?: string | null;
  terminationLastDayWorked?: string | null;
  /**
   * Their account in this app, for a termination: its status now, or null when they have none. Undefined: not read.
   * Pau, 28 Nov 2026: "add the reason like terminated X date, position X location X, then sign in in X app disabled".
   */
  appAccountStatus?: "active" | "invited" | "disabled" | null;
  positionName: string | null;
  primaryLocationId: string | null;
  primaryLocationName: string | null;
  /** Every active location the person has in Woven, the primary included or not. */
  locations: readonly EmployeeLocation[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Active, hired within [since, today]. A missing or unreadable hire date is never a new hire. */
export function isRecentHire(employee: Pick<HiredEmployee, "employmentStatus" | "hireDate">, since: string, today: string): boolean {
  const day = (employee.hireDate ?? "").slice(0, 10);
  return employee.employmentStatus === "active" && ISO_DATE.test(day) && day >= since && day <= today;
}

const clean = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();

export function displayName(employee: Pick<HiredEmployee, "firstName" | "lastName" | "preferredFirstName" | "externalEmployeeId">): string {
  const first = clean(employee.firstName);
  const last = clean(employee.lastName);
  const preferred = clean(employee.preferredFirstName);
  const full = [first, last].filter(Boolean).join(" ");
  if (!full) return preferred ? preferred : `Woven employee ${employee.externalEmployeeId}`;
  return preferred && preferred.toLowerCase() !== first.toLowerCase() ? `${full} (goes by ${preferred})` : full;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function longDate(day: string): string {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function locationLabel(location: Pick<EmployeeLocation, "locationName" | "locationNumber" | "wovenLocationId">): string {
  return clean(location.locationName) || (clean(location.locationNumber) ? `#${clean(location.locationNumber)}` : `Woven location ${location.wovenLocationId}`);
}

export function primarySalon(employee: Pick<HiredEmployee, "primaryLocationId" | "primaryLocationName" | "locations">): string | null {
  const primaryLocation = employee.locations.find((l) => l.wovenLocationId === employee.primaryLocationId);
  return clean(employee.primaryLocationName) || (primaryLocation ? locationLabel(primaryLocation) : null);
}

/** The other salons, sorted, primary excluded, each once; a temporary one says until when. */
export function additionalSalons(employee: Pick<HiredEmployee, "primaryLocationId" | "locations">): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const location of employee.locations) {
    if (location.accessType === "primary" || location.wovenLocationId === employee.primaryLocationId) continue;
    if (seen.has(location.wovenLocationId)) continue;
    seen.add(location.wovenLocationId);
    const label = locationLabel(location);
    out.push(location.accessType === "temporary_or_expiring_access" && location.expiresOn ? `${label} (temporary, until ${longDate(location.expiresOn)})` : label);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/** Every salon area (primary and additional) the person is in, for finding the managers there. */
export function salonAreas(employee: Pick<HiredEmployee, "locations">): string[] {
  return [...new Set(employee.locations.map((l) => l.areaId).filter((a): a is string => !!a))];
}

export interface NoticeText {
  title: string;
  body: string;
}

function parts(employee: HiredEmployee) {
  const name = displayName(employee);
  const email = clean(employee.emailAddress);
  const position = clean(employee.positionName) || "a position Woven does not name";
  const primary = primarySalon(employee);
  const others = additionalSalons(employee);
  return {
    name,
    position,
    who: email ? `${name}, ${email} in Woven,` : `${name} (no email in Woven)`,
    where: primary ? ` at ${primary}` : " with no primary salon in Woven",
    extra: others.length ? `Additional salons: ${others.join(", ")}.` : "No additional salons.",
  };
}

/**
 * "New employee Jane Doe, jane@example.com in Woven, has been hired as Salon Director at Downtown on Nov 24, 2026.
 *  Additional salons: Eastside, Northgate." — or "No additional salons."
 */
export function newHireNoticeText(employee: HiredEmployee): NoticeText {
  const p = parts(employee);
  const when = employee.hireDate ? ` on ${longDate(employee.hireDate)}` : "";
  return { title: `New hire: ${p.name} — ${p.position}`, body: `New employee ${p.who} has been hired as ${p.position}${p.where}${when}. ${p.extra}` };
}

/** "Employee Jane Doe, jane@example.com in Woven, Salon Director at Downtown, has been terminated in Woven. Termination date: …" */
export function terminationNoticeText(employee: HiredEmployee): NoticeText {
  const p = parts(employee);
  const email = clean(employee.emailAddress);
  const who = email ? `${p.name}, ${email} in Woven,` : `${p.name} (no email in Woven),`;
  const when = employee.terminationDate ? ` on ${longDate(employee.terminationDate)}` : "";
  const lastDay = employee.terminationLastDayWorked ? ` (last day worked ${longDate(employee.terminationLastDayWorked)})` : "";
  const location = primarySalon(employee);
  const others = additionalSalons(employee);
  const signIn =
    employee.appAccountStatus === undefined
      ? null
      : employee.appAccountStatus === null
        ? `No ${APP_NAME} account.`
        : employee.appAccountStatus === "disabled"
          ? `${APP_NAME} sign-in: disabled.`
          : `${APP_NAME} sign-in: still on — an admin should turn it off in Users.`;
  const lines = [
    `Employee ${who} has been terminated in Woven${when}${lastDay}.`,
    `Position: ${p.position}.`,
    location ? `${LOCATION_WORD}: ${location}.` : `No primary ${LOCATION_WORD.toLowerCase()} in Woven.`,
    others.length ? `Additional ${LOCATION_WORD.toLowerCase()}s: ${others.join(", ")}.` : null,
    signIn,
  ].filter(Boolean);
  return { title: `Terminated: ${p.name} — ${p.position}`, body: lines.join(" ") };
}

/** "Jane Doe was emailed their Ask Sunny sign-in link at jane@example.com (Salon Director at Downtown)." */
export function inviteSentText(employee: HiredEmployee, sentTo: string): NoticeText {
  const p = parts(employee);
  return {
    title: `Sign-in link sent: ${p.name} — ${APP_NAME}`,
    body: `${p.name} was emailed their ${APP_NAME} sign-in link at ${sentTo} (${p.position}${p.where}). ${p.extra}`,
  };
}

export interface Recipient {
  email: string;
  /** Admins get a link to the Woven directory; managers and HR, who may not open it, get none. */
  admin: boolean;
}

/**
 * Who hears of a hire: admins, the managers of any salon the person is in, and HR. Each address once; the new hire
 * themselves never (a Salon Director hired today may already manage the salon).
 */
export function hireRecipients(input: { admins: readonly string[]; managers: readonly string[]; hr: readonly string[]; employeeEmail: string | null }): Recipient[] {
  const self = clean(input.employeeEmail).toLowerCase();
  const out = new Map<string, Recipient>();
  const add = (email: string, admin: boolean) => {
    const e = email.trim().toLowerCase();
    if (!e.includes("@") || e === self) return;
    const had = out.get(e);
    out.set(e, { email: e, admin: admin || (had?.admin ?? false) });
  };
  input.admins.forEach((e) => add(e, true));
  input.managers.forEach((e) => add(e, false));
  input.hr.forEach((e) => add(e, false));
  return [...out.values()];
}

export function bellRows(kind: string, text: NoticeText, recipients: readonly Recipient[]): NewNotification[] {
  return recipients.map((r) => ({ recipientEmail: r.email, kind, title: text.title, body: text.body, href: r.admin ? NEW_HIRE_NOTICE_HREF : null }));
}

/** Kept for the first version's callers: one row per admin, each linking to the directory. */
export function newHireNotifications(employees: readonly HiredEmployee[], adminEmails: readonly string[]): NewNotification[] {
  const admins = hireRecipients({ admins: adminEmails, managers: [], hr: [], employeeEmail: null });
  return employees.flatMap((e) => bellRows(NEW_HIRE_NOTICE_KIND, newHireNoticeText(e), admins));
}

/** What the webhook receives (n8n emails it). Names and emails go only to the configured https endpoint. */
export interface EmployeeEventPayload {
  app: string;
  event: EmployeeEvent;
  title: string;
  body: string;
  employee: {
    wovenEmployeeId: string;
    name: string;
    email: string | null;
    position: string | null;
    /** The primary salon or store, as Woven names it. */
    location: string | null;
    additionalLocations: string[];
    hireDate: string | null;
    terminationDate: string | null;
  };
}

export function eventPayload(event: EmployeeEvent, employee: HiredEmployee, text: NoticeText): EmployeeEventPayload {
  return {
    app: APP_NAME,
    event,
    title: text.title,
    body: text.body,
    employee: {
      wovenEmployeeId: employee.externalEmployeeId,
      name: displayName(employee),
      email: clean(employee.emailAddress) || null,
      position: clean(employee.positionName) || null,
      location: primarySalon(employee),
      additionalLocations: additionalSalons(employee),
      hireDate: employee.hireDate,
      terminationDate: employee.terminationDate ?? null,
    },
  };
}
