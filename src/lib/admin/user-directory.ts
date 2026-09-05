import "server-only";

import { AuthError } from "@/lib/auth/types";
import { APP_USER_COLUMNS, toAppUserProfile } from "@/lib/auth/app-user";
import { ADMIN_CONSOLE_ROLES, ROLES } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { AccessScope, Role, ScopeLevel } from "@/types";

/**
 * ============================================================================
 * THE USER DIRECTORY. Every write that changes who somebody is.
 * ============================================================================
 *
 * This is the one module in Ask Sunny that legitimately holds the privileged
 * Supabase client, because it does two things nothing else does: it reads OTHER
 * people's profile rows, and it calls the Supabase Auth Admin API to create and
 * recover credentials. Row level security on `app_users` allows a person to
 * select their own row and nothing else, which is exactly right for
 * authorization and useless for administration.
 *
 * SO THE AUTHORIZATION HAPPENS BEFORE ANY OF THIS IS CALLED. The routes run
 * `authorizeRequest(request, "manage_users")` first, and every function here
 * takes the ACTOR as an argument rather than resolving one itself — a function
 * that could look up its own caller could be called with nobody in mind.
 *
 * ============================================================================
 * WHAT ASK SUNNY NEVER DOES WITH A PASSWORD
 * ============================================================================
 *
 * It does not generate one. It does not store one. It does not hash one, email
 * one, display one, or accept one through this API. Inviting somebody sends
 * them a Supabase Auth link that lets THEM choose; recovering an account sends
 * a reset link. There is no code path here through which a password value
 * could be read, written or returned, and a test asserts the words are absent
 * from the source.
 *
 * The invitation and recovery links themselves are single-use credentials.
 * They are sent by Supabase directly to the person's inbox and are never
 * returned to the caller, never logged, and never put in a response.
 */

/* ------------------------------------------------------------- the model -- */

export interface DirectoryUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: "invited" | "active" | "disabled";
  scope: AccessScope;
  createdAt: string;
  updatedAt: string;
}

/** Who is performing the change. Resolved by the route, never by this module. */
export interface DirectoryActor {
  id: string;
  email: string;
  role: Role;
}

export class DirectoryError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "duplicate_email"
      | "not_found"
      | "self_change"
      | "last_admin"
      | "provider_failed",
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "DirectoryError";
  }
}

/* ------------------------------------------------------------ validation -- */

const SCOPE_LEVELS: ScopeLevel[] = ["global", "region", "district", "salon"];
const STATUSES = ["invited", "active", "disabled"] as const;

export type DirectoryStatus = (typeof STATUSES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isStatus(value: unknown): value is DirectoryStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

/**
 * Normalizes an email, or refuses.
 *
 * Lowercased because `app_users` has a unique index on `lower(email)` — the
 * database is the authority on uniqueness, and sending it mixed case would let
 * two rows that collide there be accepted here.
 */
export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new DirectoryError("invalid_input", "An email address is required.");
  }
  const email = value.trim().toLowerCase();
  /*
   * Deliberately a shape check, not RFC 5322. The authority on whether an
   * address is deliverable is the mail server, and a clever regex here would
   * reject real addresses while still not proving anything.
   */
  if (email.length < 5 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new DirectoryError("invalid_input", "That does not look like an email address.");
  }
  return email;
}

export function normalizeDisplayName(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.trim().slice(0, 120);
}

/**
 * Reads a scope from request input.
 *
 * An unknown level becomes `salon`, the NARROWEST — the same fail-closed
 * direction the profile lookup takes, and for the same reason: a scope nobody
 * can read must not become global access.
 */
