import type { SupabaseClient } from "@supabase/supabase-js";

import { ROLES } from "@/lib/permissions";
import type { AccessScope, Role, ScopeLevel } from "@/types";

/**
 * ============================================================================
 * THE PROFILE LOOKUP. THE ONLY PLACE A ROLE COMES FROM.
 * ============================================================================
 *
 * A Supabase session proves ONE thing: that somebody holds the credential for
 * an email address. It says nothing about what they may do. Everything about
 * what they may do is read from `public.app_users` here, and from nowhere else
 * — not from user metadata, which the account holder can edit themselves; not
 * from a JWT claim; and above all not from anything the browser sent.
 *
 * EVERY FAILURE PATH DENIES. That is the whole design of this module, so the
 * reasons are enumerated rather than collapsed into a boolean:
 *
 *   no_profile      A credential exists with no profile row. This is the case
 *                   most likely to be "helpfully" defaulted, and defaulting it
 *                   either way is a bug: default to Admin and anyone who can
 *                   create an auth user becomes an administrator; default to
 *                   Employee and an authorization decision is being invented
 *                   from an absence. There is no role, so there is no access.
 *
 *   disabled        A profile that has been switched off. Revoking access must
 *                   not require deleting the credential, because deleting it
 *                   destroys the audit trail of who did what.
 *
 *   invited         Invited but never accepted. No password has been set, so
 *                   there is nothing to sign in with; a row in this state
 *                   reaching a session at all means something is wrong.
 *
 *   unknown_role    The row holds a role this build does not recognise — a
 *                   database ahead of the deployed code. Refusing is the only
 *                   safe reading: the permission matrix would return false for
 *                   every lookup, which LOOKS like a locked-out user but is
 *                   really an unrecognised one, and the two need different
 *                   fixes.
 *
 *   lookup_failed   The query itself failed. A database that cannot answer
 *                   "who is this" has not answered "anyone".
 *
 * None of these is a message for an end user. `profileDenialMessage()` maps
 * them to something a person can act on, without disclosing whether an account
 * exists.
 */

export type ProfileDenial =
  | "no_profile"
  | "disabled"
  | "invited"
  | "unknown_role"
  | "lookup_failed";

export interface AppUserProfile {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: "invited" | "active" | "disabled";
  scope: AccessScope;
  createdAt: string;
  updatedAt: string;
}

export type ProfileLookup =
  | { ok: true; profile: AppUserProfile }
  | { ok: false; denial: ProfileDenial };

/** Columns the lookup needs. Named explicitly so a `select *` never widens it. */
export const APP_USER_COLUMNS =
  "id, email, display_name, role, status, scope_level, scope_primary_area_id, scope_also_covers_area_ids, created_at, updated_at";

const SCOPE_LEVELS: ScopeLevel[] = ["global", "region", "district", "salon"];

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

function isScopeLevel(value: unknown): value is ScopeLevel {
  return typeof value === "string" && (SCOPE_LEVELS as string[]).includes(value);
}

/**
 * Turns a database row into a profile, or says why it cannot.
 *
 * Exported separately from the query so the mapping is testable without a
 * client, and so the User Management routes can reuse the exact same reading of
 * a row rather than writing a second, subtly different one.
 */
export function toAppUserProfile(row: unknown): ProfileLookup {
  if (!row || typeof row !== "object") return { ok: false, denial: "no_profile" };
  const record = row as Record<string, unknown>;

  if (!isRole(record.role)) return { ok: false, denial: "unknown_role" };

  const status = record.status;
  if (status === "disabled") return { ok: false, denial: "disabled" };
  if (status === "invited") return { ok: false, denial: "invited" };
  if (status !== "active") {
    // A status this build does not know. Same reasoning as an unknown role:
    // an unrecognised value is not a permissive one.
    return { ok: false, denial: "no_profile" };
  }

  const id = record.id;
  const email = record.email;
  if (typeof id !== "string" || typeof email !== "string") {
    return { ok: false, denial: "no_profile" };
  }

  /*
   * An unrecognised scope level falls back to `salon`, the NARROWEST scope —
   * the opposite direction from the role checks above, and for a different
   * reason. Role decides what somebody may do and must never be guessed. Scope
   * decides how much data they see, and there the fail-closed answer is the
   * smallest scope, not a refusal to sign in.
   */
  const level: ScopeLevel = isScopeLevel(record.scope_level) ? record.scope_level : "salon";
  const covers = Array.isArray(record.scope_also_covers_area_ids)
    ? record.scope_also_covers_area_ids.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];

  return {
    ok: true,
    profile: {
      id,
      email,
      displayName:
        typeof record.display_name === "string" && record.display_name.trim()
          ? record.display_name
          : email,
      role: record.role,
      status: "active",
      scope: {
        level,
        primaryAreaId:
          typeof record.scope_primary_area_id === "string"
            ? record.scope_primary_area_id
            : null,
        alsoCoversAreaIds: covers,
      },
      createdAt: typeof record.created_at === "string" ? record.created_at : "",
      updatedAt: typeof record.updated_at === "string" ? record.updated_at : "",
    },
  };
}

/**
 * Reads the profile for an authenticated subject.
 *
 * The client passed in is expected to be the SESSION client, so the read runs
 * under row level security with `auth.uid()` set: the `app_users_select_own`
 * policy is what limits it to one row. Passing the admin client here would work
 * and would be wrong — the least-privileged client that can answer the question
 * is the one that should ask it, and RLS then backs up the `.eq("id", ...)`
 * rather than trusting it.
 */
export async function getAppUser(
  client: SupabaseClient,
  subjectId: string,
): Promise<ProfileLookup> {
  const { data, error } = await client
    .from("app_users")
    .select(APP_USER_COLUMNS)
    .eq("id", subjectId)
    .maybeSingle();

  // The Postgres message can quote row contents, so it is not surfaced. The
  // caller gets a denial; an operator gets the detail from Supabase's own logs.
  if (error) return { ok: false, denial: "lookup_failed" };
  if (!data) return { ok: false, denial: "no_profile" };

  return toAppUserProfile(data);
}

/**
 * What to TELL somebody who was denied.
 *
 * Deliberately vague about which condition applied. "Your account has not been
 * set up" and "your account is disabled" are both true statements that leak
 * whether an account exists, so both denials produce the same sentence,
 * pointing at the administrator who can actually fix it.
 */
export function profileDenialMessage(denial: ProfileDenial): string {
  switch (denial) {
    case "lookup_failed":
      return "Ask Sunny could not verify your account just now. Try again in a moment.";
    case "unknown_role":
      return "Your account is set to a role this version of Ask Sunny does not recognise. Ask an administrator to review it.";
    default:
      return "Your Ask Sunny account is not active. Ask an administrator to set up your access.";
  }
}
