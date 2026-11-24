import { ASSISTANT_MANAGER_CREATES, assistantManagerCreateEnabled } from "./assistant-manager-create";
import type { Permission, PermissionMatrix, Role } from "@/types";

/**
 * Role -> permission configuration.
 *
 * In this phase permissions gate navigation and page content on the client so
 * the demo behaves correctly. When real authentication lands, this same matrix
 * becomes the source of truth for server-side authorization (route handlers /
 * middleware / row-level security) — the shape does not need to change.
 */

export const ROLES: Role[] = [
  "employee",
  "assistant_salon_director",
  "salon_director",
  "district_manager",
  "regional_manager",
  "admin",
  "owner",
  "developer",
];

export const ROLE_LABEL: Record<Role, string> = {
  employee: "Employee",
  assistant_salon_director: "Assistant Salon Director",
  salon_director: "Salon Director",
  district_manager: "District Manager",
  regional_manager: "Regional Manager",
  admin: "Admin",
  owner: "Owner",
  /*
   * NO LONGER "Developer / Admin". That label was the only place the word
   * "Admin" appeared as a role, so the customer's own administrator had to be
   * given a developer account to be called one. `admin` above is that role now,
   * and this one means what it says.
   */
  developer: "Developer",
};

export const ROLE_SHORT_LABEL: Record<Role, string> = {
  employee: "Employee",
  assistant_salon_director: "ASD",
  salon_director: "SD",
  district_manager: "DM",
  regional_manager: "RM",
  admin: "Admin",
  owner: "Owner",
  developer: "Dev",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  employee:
    "Frontline team member. Ask Sunny, the knowledge base and training videos — no reporting, forms or administration.",
  assistant_salon_director:
    "Supports the Salon Director. Full assistant and training access, limited form authority.",
  salon_director:
    "Runs a single salon. Coaching, forms, knowledge, training and salon reporting.",
  district_manager:
    "Owns a district. Everything a Salon Director has, plus district reporting and template management.",
  regional_manager:
    "Owns a region. District Manager access across every district they cover.",
  admin:
    "The client administrator. Full platform access including reporting, forms, AI spend, user management and integrations.",
  owner:
    "Full platform access including AI spend, user management and integrations.",
  developer: "Full platform access for build and support work.",
};

export const PERMISSIONS: Permission[] = [
  "ask_questions",
  "view_overview",
  "create_coaching",
  "view_daily_stats",
  "create_coaching_form",
  "create_corrective_action",
  "create_epp",
  "create_policy_review",
  "create_hiring_form",
  "create_exit_form",
  "create_employment_change_form",
  "view_form_monitoring",
  "manage_form_templates",
  "manage_form_records",
  "view_videos",
  "manage_videos",
  "view_ai_training",
  "view_knowledge",
  "view_forms_workspace",
  "view_manager_resources",
  "view_l10_meetings",
  "view_reports",
  "view_google_reviews",
  "manage_knowledge",
  "view_ai_usage",
  "view_analytics",
  "manage_users",
  "manage_integrations",
];

/**
 * THE PERMISSIONS THAT CREATE A FORM — one per family of templates, each the
 * `requiredPermission` of the templates it covers. An account holding none of
 * them can create no form at all, so a "Create a form" control is not offered
 * to it: the server would refuse every template it could propose.
 */
export const FORM_CREATION_PERMISSIONS: Permission[] = [
  "create_coaching_form",
  "create_corrective_action",
  "create_epp",
  "create_policy_review",
  "create_hiring_form",
  "create_exit_form",
  "create_employment_change_form",
];

