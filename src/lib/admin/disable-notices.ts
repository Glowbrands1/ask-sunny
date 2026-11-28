import "server-only";

import { ACTIVE_BRAND } from "@/lib/brand";
import { createNotifications } from "@/lib/notifications/repository";
import { ADMIN_CONSOLE_ROLES } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/supabase/server";

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
}

export function disabledNotice(person: DisabledPerson): { kind: string; title: string; body: string; href: string } {
  const name = person.name.trim() || "An employee";
  return {
    kind: ACCOUNT_DISABLED_TERMINATED_KIND,
    title: `Sign-in turned off: ${name}`,
    body: `Woven marks ${name} as terminated, so their sign-in to Ask ${ACTIVE_BRAND.assistantName} was turned off automatically and their sessions were ended. If this is a mistake, turn the account back on in Users.`,
    href: USERS_HREF,
  };
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
    await createNotifications(admins.flatMap((recipientEmail) => people.map((person) => ({ recipientEmail, ...disabledNotice(person) }))));
  } catch {
    console.warn(`woven-access: ${people.length} sign-in(s) turned off, but the administrators' notices could not be saved.`);
  }
}