export function normalizeScope(value: unknown): AccessScope {
  const raw = (value ?? {}) as Record<string, unknown>;
  const level = SCOPE_LEVELS.includes(raw.level as ScopeLevel)
    ? (raw.level as ScopeLevel)
    : "salon";
  const primary = typeof raw.primaryAreaId === "string" ? raw.primaryAreaId.slice(0, 80) : null;
  const also = Array.isArray(raw.alsoCoversAreaIds)
    ? raw.alsoCoversAreaIds
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.slice(0, 80))
        .slice(0, 60)
    : [];

  /*
   * `app_users_scope_area_coherent` refuses a non-global scope with no primary
   * area, so the same rule is stated here to produce a sentence rather than a
   * constraint-violation error. The database still has the final say.
   */
  if (level !== "global" && !primary) {
    throw new DirectoryError(
      "invalid_input",
      "A salon, district or region scope needs a primary area. Choose one, or set the scope to global.",
    );
  }
  if (level === "global" && primary) {
    throw new DirectoryError(
      "invalid_input",
      "A global scope covers everything, so it cannot also name a primary area.",
    );
  }

  return { level, primaryAreaId: primary, alsoCoversAreaIds: also };
}

/* ------------------------------------------------------------------ read -- */

function rowToDirectoryUser(row: Record<string, unknown>): DirectoryUser | null {
  /*
   * The PROFILE mapper is reused for the parts it validates, then the status is
   * taken from the row — because a directory listing must show disabled and
   * invited people, which `toAppUserProfile` deliberately refuses.
   *
   * That refusal is right for authorization and wrong here, so this is the one
   * place the two readings differ, and it is written out rather than achieved
   * by loosening the shared mapper.
   */
  if (!isRole(row.role) || !isStatus(row.status)) return null;
  const asActive = toAppUserProfile({ ...row, status: "active" });
  if (!asActive.ok) return null;

  return {
    id: asActive.profile.id,
    email: asActive.profile.email,
    displayName: asActive.profile.displayName,
    role: row.role,
    status: row.status,
    scope: asActive.profile.scope,
    createdAt: asActive.profile.createdAt,
    updatedAt: asActive.profile.updatedAt,
  };
}

export async function listUsers(): Promise<DirectoryUser[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("app_users")
    .select(APP_USER_COLUMNS)
    .order("email", { ascending: true });

  if (error) {
    // The Postgres message can quote row contents; it does not reach the caller.
    throw new DirectoryError("provider_failed", "The user list could not be read.", 502);
  }

  return (data ?? [])
    .map((row) => rowToDirectoryUser(row as Record<string, unknown>))
    .filter((user): user is DirectoryUser => user !== null);
}