export const PERMISSION_LABEL: Record<Permission, string> = {
  ask_questions: "Ask Sunny questions",
  view_overview: "View the Overview dashboard",
  view_knowledge: "Read the knowledge base",
  view_forms_workspace: "Open the Forms workspace",
  view_manager_resources: "Open Manager Resources",
  view_l10_meetings: "Open the L10 meeting link",
  create_coaching: "Prepare coaching conversations",
  view_daily_stats: "View Daily Stats",
  create_coaching_form: "Create coaching forms",
  create_corrective_action: "Create corrective action forms",
  create_epp: "Create EPP forms",
  create_policy_review: "Create policy reviews",
  create_hiring_form: "Create hiring & interview forms",
  create_exit_form: "Create resignation/exit forms",
  create_employment_change_form: "Create demotion & transfer forms",
  view_form_monitoring: "View form monitoring",
  manage_form_templates: "Manage form templates",
  manage_form_records: "Delete filed forms",
  view_videos: "View training videos",
  view_ai_training: "Open AI Training",
  manage_videos: "Manage training videos",
  view_reports: "View reports & analytics",
  view_google_reviews: "View Google reviews",
  manage_knowledge: "Manage the knowledge base",
  view_ai_usage: "View AI usage & spend",
  view_analytics: "View adoption analytics",
  manage_users: "Manage users",
  manage_integrations: "Manage integrations",
};

export const PERMISSION_GROUP: Record<Permission, string> = {
  ask_questions: "Assistant",
  view_overview: "Insights",
  view_knowledge: "Knowledge",
  view_forms_workspace: "Forms",
  view_manager_resources: "Tools",
  view_l10_meetings: "Tools",
  create_coaching: "Assistant",
  view_daily_stats: "Insights",
  view_reports: "Insights",
  view_google_reviews: "Insights",
  create_coaching_form: "Forms",
  create_corrective_action: "Forms",
  create_epp: "Forms",
  create_policy_review: "Forms",
  create_hiring_form: "Forms",
  create_exit_form: "Forms",
  create_employment_change_form: "Forms",
  view_form_monitoring: "Forms",
  manage_form_templates: "Forms",
  manage_form_records: "Forms",
  view_videos: "Knowledge",
  view_ai_training: "Knowledge",
  manage_videos: "Knowledge",
  manage_knowledge: "Knowledge",
  view_ai_usage: "Administration",
  view_analytics: "Administration",
  manage_users: "Administration",
  manage_integrations: "Administration",
};

/**
 * THE FRONTLINE ROLE, AND THE ONLY ROLE DEFINED AS A CLOSED LIST.
 *
 * Three capabilities, enumerated: Ask Sunny, the knowledge base, training
 * videos. Everything else is denied by ABSENCE rather than by exclusion, which
 * is what makes it fail closed — a permission added to the app next month is
 * denied to Employee automatically, because nobody has to remember to leave it
 * out of a list of things Employee cannot do.
 *
 * `view_knowledge` WITHOUT `manage_knowledge` is the whole point of splitting
 * those two: read the company's policies, never upload, delete or reindex them.
 * Same shape for `view_videos` without `manage_videos`.
 */
const EMPLOYEE_PERMISSIONS: Permission[] = [
  "ask_questions",
  "view_knowledge",
  "view_videos",
  // AI Training is for every member of staff, frontline included.
  "view_ai_training",
];

const SALON_DIRECTOR_PERMISSIONS: Permission[] = [
  "ask_questions",
  "create_coaching",
  "view_daily_stats",
  /*
   * THE THREE NEW GATES ARE GRANTED HERE ON PURPOSE.
   *
   * A Salon Director could already open the Overview, the knowledge base, the
   * Forms workspace and Manager Resources — those pages simply had no
   * permission to check. Adding the checks without adding these grants would
   * have taken working functionality away from every manager, which is a
   * regression dressed as a security fix. The client has not finalised the
   * SD/DM/RM matrix, so this milestone preserves what they had.
   */
  "view_overview",
  "view_knowledge",
  "view_forms_workspace",
  "view_manager_resources",
  "create_coaching_form",
  "create_corrective_action",
  "create_policy_review",
  /*
   * HIRING SITS WITH THE SALON DIRECTOR because the Salon Director is who these
   * four forms are addressed to: every one of them has a "Salon Name" line and
   * a walkthrough of an operating salon, and the prescreening call is answered
   * at the salon's own phone. Granting it here matches the existing grants
   * rather than widening anyone's access — the same roles that could already
   * create a coaching form can now create an interview form.
   */
  "create_hiring_form",
  /*
   * THE EXIT FORM SITS WITH THE CORRECTIVE ACTION FORM. A Salon Director can
   * already file the formal warning that precedes most separations, and the
   * exit form is the salon's own paperwork for the person leaving it. The
   * Assistant Salon Director and the frontline role get neither.
   */
  "create_exit_form",
  /*
   * DEMOTION AND TRANSFER FORMS SIT WITH THE SALON DIRECTOR for the same
   * reason: the Salon Director can already file a Corrective Action Form,
   * whose Type of Warning offers Demotion. Granting these to the same roles
   * widens nobody's authority over an employment record.
   */
  "create_employment_change_form",
  "view_form_monitoring",
  "view_videos",
  "view_ai_training",
  "view_reports",
  "view_google_reviews",
];

