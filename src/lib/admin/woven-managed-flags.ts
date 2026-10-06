import "server-only";

import { plannerAccount } from "@/lib/employees/woven/access/adapters";
import {
  allowedManagedFlags,
  disallowedFlags,
  flagsLabel,
  isProtectedAccount,
  type ManagedFlags,
} from "@/lib/employees/woven/access/managed-policy";
import { getSupabaseAdmin } from "@/lib/supabase/server";

import { audit, DirectoryError, type DirectoryActor } from "./user-directory";

/**
 * ============================================================================
 * ADOPTION — an administrator decides what Woven may manage for a linked account
 * ============================================================================
 *
 * Writes the three managed flags on ONE `employee_account_links` row and
 * nothing else (the database grants service_role UPDATE on exactly those three
 * columns, and a trigger refuses any other change). Turning a flag on changes
 * nobody's access by itself: it only allows a later, separately enabled apply
 * action to act for that field.
 *
 * The owner's policy (`managed-policy.ts`) is enforced HERE, on the server,
 * from the account as it is in the database now. A flag the policy does not
 * allow is refused with 400 — never silently dropped — so a stale screen or a
 * hand-made request cannot turn on location management for a District
 * Manager or any management at all for a protected account.
 *
 * Every change is audited (`managed_flags_changed`, before → after). A
 * concurrent change made between our read and our write is refused (409)
 * rather than overwritten.
 */

export interface ManagedFlagsRequest {
  appUserId: string;
  flags: ManagedFlags;
}

export interface ManagedFlagsResult {
  appUserId: string;
  changed: boolean;
  before: ManagedFlags;
  after: ManagedFlags;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseManagedFlagsRequest(value: unknown): ManagedFlagsRequest {
  const b = (value ?? {}) as Record<string, unknown>;
  if (typeof b.appUserId !== "string" || !UUID.test(b.appUserId)) {
    throw new DirectoryError("invalid_input", "appUserId must be an account id.", 400);
  }
  for (const key of ["managedStatus", "managedLocation", "managedRole"] as const) {
    if (typeof b[key] !== "boolean") throw new DirectoryError("invalid_input", `${key} must be true or false.`, 400);
  }
  return {
    appUserId: b.appUserId.toLowerCase(),
    flags: { status: b.managedStatus as boolean, location: b.managedLocation as boolean, role: b.managedRole as boolean },
  };
}

export async function setManagedFlags(request: ManagedFlagsRequest, actor: DirectoryActor): Promise<ManagedFlagsResult> {
  const admin = getSupabaseAdmin();

  const { data, error } = await admin
    .from("employee_access_accounts")
    .select("*")
    .eq("app_user_id", request.appUserId)
    .maybeSingle();
  if (error) throw new DirectoryError("provider_failed", "The account could not be read. Try again in a moment.", 502);
  const account = data ? plannerAccount(data as Record<string, unknown>) : null;
  if (!account) throw new DirectoryError("not_found", "There is no such account.", 404);

  if (account.management !== "woven_linked") {
    throw new DirectoryError(
      "invalid_input",
      "Only an account linked to a Woven employee can be managed by Woven. Link it in Link Review first.",
      409,
    );
  }

  const allowed = allowedManagedFlags(account, isProtectedAccount(account));
  const refused = disallowedFlags(request.flags, allowed);
  if (refused.length > 0) {
    throw new DirectoryError(
      "invalid_input",
      `Policy does not allow Woven to manage ${refused.join(", ")} for this account (${account.role}, ${account.scopeLevel} scope${
        isProtectedAccount(account) ? ", protected" : ""
      }).`,
      400,
    );
  }

  const before: ManagedFlags = { status: account.managedStatus, location: account.managedLocation, role: account.managedRole };
  const after = request.flags;
  if (before.status === after.status && before.location === after.location && before.role === after.role) {
    return { appUserId: account.appUserId, changed: false, before, after };
  }

  /* Conditional on what we read: a concurrent change is refused, never overwritten. */
  const { data: updated, error: updateError } = await admin
    .from("employee_account_links")
    .update({ managed_status: after.status, managed_location: after.location, managed_role: after.role })
    .eq("app_user_id", account.appUserId)
    .eq("management", "woven_linked")
    .eq("managed_status", before.status)
    .eq("managed_location", before.location)
    .eq("managed_role", before.role)
    .select("app_user_id");
  if (updateError) throw new DirectoryError("provider_failed", "The change could not be saved. Try again in a moment.", 502);
  if (!Array.isArray(updated) || updated.length !== 1) {
    throw new DirectoryError(
      "invalid_input",
      "Somebody else changed this account's Woven management a moment ago. Reload and review again.",
      409,
    );
  }

  await audit({
    targetUserId: account.appUserId,
    targetEmail: account.email,
    actor,
    action: "managed_flags_changed",
    from: flagsLabel(before),
    to: flagsLabel(after),
  });

  return { appUserId: account.appUserId, changed: true, before, after };
}
