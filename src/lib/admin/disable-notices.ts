import "server-only";

import { ACTIVE_BRAND } from "@/lib/brand";
import { createNotifications } from "@/lib/notifications/repository";
import { ADMIN_CONSOLE_ROLES } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const LOCATION_NOUN = ACTIVE_BRAND.vocabulary.salonNoun;
const LOCATION_NOUN_PLURAL = ACTIVE_BRAND.vocabulary.salonNounPlural;

/**
 * ============================================================================
 * "SIGN-IN TURNED OFF" IN THE BELL (owner, 28 Nov 2026)
 * ============================================================================
 *
 * "can we get notifications too in the app when we disable log ins please? when someone is terminated". When the
 * Woven access sync turns off the sign-in of someone Woven marks Terminated, every active administrator (the people
 * who manage users) gets one bell item per person, linking to Users, where the account can be turned back on.
 *
 * Best effort: the account is already disabled, so a notice that cannot be saved is logged (a count, no names) and
 * never fails the run.
 */
export const ACCOUNT_DISABLED_TERMINATED_KIND = "account_disabled_terminated";
export const USERS_HREF = "/admin/users";

export interface DisabledPerson {
  readonly name: string;
  /** Woven's EmployeeID: the termination date and last day worked are read for it from the directory. */
  readonly externalEmployeeId?: string | null;
  readonly position?: string | null;
  readonly primaryLocation?: string | null;
  readonly additionalLocations?: readonly string[];
  /** Calendar dates (YYYY-MM-DD) from Woven. Absent or unreadable: left out of the notice. */
  readonly terminationDate?: string | null;
  readonly lastDayWorked?: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-24" → "Nov 24, 2026". A calendar date, so no time zone can shift it. Anything else: null. */
export function calendarDateWords(value: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) return null;
  const month = MONTHS[Number(match[2]) - 1];
  const day = Number(match[3]);
  return month && day >= 1 && day <= 31 ? `${month} ${day}, ${match[1]}` : null;
}

const capitalised = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/*
 * THE REASON IN THE NOTICE (Pau, 28 Nov 2026: "Can we add the reason like terminated X date, position X location X ,
 * then sign in in X app disabled"). In that order: who and when Woven terminated them (with the last day worked), the
 * position, the salon (Ask Bubbles: store) and any additional ones, then the sign-in that was turned off. A fact Woven does not
 * have is left out, never guessed.
 */
export function disabledNotice(person: DisabledPerson): { kind: string; title: string; body: string; href: string } {
  const name = person.name.trim() || "An employee";
  const terminated = calendarDateWords(person.terminationDate);
  const lastDay = calendarDateWords(person.lastDayWorked);
  const position = person.position?.trim();
  const primary = person.primaryLocation?.trim();
  const additional = [...new Set((person.additionalLocations ?? []).map((l) => l.trim()).filter((l) => l && l !== primary))];
  const sentences = [
    `${name} was terminated in Woven${terminated ? ` on ${terminated}` : ""}${lastDay ? ` (last day worked ${lastDay})` : ""}.`,
    position ? `Position: ${position}.` : "",
    primary ? `${capitalised(LOCATION_NOUN)}: ${primary}.` : "",
    additional.length ? `Additional ${LOCATION_NOUN_PLURAL}: ${additional.join(", ")}.` : "",
    `Ask ${ACTIVE_BRAND.assistantName} sign-in: disabled, and their sessions were ended.`,
    "If this is a mistake, turn the account back on in Users.",
  ];
  return {
    kind: ACCOUNT_DISABLED_TERMINATED_KIND,
    title: `Sign-in turned off: ${name}`,
    body: sentences.filter(Boolean).join(" "),
    href: USERS_HREF,
  };
}

/** The termination date and last day worked Woven gave, by EmployeeID. Best effort: unreadable, none. */
async function terminationDates(people: readonly DisabledPerson[]): Promise<Map<string, { date: string | null; lastDay: string | null }>> {
  const ids = [...new Set(people.map((p) => p.externalEmployeeId).filter((id): id is string => Boolean(id)))];
  const dates = new Map<string, { date: string | null; lastDay: string | null }>();
  if (ids.length === 0) return dates;
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("employee_access_directory")
      .select("external_employee_id, termination_date, termination_last_day_worked")
      .in("external_employee_id", ids);
    if (error) return dates;
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const text = (v: unknown) => (typeof v === "string" && v ? v : null);
      dates.set(String(row.external_employee_id), { date: text(row.termination_date), lastDay: text(row.termination_last_day_worked) });
    }
  } catch {
    // The notice goes out without the dates.
  }
  return dates;
}

/** Rings every active administrator's bell, one item per person disabled in this run. */
export async function notifyAdminsOfDisabled(people: readonly DisabledPerson[]): Promise<void> {
  if (people.length === 0) return;
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("app_users")
      .select("email")
      .in("role", ADMIN_CONSOLE_ROLES as string[])
      .eq("status", "active");
    if (error) throw new Error(error.message);
    const admins = [...new Set((data ?? []).map((row) => String(row.email ?? "").trim().toLowerCase()).filter((email) => email.includes("@")))];
    const dates = await terminationDates(people);
    const dated = people.map((person) => {
      const found = person.externalEmployeeId ? dates.get(person.externalEmployeeId) : undefined;
      return {
        ...person,
        terminationDate: person.terminationDate ?? found?.date ?? null,
        lastDayWorked: person.lastDayWorked ?? found?.lastDay ?? null,
      };
    });
    await createNotifications(admins.flatMap((recipientEmail) => dated.map((person) => ({ recipientEmail, ...disabledNotice(person) }))));
  } catch {
    console.warn(`woven-access: ${people.length} sign-in(s) turned off, but the administrators' notices could not be saved.`);
  }
}