async function readUser(id: string): Promise<DirectoryUser> {
  const { data, error } = await getSupabaseAdmin()
    .from("app_users")
    .select(APP_USER_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new DirectoryError("provider_failed", "That account could not be read.", 502);
  const user = data ? rowToDirectoryUser(data as Record<string, unknown>) : null;
  if (!user) throw new DirectoryError("not_found", "No such account.", 404);
  return user;
}

/* ----------------------------------------------------------------- audit -- */

/**
 * Records a change. Best-effort by design.
 *
 * A failed audit write must not undo a completed change — reporting success for
 * a change that happened is honest, while rolling back a role change because
 * the log was unavailable would be worse than an incomplete log. The audit
 * table is revoked from every browser-held role, so nothing here is
 * client-reachable.
 */
async function audit(entry: {
  targetUserId: string | null;
  targetEmail: string;
  actor: DirectoryActor;
  action: string;
  from?: string | null;
  to?: string | null;
}): Promise<void> {
  await getSupabaseAdmin()
    .from("app_user_audit")
    .insert({
      target_user_id: entry.targetUserId,
      target_email: entry.targetEmail,
      actor_user_id: entry.actor.id,
      actor_email: entry.actor.email,
      action: entry.action,
      from_value: entry.from ?? null,
      to_value: entry.to ?? null,
    });
}

/* ---------------------------------------------------------------- invite -- */

export interface InviteInput {
  email: unknown;
  displayName: unknown;
  role: unknown;
  scope: unknown;
  /** Where the invitation link should land. Validated by the caller. */
  redirectTo: string;
}

/**
 * Invites somebody: creates the credential, then the profile.
 *
 * ORDER MATTERS AND IS NOT REVERSIBLE. `app_users.id` references
 * `auth.users(id)`, so the profile cannot exist first. If the profile insert
 * then fails, the auth user is deleted again — otherwise a credential would
 * exist with no profile, which the provider correctly refuses to authenticate,
 * leaving somebody who received an email unable to sign in and no row anywhere
 * explaining why.
 */
export async function inviteUser(
  input: InviteInput,
  actor: DirectoryActor,
): Promise<DirectoryUser> {
  const email = normalizeEmail(input.email);
  const displayName = normalizeDisplayName(input.displayName, email);
  const scope = normalizeScope(input.scope);

  if (!isRole(input.role)) {
    throw new DirectoryError("invalid_input", "Choose a role for this person.");
  }
  const role = input.role;

  const admin = getSupabaseAdmin();

  /*
   * Checked here for a readable message, and enforced by the unique index on
   * `lower(email)` regardless. The check is a courtesy; the index is the rule.
   */
  const { data: existing } = await admin
    .from("app_users")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (existing) {
    throw new DirectoryError(
      "duplicate_email",
      "Somebody already has an Ask Sunny account with that email address.",
      409,
    );
  }

  /*
   * SUPABASE AUTH CREATES THE CREDENTIAL, and it sends the invitation link
   * itself. No password is generated here, and the link never comes back to
   * this process — it goes to the person's inbox.
   */
  const invited = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: input.redirectTo,
  });

  if (invited.error || !invited.data?.user) {
    /*
     * The provider's message is not surfaced: for an address that already has a
     * credential it says so, which would disclose the existence of an account
     * to somebody probing this endpoint. The caller already needs
     * `manage_users` to be here, so this is defence in depth rather than the
     * main control — but the message adds nothing an administrator can act on.
     */
    throw new DirectoryError(
      "provider_failed",
      "The invitation could not be sent. Check the address and try again.",
      502,
    );
  }

  const subject = invited.data.user.id;

  const { data, error } = await admin
    .from("app_users")
    .insert({
      id: subject,
      email,
      display_name: displayName,
      role,
      status: "invited",
      scope_level: scope.level,
      scope_primary_area_id: scope.primaryAreaId,
      scope_also_covers_area_ids: scope.alsoCoversAreaIds,
      created_by: actor.id,
      updated_by: actor.id,
    })
    .select(APP_USER_COLUMNS)
    .single();

  if (error || !data) {
    // Undo the credential so no orphan is left. See the note above.
    await admin.auth.admin.deleteUser(subject).catch(() => {
      /* Nothing better to do; the profile insert already failed. */
    });
    throw new DirectoryError(
      "provider_failed",
      "The account could not be created. Nothing was saved.",
      502,
    );
  }

  await audit({
    targetUserId: subject,
    targetEmail: email,
    actor,
    action: "invited",
    to: role,
  });

  const user = rowToDirectoryUser(data as Record<string, unknown>);
  if (!user) throw new DirectoryError("provider_failed", "The account was created but could not be read back.", 502);
  return user;
}

/* ----------------------------------------------------------------- patch -- */

export interface PatchInput {
  displayName?: unknown;
  role?: unknown;
  status?: unknown;
  scope?: unknown;
}

/**
 * Changes a profile. Never a credential.
 *
 * Three refusals, and the first two are ALSO enforced by database triggers.
 * That duplication is deliberate: the route's version produces a sentence
 * somebody can read, and the trigger's version holds even for a caller that
 * never came through this function.
 */