const DISTRICT_MANAGER_PERMISSIONS: Permission[] = [
  ...SALON_DIRECTOR_PERMISSIONS,
  "create_epp",
  "manage_form_templates",
  /*
   * REMOVING A FILED FORM IS ITS OWN PERMISSION, not a side effect of being
   * able to read the monitoring list. Deleting a draft destroys somebody's
   * work and archiving hides an HR record, so it sits with the roles that
   * already administer Forms rather than with everyone who can see the table.
   */
  "manage_form_records",
  "manage_knowledge",
  "manage_videos",
];

const FULL_ACCESS: Permission[] = [...PERMISSIONS];

/**
 * ASD_NO_FORM_MONITORING (Pau, 26 Oct 2026, a manager's request; this app
 * only): an Assistant Salon Director no longer sees Form Monitoring — the
 * list, other people's forms and the counts. They still create coaching forms
 * and open the ones they created (`authorizeInstance`). READ AT BUILD TIME: a
 * literal `process.env.NEXT_PUBLIC_…` that Next inlines into the browser and
 * the server bundles alike, so the navigation and the server can never
 * disagree; it takes effect with the next deployment. Off, as before.
 */
export function asdNoFormMonitoringEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_ASD_NO_FORM_MONITORING_ENABLED;
  return typeof raw === "string" && ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

export const DEFAULT_PERMISSION_MATRIX: PermissionMatrix = {
  employee: EMPLOYEE_PERMISSIONS,
  assistant_salon_director: [
    "ask_questions",
    "create_coaching",
    "view_daily_stats",
    /*
     * NEXT_PUBLIC_ASSISTANT_MANAGER_CREATE_ENABLED (Pau, 30 Oct 2026): the Salon
     * Director's forms to create, and Form Monitoring back even with the ASD
     * flag on, limited to their own forms (`private-creators.ts`).
     */
    ...(assistantManagerCreateEnabled()
      ? (["view_form_monitoring", ...ASSISTANT_MANAGER_CREATES] as Permission[])
      : asdNoFormMonitoringEnabled()
        ? []
        : (["view_form_monitoring"] as Permission[])),
    "view_videos",
    "view_ai_training",
    "view_google_reviews",
    // Previously reachable, so still reachable — see SALON_DIRECTOR_PERMISSIONS.
    "view_overview",
    "view_knowledge",
    "view_manager_resources",
  ],
  salon_director: SALON_DIRECTOR_PERMISSIONS,
  district_manager: DISTRICT_MANAGER_PERMISSIONS,
  regional_manager: [...DISTRICT_MANAGER_PERMISSIONS, "view_ai_usage"],
  /*
   * THE CLIENT ADMINISTRATOR: everything. Same set as owner and developer, and
   * a separate entry because they are separate roles — see `Role`.
   */
  admin: FULL_ACCESS,
  owner: FULL_ACCESS,
  developer: FULL_ACCESS,
};

/**
 * Admin console access, and deliberately NOT editable from the permissions
 * matrix UI.
 *
 * `admin` joins owner and developer because the client administrator is the
 * person this console exists for. Mirrored by the last-admin trigger in
 * `20260904006000_app_users.sql`, which counts exactly these three as
 * administrative — a test asserts the two lists match, because the trigger is
 * what stops the app being left with nobody who can administer it.
 */
export const ADMIN_CONSOLE_ROLES: Role[] = ["admin", "owner", "developer"];

