import "server-only";

import { supabaseSecretKeyConfigured } from "@/lib/config/server-env";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  PERMISSIONS,
  ROLES,
  activePermissionMatrix,
  effectiveMatrix,
  sanitizeOverrides,
  setActivePermissionOverrides,
  type PermissionOverrides,
} from "./index";

/**
 * ============================================================================
 * THE SAVED PERMISSIONS, ON THE SERVER (Pau, 23 Nov 2026)
 * ============================================================================
 *
 * `permission_overrides` holds one row per role an administrator has changed.
 * `ensurePermissionsLoaded()` reads it into the in-process matrix that
 * `activePermissionMatrix()` returns, at most once per `TTL_MS`. It is awaited
 * at the START of `authorizeRequest` and `requirePagePermission`, so by the time
 * any synchronous `hasPermission(activePermissionMatrix(), …)` runs for a
 * request the matrix has been loaded within the last ten seconds. Another server
 * instance therefore picks a saved change up within about ten seconds; this one
 * at once (`savePermissionOverrides` sets the matrix itself).
 *
 * FAILS SAFE, NEVER OPEN. If the read fails, the matrix already in memory stays
 * (the last one that was saved, or the built-in defaults if nothing has loaded).
 * A failed read never widens anything, never throws into the request, and is
 * retried within a couple of seconds. Not configured (demo mode, no secret
 * key): nothing is read and the defaults apply.
 */

const TTL_MS = 10_000;
const RETRY_MS = 2_000;

let loadedAt = 0;
let inflight: Promise<void> | null = null;

export async function readPermissionOverrides(): Promise<PermissionOverrides> {
  const { data, error } = await getSupabaseAdmin()
    .from("permission_overrides")
    .select("role, permissions");
  if (error) throw new Error(error.message);
  const raw: Record<string, unknown> = {};
  for (const row of (data ?? []) as { role: string; permissions: unknown }[]) raw[row.role] = row.permissions;
  return sanitizeOverrides(raw);
}

export async function ensurePermissionsLoaded(now: number = Date.now()): Promise<void> {
  if (!supabaseSecretKeyConfigured()) return;
  if (now - loadedAt < TTL_MS) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      setActivePermissionOverrides(await readPermissionOverrides());
      loadedAt = Date.now();
    } catch {
      // Keep what is in memory; try again soon. The message is not logged: it can name the connection.
      console.warn("[permissions] could not read permission_overrides; keeping the matrix already in force");
      loadedAt = Date.now() - TTL_MS + RETRY_MS;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export interface PermissionActor {
  id: string;
  email: string;
}

/**
 * Replaces the saved overrides with `next` (already a full set: roles absent
 * from it go back to the defaults). Writes one audit row per cell that changed.
 * Returns the matrix now in force.
 */
export async function savePermissionOverrides(next: PermissionOverrides, actor: PermissionActor) {
  const clean = sanitizeOverrides(next);
  const before = activePermissionMatrix();
  const after = effectiveMatrix(clean);
  const who = actor.email || actor.id;
  const db = getSupabaseAdmin();

  const now = new Date().toISOString();
  const rows = ROLES.filter((role) => clean[role]).map((role) => ({
    role,
    permissions: clean[role]!,
    updated_at: now,
    updated_by: who,
  }));
  if (rows.length > 0) {
    const { error } = await db.from("permission_overrides").upsert(rows, { onConflict: "role" });
    if (error) throw new Error("Could not save the permissions.");
  }
  const reset = ROLES.filter((role) => !clean[role]);
  const { error: deleteError } = await db.from("permission_overrides").delete().in("role", reset);
  if (deleteError) throw new Error("Could not save the permissions.");

  const audit = ROLES.flatMap((role) =>
    PERMISSIONS.filter((permission) => before[role]?.includes(permission) !== after[role]?.includes(permission)).map(
      (permission) => ({ changed_by: who, role, permission, granted: after[role].includes(permission) }),
    ),
  );
  if (audit.length > 0) {
    const { error: auditError } = await db.from("permission_override_audit").insert(audit);
    if (auditError) console.warn("[permissions] saved, but the audit rows could not be written");
  }

  setActivePermissionOverrides(clean);
  loadedAt = Date.now();
  return after;
}

/** Test seam. */
export function __resetPermissionStore(): void {
  loadedAt = 0;
  inflight = null;
  setActivePermissionOverrides({});
}