export async function patchUser(
  id: string,
  input: PatchInput,
  actor: DirectoryActor,
): Promise<DirectoryUser> {
  const before = await readUser(id);

  const patch: Record<string, unknown> = { updated_by: actor.id };
  let roleChange: { from: Role; to: Role } | null = null;
  let statusChange: { from: string; to: string } | null = null;

  if (input.displayName !== undefined) {
    patch.display_name = normalizeDisplayName(input.displayName, before.displayName);
  }

  if (input.role !== undefined) {
    if (!isRole(input.role)) throw new DirectoryError("invalid_input", "That is not a role.");
    if (input.role !== before.role) roleChange = { from: before.role, to: input.role };
    patch.role = input.role;
  }

  if (input.status !== undefined) {
    if (!isStatus(input.status)) {
      throw new DirectoryError("invalid_input", "That is not an account status.");
    }
    /*
     * `invited` is not settable. It means "a credential exists and has never
     * been used", which is a fact about the credential rather than a choice an
     * administrator makes — setting it by hand would claim somebody had not
     * signed in when they had.
     */
    if (input.status === "invited" && before.status !== "invited") {
      throw new DirectoryError(
        "invalid_input",
        "An account cannot be put back to invited. Disable it instead, or send a password reset.",
      );
    }
    if (input.status !== before.status) {
      statusChange = { from: before.status, to: input.status };
    }
    patch.status = input.status;
  }

  if (input.scope !== undefined) {
    const scope = normalizeScope(input.scope);
    patch.scope_level = scope.level;
    patch.scope_primary_area_id = scope.primaryAreaId;
    patch.scope_also_covers_area_ids = scope.alsoCoversAreaIds;
  }

  /* REFUSAL 1 — no self-elevation, and no self-lockout either. */
  if (id === actor.id && (roleChange || statusChange)) {
    throw new DirectoryError(
      "self_change",
      "You cannot change your own role or account status. Ask another administrator.",
      403,
    );
  }

  /* REFUSAL 2 — the last administrative account keeps its access. */
  if (roleChange || statusChange) {
    await assertNotLastAdministrator(before, roleChange?.to, statusChange?.to);
  }

  const { data, error } = await getSupabaseAdmin()
    .from("app_users")
    .update(patch)
    .eq("id", id)
    .select(APP_USER_COLUMNS)
    .single();

  if (error || !data) {
    /*
     * A trigger refusal lands here. Its message is the one the database wrote,
     * and those two messages are ours — written in the migration for exactly
     * this purpose — so they are safe and useful to pass on.
     */
    const message = error?.message ?? "";
    if (message.includes("cannot change their own")) {
      throw new DirectoryError("self_change", "You cannot change your own role or status.", 403);
    }
    if (message.includes("last active administrator")) {
      throw new DirectoryError(
        "last_admin",
        "This is the last active administrator. Give somebody else administrator access first.",
        409,
      );
    }
    throw new DirectoryError("provider_failed", "That change could not be saved.", 502);
  }

  if (roleChange) {
    await audit({
      targetUserId: id,
      targetEmail: before.email,
      actor,
      action: "role_changed",
      from: roleChange.from,
      to: roleChange.to,
    });
  }
  if (statusChange) {
    await audit({
      targetUserId: id,
      targetEmail: before.email,
      actor,
      action: "status_changed",
      from: statusChange.from,
      to: statusChange.to,
    });
  }

  const user = rowToDirectoryUser(data as Record<string, unknown>);
  if (!user) throw new DirectoryError("provider_failed", "The change was saved but could not be read back.", 502);
  return user;
}

/**
 * Refuses a change that would leave nobody able to administer Ask Sunny.
 *
 * Counted over admin/owner/developer together, because what has to survive is
 * the SEAT rather than any particular role — and counted in the database rather
 * than from the list this request happens to hold.
 */