export function canAccessAdminConsole(role: Role): boolean {
  return ADMIN_CONSOLE_ROLES.includes(role);
}

export function hasPermission(
  matrix: PermissionMatrix,
  role: Role,
  permission: Permission,
): boolean {
  return matrix[role]?.includes(permission) ?? false;
}

export function togglePermission(
  matrix: PermissionMatrix,
  role: Role,
  permission: Permission,
): PermissionMatrix {
  const current = matrix[role] ?? [];
  const next = current.includes(permission)
    ? current.filter((entry) => entry !== permission)
    : [...current, permission];
  return { ...matrix, [role]: next };
}

/** Permission keys that are locked to admin roles in the matrix UI. */
export const ADMIN_ONLY_PERMISSIONS: Permission[] = [
  /*
   * L10 IS ADMINISTRATOR-ONLY AT THE CLIENT'S REQUEST, "for now".
   *
   * Listed here as well as withheld from every manager grant, so the matrix UI
   * shows it locked rather than offering a checkbox that would widen it. The
   * word "for now" is theirs: when they open it up, this line and the grants
   * are the whole change, and nothing about where the link is rendered moves.
   */
  "view_l10_meetings",
  "view_ai_usage",
  "view_analytics",
  "manage_users",
  "manage_integrations",
];

export function isPermissionLockedFor(role: Role, permission: Permission) {
  /*
   * ADMIN_CONSOLE_ROLES, not a hand-written pair.
   *
   * This read `role === "owner" || role === "developer"` and was left behind
   * when `admin` was added. The effect was narrow and badly misleading: the
   * matrix would show the CLIENT ADMINISTRATOR with `manage_users` unchecked —
   * locked off as though they were a manager — on the very screen an
   * administrator reads to learn what they can do. Their actual access was
   * never affected; only the picture of it was, which is arguably worse on a
   * screen whose whole job is to describe access accurately.
   */
  if ((ADMIN_CONSOLE_ROLES as readonly Role[]).includes(role)) return true;
  return (
    permission === "manage_users" ||
    permission === "manage_integrations" ||
    /*
     * L10 IS LOCKED OFF FOR EVERY MANAGER ROLE, at the client's request that it
     * be "restricted to admin accounts only for now". Locking it is what stops
     * the matrix screen offering a tick that would widen it.
     *
     * NOT `ADMIN_ONLY_PERMISSIONS` WHOLESALE, deliberately. That list also holds
     * `view_ai_usage`, which the Regional Manager really does have — locking it
     * would render their cell unchecked and describe their access wrongly on the
     * one screen whose job is to describe it accurately. That is the exact bug
     * the note above this function records; adding the one permission that is
     * genuinely administrator-only avoids repeating it.
     */
    permission === "view_l10_meetings"
  );
}

/*
 * ============================================================================
 * SAVED CHANGES TO THE MATRIX (Pau, 23 Nov 2026)
 * ============================================================================
 *
 * An administrator ticks and unticks cells on the Permissions screen; what is
 * saved is an OVERRIDE per role, kept in `permission_overrides`. The matrix
 * that is ENFORCED (server) and used for `can()` (browser) is the defaults with
 * those overrides merged over them: `activePermissionMatrix()`.
 *
 * A role with no override uses the defaults, so an empty table changes nothing,
 * and an override replaces the flag-shaped defaults for that role (ASD under
 * `assistantManagerCreateEnabled` / `asdNoFormMonitoringEnabled`): somebody
 * saved it on purpose.
 *
 * WHAT AN OVERRIDE CAN NEVER DO, whatever is stored: change the administrator
 * roles (full access), or touch a cell that is not editable
 * (`isPermissionEditableFor`). `sanitizeOverrides` drops those and anything
 * unknown, so a hand-edited row cannot lock the administrators out or hand a
 * manager an administrator screen.
 */

/** Role -> the WHOLE permission list for that role. A role absent here uses the defaults. */
export type PermissionOverrides = Partial<Record<Role, Permission[]>>;

