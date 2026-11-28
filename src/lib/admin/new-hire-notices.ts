import type { NewNotification } from "@/lib/notifications/types";

/**
 * ============================================================================
 * "A NEW EMPLOYEE HAS BEEN HIRED" — THE ADMINS' BELL, FROM WOVEN
 * ============================================================================
 *
 * Pau, 28 Nov 2026: "create a notification when a new person is onboarded like
 * a manager, assistant etc. for admins only for now backfill it when creating
 * the notification that a new employee [name], email address in woven has been
 * hired as X position in X salon, and list if they have any other additional
 * salon".
 *
 * After each successful Woven directory sync (the daily cron and an admin's
 * manual sync), every ACTIVE employee whose Woven hire date falls in the last
 * NEW_HIRE_NOTICE_BACKFILL_DAYS days (30 by default, today included) and who
 * has not had a notice yet gets one notice in the bell of every active admin
 * (`ADMIN_CONSOLE_ROLES`: admin, owner, developer). Any position: Salon
 * Directors, Assistants and Tanning Consultants alike.
 *
 * BACKFILL: the first run after the switch is turned on announces everybody
 * hired in the window, so the hires of the last few weeks are not missed. Each
 * employee is announced once, ever (`woven_new_hire_notices`, keyed by Woven
 * EmployeeID): an admin who removes the notice does not get it again, and the
 * next sync does not repeat it.
 *
 *   NEW_HIRE_NOTICES_ENABLED        the switch. Off (default): nothing is read.
 *   NEW_HIRE_NOTICE_BACKFILL_DAYS   how far back a hire date counts, 1–365.
 *                                   Anything else is 30.
 *
 * The notice repeats what Woven says, nothing more: the name, the Woven email
 * (or that there is none), the position, the primary salon, the hire date and
 * every other salon the person has in Woven (temporary ones with their end
 * date). It never says what access Ask Sunny gave them — that is the
 * lifecycle's business (`woven-access-sync.md`).
 *
 * This file is pure; `new-hire-notices.server.ts` reads the directory and
 * writes the bell.
 */

export const NEW_HIRE_NOTICES_ENABLED_ENV = "NEW_HIRE_NOTICES_ENABLED";
export const NEW_HIRE_NOTICE_BACKFILL_DAYS_ENV = "NEW_HIRE_NOTICE_BACKFILL_DAYS";
export const NEW_HIRE_NOTICE_KIND = "woven_new_hire";
/** Where the notice opens: the Woven employee directory (admins only). */
export const NEW_HIRE_NOTICE_HREF = "/admin/integrations/woven/directory";
export const DEFAULT_BACKFILL_DAYS = 30;

export interface NewHireNoticeConfig {
  enabled: boolean;
  backfillDays: number;
}

const on = (raw: string | undefined) => ["1", "true", "yes", "on"].includes((raw ?? "").trim().toLowerCase());

export function readNewHireNoticeConfig(env: Record<string, string | undefined> = process.env): NewHireNoticeConfig {
  const raw = (env[NEW_HIRE_NOTICE_BACKFILL_DAYS_ENV] ?? "").trim();
  const days = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  return { enabled: on(env[NEW_HIRE_NOTICES_ENABLED_ENV]), backfillDays: days >= 1 && days <= 365 ? days : DEFAULT_BACKFILL_DAYS };
}

/** The first hire date that counts, YYYY-MM-DD: `days` days before today, so the window holds `days` + today. */
export function windowStart(today: string, days: number): string {
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days);
  return start.toISOString().slice(0, 10);
}

/** One Woven employee, as far as the notice needs them. */
export interface HiredEmployee {
  externalEmployeeId: string;
  firstName: string | null;
  lastName: string | null;
  preferredFirstName: string | null;
  emailAddress: string | null;
  employmentStatus: string;
  hireDate: string | null;
  positionName: string | null;
  primaryLocationId: string | null;
  primaryLocationName: string | null;
  /** Every active location the person has in Woven, the primary included or not. */
  locations: readonly { wovenLocationId: string; locationName: string | null; locationNumber: string | null; accessType: string; expiresOn: string | null }[];
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
function longDate(day: string): string {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function locationLabel(location: { locationName: string | null; locationNumber: string | null; wovenLocationId: string }): string {
  return clean(location.locationName) || (clean(location.locationNumber) ? `#${clean(location.locationNumber)}` : `Woven location ${location.wovenLocationId}`);
}

/** The other salons, in Woven's own order of names, primary excluded, each once; a temporary one says until when. */
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

export interface NoticeText {
  title: string;
  body: string;
}

/**
 * "New employee Jane Doe, jane@example.com in Woven, has been hired as Salon Director at Downtown on Nov 24, 2026.
 *  Additional salons: Eastside, Northgate." — or "No additional salons."
 */
export function newHireNoticeText(employee: HiredEmployee): NoticeText {
  const name = displayName(employee);
  const email = clean(employee.emailAddress);
  const position = clean(employee.positionName) || "a position Woven does not name";
  const primaryLocation = employee.locations.find((l) => l.wovenLocationId === employee.primaryLocationId);
  const primary = clean(employee.primaryLocationName) || (primaryLocation ? locationLabel(primaryLocation) : null);
  const others = additionalSalons(employee);
  const who = email ? `${name}, ${email} in Woven,` : `${name} (no email in Woven)`;
  const where = primary ? ` at ${primary}` : " with no primary salon in Woven";
  const when = employee.hireDate ? ` on ${longDate(employee.hireDate)}` : "";
  const extra = others.length ? `Additional salons: ${others.join(", ")}.` : "No additional salons.";
  return {
    title: `New hire: ${name} — ${position}`,
    body: `New employee ${who} has been hired as ${position}${where}${when}. ${extra}`,
  };
}

/** One bell row per admin for each employee. */
export function newHireNotifications(employees: readonly HiredEmployee[], adminEmails: readonly string[]): NewNotification[] {
  const admins = [...new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))];
  const rows: NewNotification[] = [];
  for (const employee of employees) {
    const text = newHireNoticeText(employee);
    for (const recipientEmail of admins) rows.push({ recipientEmail, kind: NEW_HIRE_NOTICE_KIND, title: text.title, body: text.body, href: NEW_HIRE_NOTICE_HREF });
  }
  return rows;
}
