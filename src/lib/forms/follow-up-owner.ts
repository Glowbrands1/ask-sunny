import "server-only";

import { APP_USER_COLUMNS, toAppUserProfile } from "@/lib/auth/app-user";
import { activePermissionMatrix, hasPermission } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { AccessScope, Permission, Role } from "@/types";

import type { FormsActor } from "./access";
import { awaitingHr } from "./hr-approval-rules";
import { actorMaySeeInstance, readPermissionFor } from "./instance-scope";
import { setFollowUpOwner, type InstanceRow } from "./instances";

export { followUpOwnerOf, followUpRecipients, namedFollowUpOwner, ownsFollowUp } from "./follow-up-owner-rules";

/**
 * ============================================================================
 * WHO OWNS A FORM'S FOLLOW-UP (the owner, 27 Nov 2026, approved "ok to all")
 * ============================================================================
 *
 * The creator of a form can hand its follow-up to someone else (e.g. the DM). Nobody named: the creator owns it, exactly
 * as before. The owner gets the follow-up on their Calendar (with the employee's name), and the due and overdue bells;
 * the creator keeps both.
 *
 * WHO MAY BE THE OWNER: an active account who could already open this form and do the follow-up themselves —
 *   - `view_form_monitoring` (the forms page the follow-up is worked from),
 *   - the form's own edit permission (its template's, as `authorizeInstance(…, "edit")` asks: Completed and Extend are
 *     edits), and the Exit form's read permission when it is one (`readPermissionFor`),
 *   - and the form is one they may see: `actorMaySeeInstance` over THEIR forms access (`resolveFormsVisibility`: their
 *     salons, their district's or region's, Woven's locations, or all for admins and designated accounts) — the same
 *     rule Form Monitoring, the Overview queue and the Calendar read with.
 * Someone outside the form's salon is never offered and never accepted. The UI's list and the AI's choice both come
 * from `followUpOwnerChoices`, and every write goes through `assignFollowUpOwner`, which asks it again.
 */

export interface FollowUpOwnerChoice {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
}

export class FollowUpOwnerError extends Error {
  constructor(
    message: string,
    readonly code: "not_allowed" | "not_found" | "not_saved",
  ) {
    super(message);
    this.name = "FollowUpOwnerError";
  }
}

/** One account as a forms reader would be resolved (`authorizeForms`), for the may-own check. */
export interface CandidateAccount {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
  readonly scope: AccessScope;
}

/** The pure rule: may this resolved account own this form's follow-up? */
export function mayOwnFollowUp(
  candidate: FormsActor,
  form: InstanceRow,
  editPermission: Permission,
  holds: (role: Role, permission: Permission) => boolean = (role, permission) => hasPermission(activePermissionMatrix(), role, permission),
): boolean {
  if (!candidate.verified || !candidate.role) return false;
  const role = candidate.role;
  if (!holds(role, "view_form_monitoring") || !holds(role, editPermission)) return false;
  const restricted = readPermissionFor(form);
  if (restricted && !holds(role, restricted)) return false;
  return actorMaySeeInstance(candidate, form);
}

export interface FollowUpOwnerDeps {
  /** Every active account (`app_users`). */
  readonly listAccounts: () => Promise<CandidateAccount[]>;
  /** The scope this account reads forms under (`resolveFormsVisibility`). */
  readonly visibilityOf: (account: CandidateAccount) => Promise<AccessScope>;
  /** Whether this account approves forms as HR (only asked for a form waiting for HR). */
  readonly hrApproverOf: (id: string) => Promise<boolean>;
  /** The permission editing this form needs (its template's; `authorizeInstance`'s `edit`). */
  readonly editPermissionOf: (form: InstanceRow) => Promise<Permission>;
}

async function listActiveAccounts(): Promise<CandidateAccount[]> {
  const { data, error } = await getSupabaseAdmin().from("app_users").select(APP_USER_COLUMNS).eq("status", "active").limit(2000);
  if (error) throw new FollowUpOwnerError("The people who may own this follow-up could not be read just now.", "not_saved");
  return ((data ?? []) as unknown[]).flatMap((row) => {
    const read = toAppUserProfile(row);
    return read.ok ? [{ id: read.profile.id, name: read.profile.displayName, role: read.profile.role, scope: read.profile.scope }] : [];
  });
}