/**
 * Whether the matrix screen may change this cell.
 *
 * Not editable: anything for an administrator role; the locked cells
 * (`isPermissionLockedFor`); and the administrator-only permissions
 * (`ADMIN_ONLY_PERMISSIONS`) for a role that does not hold them by default —
 * the Regional Manager's `view_ai_usage` can be taken away, but nobody else can
 * be given spend or adoption analytics.
 */
export function isPermissionEditableFor(role: Role, permission: Permission): boolean {
  if (isPermissionLockedFor(role, permission)) return false;
  if (ADMIN_ONLY_PERMISSIONS.includes(permission) && !hasPermission(DEFAULT_PERMISSION_MATRIX, role, permission)) {
    return false;
  }
  return true;
}

const KNOWN_ROLES = new Set<string>(ROLES);
const KNOWN_PERMISSIONS = new Set<string>(PERMISSIONS);

/** Keeps only what may be enforced: known roles, known keys, editable cells. Never throws. */
export function sanitizeOverrides(raw: unknown): PermissionOverrides {
  const out: PermissionOverrides = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [role, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!KNOWN_ROLES.has(role) || !Array.isArray(list)) continue;
    const r = role as Role;
    if (canAccessAdminConsole(r)) continue;
    const kept = new Set<Permission>();
    for (const entry of list) {
      if (typeof entry === "string" && KNOWN_PERMISSIONS.has(entry) && isPermissionEditableFor(r, entry as Permission)) {
        kept.add(entry as Permission);
      }
    }
    out[r] = PERMISSIONS.filter((permission) => kept.has(permission));
  }
  return out;
}

/** The defaults with `overrides` merged over them. Fixed cells always keep their default. */
export function effectiveMatrix(
  overrides: unknown,
  defaults: PermissionMatrix = DEFAULT_PERMISSION_MATRIX,
): PermissionMatrix {
  const clean = sanitizeOverrides(overrides);
  const out = {} as PermissionMatrix;
  for (const role of ROLES) {
    const base = defaults[role] ?? [];
    const override = clean[role];
    if (!override) {
      out[role] = base;
      continue;
    }
    const fixed = base.filter((permission) => !isPermissionEditableFor(role, permission));
    out[role] = PERMISSIONS.filter((permission) => override.includes(permission) || fixed.includes(permission));
  }
  return out;
}

/**
 * What to store for a full matrix (the screen's draft): only roles whose
 * editable cells differ from the defaults, so a role ticked back to its default
 * goes back to following the defaults.
 */
export function overridesFromMatrix(
  matrix: PermissionMatrix,
  defaults: PermissionMatrix = DEFAULT_PERMISSION_MATRIX,
): PermissionOverrides {
  const out: PermissionOverrides = {};
  for (const role of ROLES) {
    if (canAccessAdminConsole(role)) continue;
    const editable = PERMISSIONS.filter((permission) => isPermissionEditableFor(role, permission));
    const chosen = editable.filter((permission) => matrix[role]?.includes(permission));
    const wanted = editable.filter((permission) => defaults[role]?.includes(permission));
    if (chosen.join() !== wanted.join()) out[role] = chosen;
  }
  return out;
}

let activeOverrides: PermissionOverrides = {};
let activeMatrix: PermissionMatrix = DEFAULT_PERMISSION_MATRIX;

/**
 * THE MATRIX IN FORCE RIGHT NOW. Synchronous, so the ~30 places that ask
 * "may this role?" stay synchronous. On the server `ensurePermissionsLoaded()`
 * (`store.ts`) refreshes it at the start of every authorized request and page;
 * in the browser the session loads it from `/api/admin/permissions`. Until
 * something has loaded it, it IS the defaults — never anything wider.
 */
export function activePermissionMatrix(): PermissionMatrix {
  return activeMatrix;
}

export function activePermissionOverrides(): PermissionOverrides {
  return activeOverrides;
}

/** Replaces the saved overrides (sanitized). Called by the loader and the session, and by tests. */
export function setActivePermissionOverrides(raw: unknown): void {
  activeOverrides = sanitizeOverrides(raw);
  activeMatrix = effectiveMatrix(activeOverrides);
}