async function assertNotLastAdministrator(
  before: DirectoryUser,
  nextRole: Role | undefined,
  nextStatus: string | undefined,
): Promise<void> {
  const wasAdministrative =
    (ADMIN_CONSOLE_ROLES as readonly string[]).includes(before.role) &&
    before.status === "active";
  if (!wasAdministrative) return;

  const stillAdministrative =
    (ADMIN_CONSOLE_ROLES as readonly string[]).includes(nextRole ?? before.role) &&
    (nextStatus ?? before.status) === "active";
  if (stillAdministrative) return;

  const { count, error } = await getSupabaseAdmin()
    .from("app_users")
    .select("id", { count: "exact", head: true })
    .in("role", [...ADMIN_CONSOLE_ROLES])
    .eq("status", "active");

  if (error) {
    /*
     * Cannot count, so cannot prove it is safe. Refusing is the only honest
     * answer: the alternative is allowing the one change that can lock every
     * administrator out of the application with no way back.
     */
    throw new DirectoryError(
      "provider_failed",
      "Administrator access could not be verified, so the change was not made.",
      502,
    );
  }

  if ((count ?? 0) <= 1) {
    throw new DirectoryError(
      "last_admin",
      "This is the last active administrator. Give somebody else administrator access first.",
      409,
    );
  }
}

/* --------------------------------------------------- credential recovery -- */

/**
 * Sends a password reset, or re-sends an invitation.
 *
 * WHICH ONE IS DECIDED FROM THE CREDENTIAL, not from a parameter and not from
 * the profile's status.
 *
 * It used to be decided from `status === "invited"`, and that was subtly wrong
 * in the case that matters most. An invitation whose link has been FOLLOWED —
 * even one that then failed to complete — leaves a confirmed auth user, and
 * Supabase refuses to invite an address that already has one. So the profile
 * would still read `invited`, this function would try to re-invite, and the
 * provider would reject it: a pending invitation that could never be resent.
 *
 * `email_confirmed_at` is the honest signal. A confirmed credential can be
 * recovered; an unconfirmed one has to be invited. Deciding from that means the
 * caller cannot get it wrong and neither can the profile.
 *
 * NEITHER LINK IS RETURNED. Supabase mails it. This function's entire result is
 * "which kind of email was sent", which is what the UI needs to say and is all
 * it may know.
 */
export async function sendRecovery(
  id: string,
  redirectTo: string,
  actor: DirectoryActor,
): Promise<{ kind: "invitation" | "password_reset"; email: string }> {
  const user = await readUser(id);
  const admin = getSupabaseAdmin();

  if (user.status === "disabled") {
    throw new DirectoryError(
      "invalid_input",
      "This account is disabled. Re-enable it before sending a sign-in link.",
      409,
    );
  }

  /*
   * Ask the auth system, not the profile. A failure to read it is treated as
   * "not confirmed", which sends an invitation — the safe way round, because an
   * invitation to an already-confirmed address is refused loudly by the
   * provider, while a reset to an address that never confirmed would silently
   * go nowhere useful.
   */
  const credential = await admin.auth.admin.getUserById(user.id);
  const confirmed = Boolean(credential.data?.user?.email_confirmed_at);

  const kind = confirmed ? "password_reset" : "invitation";

  const result =
    kind === "invitation"
      ? await admin.auth.admin.inviteUserByEmail(user.email, { redirectTo })
      : await admin.auth.resetPasswordForEmail(user.email, { redirectTo });

  if (result.error) {
    throw new DirectoryError(
      "provider_failed",
      "The email could not be sent. Try again in a moment.",
      502,
    );
  }

  /*
   * THE VOCABULARY THE DATABASE ACTUALLY ACCEPTS. `app_user_audit.action`
   * carries a CHECK constraint, and this line used to emit 'invitation_resent'
   * and 'password_reset_sent' — neither of which is in it. `audit()` never
   * reads the error it gets back, deliberately, so every one of these inserts
   * had been failing silently: the audit trail recorded nothing about recovery
   * emails while appearing to. A test now asserts every action string here
   * appears in the migration's constraint.
   */
  await audit({
    targetUserId: user.id,
    targetEmail: user.email,
    actor,
    action: kind === "invitation" ? "invite_resent" : "reset_requested",
  });

  return { kind, email: user.email };
}

/** Turns a directory failure into the shape `errorResponse` already handles. */
export function asAuthError(error: DirectoryError): AuthError {
  return new AuthError("forbidden", error.message);
}