export const DEFAULT_FOLLOW_UP_OWNER_DEPS: FollowUpOwnerDeps = {
  listAccounts: listActiveAccounts,
  visibilityOf: async (account) => (await import("./forms-visibility")).resolveFormsVisibility({ subject: account.id, role: account.role, scope: account.scope }),
  hrApproverOf: async (id) => (await import("./hr-approval-approvers")).resolveHrApprover(id),
  editPermissionOf: async (form) => {
    const { getTemplateByKey } = await import("./repository");
    const template = await getTemplateByKey(form.templateKey);
    // As `authorizeInstance`: a form whose template is gone is edited only by whoever administers the library.
    return ((template?.requiredPermission as Permission | undefined) ?? "manage_form_templates") as Permission;
  },
};

let depsForTests: Partial<FollowUpOwnerDeps> | null = null;
/** Tests only: stand-ins for the account list and the per-account reads. */
export function __setFollowUpOwnerDepsForTests(deps: Partial<FollowUpOwnerDeps> | null): void {
  depsForTests = deps;
}
function activeDeps(): FollowUpOwnerDeps {
  return depsForTests ? { ...DEFAULT_FOLLOW_UP_OWNER_DEPS, ...depsForTests } : DEFAULT_FOLLOW_UP_OWNER_DEPS;
}

/** Everyone who may own this form's follow-up, by name. The creator is among them when they still may open it. */
export async function followUpOwnerChoices(form: InstanceRow, deps: FollowUpOwnerDeps = activeDeps()): Promise<FollowUpOwnerChoice[]> {
  const editPermission = await deps.editPermissionOf(form);
  const matrix = activePermissionMatrix();
  const holds = (role: Role, permission: Permission) => hasPermission(matrix, role, permission);
  // Cheap first: the role must hold the permissions before anyone's salons are read.
  const accounts = (await deps.listAccounts()).filter((account) => {
    if (!holds(account.role, "view_form_monitoring") || !holds(account.role, editPermission)) return false;
    const restricted = readPermissionFor(form);
    return !restricted || holds(account.role, restricted);
  });
  const waitsForHr = awaitingHr(form.hrApprovalState ?? null);
  const chosen: FollowUpOwnerChoice[] = [];
  const BATCH = 8;
  for (let at = 0; at < accounts.length; at += BATCH) {
    const batch = accounts.slice(at, at + BATCH);
    const resolved = await Promise.all(
      batch.map(async (account) => {
        try {
          const candidate: FormsActor = {
            id: account.id,
            role: account.role,
            verified: true,
            scope: account.scope,
            visibility: await deps.visibilityOf(account),
            hrApprover: waitsForHr ? await deps.hrApproverOf(account.id) : false,
          };
          return mayOwnFollowUp(candidate, form, editPermission, holds) ? account : null;
        } catch {
          // A lookup that fails grants nothing.
          return null;
        }
      }),
    );
    for (const account of resolved) if (account) chosen.push({ id: account.id, name: account.name, role: account.role });
  }
  return chosen.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * THE ONE WRITE of a follow-up's owner, for the route (Form Monitoring, the form) and the AI alike. The caller has
 * already authorized ITSELF on the form (`authorizeInstance(…, "edit")`); this checks the person being named. `ownerId`
 * null (or the creator's id) gives the follow-up back to the creator.
 */
export async function assignFollowUpOwner(
  form: InstanceRow,
  ownerId: string | null,
  actorId: string,
  deps: FollowUpOwnerDeps = activeDeps(),
): Promise<{ instance: InstanceRow; owner: FollowUpOwnerChoice | null }> {
  if (ownerId === null || ownerId === form.createdBy) {
    return { instance: await setFollowUpOwner(form.id, null, actorId), owner: null };
  }
  const choices = await followUpOwnerChoices(form, deps);
  const owner = choices.find((choice) => choice.id === ownerId);
  if (!owner) {
    throw new FollowUpOwnerError("That person cannot own this follow-up: they do not have access to this form's location and its forms.", "not_allowed");
  }
  try {
    return { instance: await setFollowUpOwner(form.id, owner.id, actorId), owner };
  } catch (error) {
    if (error instanceof FollowUpOwnerError) throw error;
    throw new FollowUpOwnerError("The follow-up's owner could not be saved just now.", "not_saved");
  }
}

/** Display names for these accounts, from the user directory. A failed read names nobody (never a guess). */
export async function accountNames(ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
  const names = new Map<string, string>();
  if (wanted.length === 0) return names;
  try {
    const { data } = await getSupabaseAdmin().from("app_users").select("id, display_name").in("id", wanted);
    for (const row of (data ?? []) as { id: unknown; display_name: unknown }[]) {
      if (typeof row.id === "string" && typeof row.display_name === "string" && row.display_name.trim()) names.set(row.id, row.display_name.trim());
    }
  } catch {
    // Nobody named.
  }
  return names;
}
