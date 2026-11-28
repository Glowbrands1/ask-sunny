import "server-only";

import { patchUser, DirectoryError, type DirectoryActor } from "@/lib/admin/user-directory";
import { loadAccessPlan } from "@/lib/employees/woven/access/load";
import type { AccessPlan } from "@/lib/employees/woven/access/build";
import { createNotifications } from "@/lib/notifications/repository";
import { ADMIN_CONSOLE_ROLES } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { Role } from "@/types";

import { changeNoticeText, decidePositionChanges, MAX_CHANGES_PER_RUN, readPositionSyncConfig, type PositionChange } from "./position-sync";

/**
 * The position sync (`position-sync.ts`) with the real services. Runs after a
 * successful, stored Woven sync and the account lifecycle. Never throws; the
 * outcome carries codes and counts only.
 */

export type PositionSyncOutcome =
  | { status: "off"; code?: string }
  | { status: "blocked"; code: "guards" | "too_many_changes"; changes?: number }
  | { status: "completed"; applied: number; failed: number; skipped: number };

export interface PositionSyncDeps {
  actor(email: string): Promise<DirectoryActor | null>;
  loadPlan(now: Date): Promise<AccessPlan>;
  alsoCovers(appUserIds: readonly string[]): Promise<Map<string, { alsoCoversAreaIds: string[] }>>;
  apply(change: PositionChange, actor: DirectoryActor): Promise<void>;
  tellAdmins(changes: readonly PositionChange[]): Promise<void>;
}

export async function runPositionSync(input: { env?: Record<string, string | undefined>; now?: Date } = {}, deps: PositionSyncDeps = realPositionSyncDeps()): Promise<PositionSyncOutcome> {
  const config = readPositionSyncConfig(input.env ?? process.env);
  if (!config.enabled) return { status: "off" };
  if (!config.actorEmail) return { status: "off", code: "actor_missing" };
  try {
    const actor = await deps.actor(config.actorEmail);
    if (!actor) return { status: "off", code: "actor_not_an_administrator" };
    const plan = await deps.loadPlan(input.now ?? new Date());
    if (!plan.guard.mutationsAllowed) return { status: "blocked", code: "guards" };
    const linked = plan.rows.filter((r) => r.account?.via === "link").map((r) => r.account!.appUserId);
    const { changes, skipped } = decidePositionChanges(plan.rows, await deps.alsoCovers(linked));
    if (changes.length > MAX_CHANGES_PER_RUN) return { status: "blocked", code: "too_many_changes", changes: changes.length };

    const applied: PositionChange[] = [];
    let failed = 0;
    for (const change of changes) {
      if (change.appUserId === actor.id) continue;
      try {
        await deps.apply(change, actor);
        applied.push(change);
      } catch (error) {
        failed += 1;
        console.error("[position-sync] a change was refused:", error instanceof DirectoryError ? error.code : "error");
      }
    }
    if (applied.length) await deps.tellAdmins(applied).catch(() => undefined);
    return { status: "completed", applied: applied.length, failed, skipped: skipped.length };
  } catch (error) {
    console.error("[position-sync] not run:", error instanceof Error ? error.message : "unknown error");
    return { status: "off", code: "position_sync_failed" };
  }
}

/**
 * New hires whose Woven record is not yet settled: the latest successful sync saw them for the first time, or saw
 * their position or primary location change, or saw them come back. Their sign-in link waits for the next sync, so a
 * Tanning Consultant corrected to District Manager the same day gets the link as a District Manager (Pau, 28 Nov 2026).
 */
