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
  "view_form_monitoring",
  "manage_form_templates",
  "manage_form_records",
  "view_videos",
  "manage_videos",
  "view_knowledge",
  "view_forms_workspace",
  "view_manager_resources",
  "view_reports",
  "view_google_reviews",
  "manage_knowledge",
  "view_ai_usage",
  "manage_users",
  "manage_integrations",
];

export const PERMISSION_LABEL: Record<Permission, string> = {
  ask_questions: "Ask Sunny questions",
  view_overview: "View the Overview dashboard",
  view_knowledge: "Read the knowledge base",
  view_forms_workspace: "Open the Forms workspace",
  view_manager_resources: "Open Manager Resources",
  create_coaching: "Prepare coaching conversations",
  view_daily_stats: "View Daily Stats",
  create_coaching_form: "Create coaching forms",
  create_corrective_action: "Create corrective action forms",
  create_epp: "Create EPP forms",
  create_policy_review: "Create policy reviews",
  view_form_monitoring: "View form monitoring",
  manage_form_templates: "Manage form templates",
  manage_form_records: "Delete and archive filed forms",
  view_videos: "View training videos",
  manage_videos: "Manage training videos",
  view_reports: "View reports & analytics",
  view_google_reviews: "View Google reviews",
  manage_knowledge: "Manage the knowledge base",
  view_ai_usage: "View AI usage & spend",
  manage_users: "Manage users",
  manage_integrations: "Manage integrations",
};

export const PERMISSION_GROUP: Record<Permission, string> = {
  ask_questions: "Assistant",
  view_overview: "Insights",
  view_knowledge: "Knowledge",
  view_forms_workspace: "Forms",
  view_manager_resources: "Tools",
  create_coaching: "Assistant",
  view_daily_stats: "Insights",
  view_reports: "Insights",
  view_google_reviews: "Insights",
  create_coaching_form: "Forms",
  create_corrective_action: "Forms",
  create_epp: "Forms",
  create_policy_review: "Forms",
  view_form_monitoring: "Forms",
  manage_form_templates: "Forms",
  manage_form_records: "Forms",
  view_videos: "Knowledge",
  manage_videos: "Knowledge",
  manage_knowledge: "Knowledge",
  view_ai_usage: "Administration",
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
  "view_form_monitoring",
  "view_videos",
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

export const DEFAULT_PERMISSION_MATRIX: PermissionMatrix = {
  employee: EMPLOYEE_PERMISSIONS,
  assistant_salon_director: [
    "ask_questions",
    "create_coaching",
    "view_daily_stats",
    "view_form_monitoring",
    "view_videos",
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
  "view_ai_usage",
  "manage_users",
  "manage_integrations",
];

export function isPermissionLockedFor(role: Role, permission: Permission) {
  if (role === "owner" || role === "developer") return true;
  return permission === "manage_users" || permission === "manage_integrations";
}
