import "server-only";

import { recordToday } from "@/lib/business-today";
import { createNotifications } from "@/lib/notifications/repository";
import { ADMIN_CONSOLE_ROLES } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/supabase/server";

import {
  isRecentHire,
  newHireNotifications,
  readNewHireNoticeConfig,
  windowStart,
  type HiredEmployee,
} from "./new-hire-notices";

/**
 * The admins' new-hire bell (`new-hire-notices.ts`) with the real services: the
 * Woven directory, `app_users` for the admins, `woven_new_hire_notices` for who
 * was already announced, and `app_notifications` for the bell.
 *
 * Runs after a successful, stored Woven directory sync. Never throws: a failure
 * is logged and returned as a code, and never turns a good sync into an error.
 * The outcome carries codes and counts only, never a name or an email.
 */

export type NewHireNoticeOutcome =
  | { status: "off" }
  | { status: "completed"; announced: number; admins: number; alreadyAnnounced: number; since: string }
  | { status: "failed"; code: string };

export interface NewHireNoticeDeps {
  /** Active employees hired on or after `since` (and not after today), with their active locations. */
  recentHires(since: string, today: string): Promise<HiredEmployee[]>;
  adminEmails(): Promise<string[]>;
  /** Of these EmployeeIDs, the ones this call claimed (not announced before, nor by a concurrent run). */
  claim(rows: readonly { externalEmployeeId: string; hireDate: string | null; recipients: number }[]): Promise<Set<string>>;
  release(ids: readonly string[]): Promise<void>;
  ring(rows: ReturnType<typeof newHireNotifications>): Promise<void>;
}

const CHUNK = 500;

export async function announceNewHires(
  input: { env?: Record<string, string | undefined>; now?: Date },
  deps: NewHireNoticeDeps = realNoticeDeps(),
): Promise<NewHireNoticeOutcome> {
  const config = readNewHireNoticeConfig(input.env ?? process.env);
  if (!config.enabled) return { status: "off" };
  const today = recordToday(input.now ?? new Date());
  const since = windowStart(today, config.backfillDays);
  try {
    const hires = (await deps.recentHires(since, today)).filter((e) => isRecentHire(e, since, today));
    if (hires.length === 0) return { status: "completed", announced: 0, admins: 0, alreadyAnnounced: 0, since };
    const admins = [...new Set((await deps.adminEmails()).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))];
    // No admin to tell: claim nobody, so the hires are announced once an admin exists.
    if (admins.length === 0) return { status: "completed", announced: 0, admins: 0, alreadyAnnounced: 0, since };
    const claimed = await deps.claim(hires.map((e) => ({ externalEmployeeId: e.externalEmployeeId, hireDate: e.hireDate, recipients: admins.length })));
    const toAnnounce = hires
      .filter((e) => claimed.has(e.externalEmployeeId))
      .sort((a, b) => (a.hireDate ?? "").localeCompare(b.hireDate ?? "") || a.externalEmployeeId.localeCompare(b.externalEmployeeId));
    const rows = newHireNotifications(toAnnounce, admins);
    try {
      for (let i = 0; i < rows.length; i += CHUNK) await deps.ring(rows.slice(i, i + CHUNK));
    } catch (error) {
      await deps.release([...claimed]).catch(() => undefined);
      throw error;
    }
    return { status: "completed", announced: toAnnounce.length, admins: admins.length, alreadyAnnounced: hires.length - toAnnounce.length, since };
  } catch (error) {
    console.error("[new-hire-notices] the admins' new-hire notice was not sent:", error instanceof Error ? error.message : "unknown error");
    return { status: "failed", code: "new_hire_notices_failed" };
  }
}

/* ------------------------------------------------------- the real services -- */

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const IDS_PER_QUERY = 200;

export function realNoticeDeps(): NewHireNoticeDeps {
  const db = () => getSupabaseAdmin();
  return {
    async recentHires(since, today) {
      const { data, error } = await db()
        .from("employee_access_directory")
        .select(
          "id, external_employee_id, first_name, last_name, preferred_first_name, email_address, employment_status, hire_date, position_name, primary_woven_location_id, primary_location_name",
        )
        .eq("source_system", "woven")
        .eq("employment_status", "active")
        .gte("hire_date", since)
        .lte("hire_date", today)
        .limit(2000);
      if (error) throw new Error(`the directory could not be read (${error.code ?? "error"})`);
      const people = (data ?? []) as Record<string, unknown>[];
      const locations = new Map<string, HiredEmployee["locations"][number][]>();
      const ids = people.map((p) => String(p.id));
      for (let i = 0; i < ids.length; i += IDS_PER_QUERY) {
        const { data: rows, error: locError } = await db()
          .from("employee_location_affiliations")
          .select("employee_id, woven_location_id, location_name, location_number, access_type, expires_on")
          .eq("active", true)
          .in("employee_id", ids.slice(i, i + IDS_PER_QUERY));
        if (locError) throw new Error(`location access could not be read (${locError.code ?? "error"})`);
        for (const row of (rows ?? []) as Record<string, unknown>[]) {
          const key = String(row.employee_id);
          const list = locations.get(key) ?? [];
          list.push({
            wovenLocationId: String(row.woven_location_id),
            locationName: str(row.location_name),
            locationNumber: str(row.location_number),
            accessType: String(row.access_type),
            expiresOn: str(row.expires_on),
          });
          locations.set(key, list);
        }
      }
      return people.map((p) => ({
        externalEmployeeId: String(p.external_employee_id),
        firstName: str(p.first_name),
        lastName: str(p.last_name),
        preferredFirstName: str(p.preferred_first_name),
        emailAddress: str(p.email_address),
        employmentStatus: String(p.employment_status),
        hireDate: str(p.hire_date),
        positionName: str(p.position_name),
        primaryLocationId: str(p.primary_woven_location_id),
        primaryLocationName: str(p.primary_location_name),
        locations: locations.get(String(p.id)) ?? [],
      }));
    },

    async adminEmails() {
      const { data, error } = await db().from("app_users").select("email, role, status").eq("status", "active").in("role", ADMIN_CONSOLE_ROLES);
      if (error) throw new Error(`the admins could not be read (${error.code ?? "error"})`);
      return ((data ?? []) as { email: unknown }[]).map((r) => str(r.email)).filter((e): e is string => !!e);
    },

    async claim(rows) {
      if (rows.length === 0) return new Set();
      const { data, error } = await db()
        .from("woven_new_hire_notices")
        .upsert(
          rows.map((r) => ({ external_employee_id: r.externalEmployeeId, hire_date: r.hireDate, recipients: r.recipients })),
          { onConflict: "external_employee_id", ignoreDuplicates: true },
        )
        .select("external_employee_id");
      if (error) throw new Error(`the new-hire record could not be written (${error.code ?? "error"})`);
      return new Set(((data ?? []) as { external_employee_id: unknown }[]).map((r) => String(r.external_employee_id)));
    },

    async release(ids) {
      if (ids.length === 0) return;
      await db().from("woven_new_hire_notices").delete().in("external_employee_id", [...ids]);
    },

    ring: (rows) => createNotifications(rows),
  };
}
