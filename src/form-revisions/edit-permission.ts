import type { Permission } from "@/types";

/**
 * ============================================================================
 * WHO MAY EDIT A FORM: THE SERVER'S ANSWER, READ IN THE BROWSER
 * ============================================================================
 *
 * Every edit is authorized by `authorizeInstance(request, id, "edit")`
 * (`src/lib/forms/instance-scope.ts`), which needs the form's TEMPLATE
 * permission (its `requiredPermission`: the permission that creates it), or
 * `manage_form_templates` when the library no longer has that template.
 * Seeing the forms list (`view_form_monitoring`) is not enough, so Edit is
 * offered only to a role holding this.
 *
 * The browser cannot load the template library (it is server-sized), so this
 * is a copy keyed by the template's name. The seed is the only author of a
 * template's name and of its permission (`syncTemplateDisplay` in
 * `repository.ts`), and `edit-permission.test.ts` fails the moment this copy
 * and `TEMPLATE_SEEDS` disagree. The server stays the authority: this only
 * decides what to offer.
 */
export const EDIT_PERMISSION_BY_TEMPLATE: Readonly<Record<string, Permission>> = {
  "Coaching Form": "create_coaching_form",
  "Corrective Action Form": "create_corrective_action",
  "Policy Review": "create_policy_review",
  "SDIT EPP": "create_epp",
  "TSD EPP": "create_epp",
  "ASD-SDIT Performance EPP": "create_epp",
  "FTTC Performance EPP": "create_epp",
  "DMIT EPP — TSD Review": "create_epp",
  "DMIT EPP — DMIT Review": "create_epp",
  "Follow-Up Coaching Form": "create_coaching_form",
  "Resignation/Exit Form": "create_exit_form",
  "Demotion Form": "create_employment_change_form",
  "Position Transfer Form": "create_employment_change_form",
  "Prescreen / Phone Interview Form": "create_hiring_form",
  "Tanning Consultant Interview Form": "create_hiring_form",
  "First Round Management Interview Form": "create_hiring_form",
  "Second Round Management Interview Form": "create_hiring_form",
};

/** The permission editing a form of this template needs, as the server decides it. */
export function editPermissionFor(templateName: string): Permission {
  return Object.hasOwn(EDIT_PERMISSION_BY_TEMPLATE, templateName)
    ? EDIT_PERMISSION_BY_TEMPLATE[templateName]!
    : "manage_form_templates";
}
