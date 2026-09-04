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
  "assistant_salon_director",
  "salon_director",
  "district_manager",
  "regional_manager",
  "owner",
  "developer",
];

export const ROLE_LABEL: Record<Role, string> = {
  assistant_salon_director: "Assistant Salon Director",
  salon_director: "Salon Director",
  district_manager: "District Manager",
  regional_manager: "Regional Manager",
  owner: "Owner",
  developer: "Developer / Admin",
};

export const ROLE_SHORT_LABEL: Record<Role, string> = {
  assistant_salon_director: "ASD",
  salon_director: "SD",
  district_manager: "DM",
  regional_manager: "RM",
  owner: "Owner",
  developer: "Admin",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  assistant_salon_director:
    "Supports the Salon Director. Full assistant and training access, limited form authority.",
  salon_director:
    "Runs a single salon. Coaching, forms, knowledge, training and salon reporting.",
  district_manager:
    "Owns a district. Everything a Salon Director has, plus district reporting and template management.",
  regional_manager:
    "Owns a region. District Manager access across every district they cover.",
  owner:
    "Full platform access including AI spend, user management and integrations.",
  developer: "Full platform access for build and support work.",
};

export const PERMISSIONS: Permission[] = [
  "ask_questions",
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
  "view_reports",
  "view_google_reviews",
  "manage_knowledge",
  "view_ai_usage",
  "manage_users",
  "manage_integrations",
];

export const PERMISSION_LABEL: Record<Permission, string> = {
  ask_questions: "Ask Sunny questions",
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

const SALON_DIRECTOR_PERMISSIONS: Permission[] = [
  "ask_questions",
  "create_coaching",
  "view_daily_stats",
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
  assistant_salon_director: [
    "ask_questions",
    "create_coaching",
    "view_daily_stats",
    "view_form_monitoring",
    "view_videos",
    "view_google_reviews",
  ],
  salon_director: SALON_DIRECTOR_PERMISSIONS,
  district_manager: DISTRICT_MANAGER_PERMISSIONS,
  regional_manager: [...DISTRICT_MANAGER_PERMISSIONS, "view_ai_usage"],
  owner: FULL_ACCESS,
  developer: FULL_ACCESS,
};

/**
 * Admin console access is fixed to Owner + Developer and is deliberately NOT
 * editable from the permissions matrix UI.
 */
export const ADMIN_CONSOLE_ROLES: Role[] = ["owner", "developer"];

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
