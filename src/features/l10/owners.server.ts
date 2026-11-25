import "server-only";

import { employeeName } from "@/lib/employees/woven/views";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { Role } from "@/types";

/*
 * Ask Sunny only (not in the Leadership Hub). The extra names in the DM L10's owner menus for to-dos and issues.
 *
 * The request (17 Nov 2026): "Can we add myself, and any other DM or higher role as a drop down option to add to-do's
 * and issues?" — the menus listed only the meeting's own people (the Hub's roster). The owner asked for the list to
 * come from Woven.
 *
 * Who is listed: every employee Woven has as active and not terminated, whose role in Ask Sunny is District Manager
 * or higher, either as Woven resolves it (`employee_access_preview.effective_role`: a protected override, else the
 * confirmed position mapping) or as their active Ask Sunny account holds it (`app_user_role`; Woven positions such
 * as Operations or Regional Director are not mapped to a role yet, so their people are found this way). Full names
 * come from Woven. Read on each page load, so a new DM appears without a deploy; the repository names nobody.
 *
 * Left out on request (the owner, 18 Nov 2026: "add them in the drop down except" three named people, who keep their
 * access to the meeting): the sign-in emails in `L10_OWNER_MENU_EXCLUDE_EMAILS` (comma-separated, any case), set in
 * the deployment, so the repository still names nobody. It only trims this extra list; the meeting's own people (the
 * Hub's roster) and who may open the meeting (the Hub's roles) are unchanged.
 *
 * Read-only. Any failure gives an empty list: the menus then show the meeting's own people, as before.
 */
export const OWNER_MENU_ROLES: readonly Role[] = ["district_manager", "regional_manager", "admin", "owner"];

/** The emails in L10_OWNER_MENU_EXCLUDE_EMAILS, lowercased. */
export function excludedOwnerEmails(raw: string | undefined = process.env.L10_OWNER_MENU_EXCLUDE_EMAILS): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@")),
  );
}

interface PreviewRow {
  employee_id: unknown;
  email_address?: unknown;
  employment_status: unknown;
  effective_role: unknown;
  app_user_role: unknown;
  app_user_status: unknown;
}

const isOwnerRole = (role: unknown) => typeof role === "string" && (OWNER_MENU_ROLES as readonly string[]).includes(role);

/** Whether a Woven access-preview row is a DM-or-higher person for the owner menus. */
export function qualifiesForOwnerMenu(row: PreviewRow, excluded: ReadonlySet<string> = new Set()): boolean {
  if (row.employment_status !== "active") return false;
  if (typeof row.email_address === "string" && excluded.has(row.email_address.trim().toLowerCase())) return false;
  return isOwnerRole(row.effective_role) || (row.app_user_status === "active" && isOwnerRole(row.app_user_role));
}

/**
 * The owner names, and whether they loaded. A failed read is said on the meeting page ("Couldn't load the owner names")
 * instead of looking like nobody to list (24 Nov 2026). No one qualifying is not a failure.
 */
export async function loadLeadershipOwnerNames(): Promise<{ ok: boolean; names: string[] }> {
  try {
    const db = getSupabaseAdmin();
    const roles = OWNER_MENU_ROLES.join(",");
    const preview = await db
      .from("employee_access_preview")
      .select("employee_id, email_address, employment_status, effective_role, app_user_role, app_user_status")
      .or(`effective_role.in.(${roles}),app_user_role.in.(${roles})`)
      .limit(500);
    if (preview.error || !preview.data) return { ok: false, names: [] };
    const excluded = excludedOwnerEmails();
    const ids = (preview.data as PreviewRow[])
      .filter((r) => qualifiesForOwnerMenu(r, excluded))
      .map((r) => r.employee_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (ids.length === 0) return { ok: true, names: [] };
    const directory = await db
      .from("employee_access_directory")
      .select("id, first_name, last_name, preferred_first_name, termination_date")
      .in("id", ids)
      .limit(500);
    if (directory.error || !directory.data) return { ok: false, names: [] };
    const names = (directory.data as Record<string, unknown>[])
      .filter((row) => row.termination_date === null || row.termination_date === undefined)
      .map((row) =>
        employeeName({
          firstName: typeof row.first_name === "string" ? row.first_name : null,
          lastName: typeof row.last_name === "string" ? row.last_name : null,
          preferredFirstName: typeof row.preferred_first_name === "string" ? row.preferred_first_name : null,
        }),
      )
      .filter((name) => name !== "(no name in Woven)");
    return { ok: true, names: [...new Set(names)].sort((a, b) => a.localeCompare(b)) };
  } catch {
    return { ok: false, names: [] };
  }
}

export async function leadershipOwnerNames(): Promise<string[]> {
  return (await loadLeadershipOwnerNames()).names;
}