export async function unsettledEmployees(latestRunId: string | null): Promise<Set<string>> {
  if (!latestRunId) return new Set();
  const db = getSupabaseAdmin();
  // The change log is keyed by the directory row (`employee_id`), not the Woven EmployeeID.
  const { data, error } = await db
    .from("employee_directory_changes")
    .select("employee_id")
    .eq("sync_run_id", latestRunId)
    .in("change_kind", ["new_employee", "position_changed", "primary_location_changed", "reactivated"]);
  if (error) throw new Error(`the latest changes could not be read (${error.code ?? "error"})`);
  const rowIds = [...new Set(((data ?? []) as { employee_id: unknown }[]).map((r) => String(r.employee_id)))];
  const out = new Set<string>();
  for (let i = 0; i < rowIds.length; i += 200) {
    const { data: rows, error: readError } = await db.from("employee_access_directory").select("external_employee_id").in("id", rowIds.slice(i, i + 200));
    if (readError) throw new Error(`the directory could not be read (${readError.code ?? "error"})`);
    for (const r of (rows ?? []) as { external_employee_id: unknown }[]) out.add(String(r.external_employee_id));
  }
  return out;
}

/**
 * Woven EmployeeIDs whose position the sync saw change on or after `since` (YYYY-MM-DD): people promoted into the role
 * their new account was created for, who get the sign-in link as a new hire does.
 */
export async function promotedSince(since: string): Promise<Set<string>> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("employee_directory_changes")
    .select("employee_id")
    .eq("change_kind", "position_changed")
    .gte("detected_at", `${since}T00:00:00Z`)
    .limit(2000);
  if (error) throw new Error(`the position changes could not be read (${error.code ?? "error"})`);
  const rowIds = [...new Set(((data ?? []) as { employee_id: unknown }[]).map((r) => String(r.employee_id)))];
  const out = new Set<string>();
  for (let i = 0; i < rowIds.length; i += 200) {
    const { data: rows, error: readError } = await db.from("employee_access_directory").select("external_employee_id").in("id", rowIds.slice(i, i + 200));
    if (readError) throw new Error(`the directory could not be read (${readError.code ?? "error"})`);
    for (const r of (rows ?? []) as { external_employee_id: unknown }[]) out.add(String(r.external_employee_id));
  }
  return out;
}

/* ------------------------------------------------------- the real services -- */

async function readActor(email: string): Promise<DirectoryActor | null> {
  const { data } = await getSupabaseAdmin().from("app_users").select("id, email, role, status, scope_level").eq("email", email.toLowerCase()).maybeSingle();
  if (!data || data.status !== "active" || data.scope_level !== "global") return null;
  if (!(ADMIN_CONSOLE_ROLES as readonly string[]).includes(String(data.role))) return null;
  return { id: String(data.id), email: String(data.email), role: data.role as Role };
}

export function realPositionSyncDeps(): PositionSyncDeps {
  return {
    actor: readActor,
    loadPlan: (now) => loadAccessPlan(now),
    async alsoCovers(ids) {
      const out = new Map<string, { alsoCoversAreaIds: string[] }>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await getSupabaseAdmin().from("app_users").select("id, scope_also_covers_area_ids").in("id", ids.slice(i, i + 200));
        if (error) throw new Error(`the accounts could not be read (${error.code ?? "error"})`);
        for (const row of (data ?? []) as Record<string, unknown>[]) {
          out.set(String(row.id), { alsoCoversAreaIds: Array.isArray(row.scope_also_covers_area_ids) ? row.scope_also_covers_area_ids.map(String) : [] });
        }
      }
      return out;
    },
    async apply(change, actor) {
      await patchUser(change.appUserId, { role: change.to.role, scope: change.to.scope }, actor);
    },
    async tellAdmins(changes) {
      const { data, error } = await getSupabaseAdmin().from("app_users").select("email").eq("status", "active").in("role", ADMIN_CONSOLE_ROLES);
      if (error) return;
      const admins = ((data ?? []) as { email: unknown }[]).map((r) => String(r.email ?? "").toLowerCase()).filter((e) => e.includes("@"));
      await createNotifications(
        changes.flatMap((change) => {
          const text = changeNoticeText(change);
          return admins.map((recipientEmail) => ({ recipientEmail, kind: "woven_access_changed", title: text.title, body: text.body, href: "/admin/users" }));
        }),
      );
    },
  };
}
