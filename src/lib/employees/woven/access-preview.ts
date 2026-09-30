import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { classifyStatusError } from "./status";
import { EMPLOYMENT_STATUSES, type EmploymentStatus } from "./types";
import type { AccessPreviewRow } from "./view-types";
import { domainEligible, employeeName } from "./views";

/**
 * ============================================================================
 * THE ACCESS PREVIEW — what later phases WOULD do, as questions
 * ============================================================================
 *
 * READ-ONLY, AND IT CHANGES NOBODY. `employee_access_preview` sets each Woven
 * employee beside the Ask Sunny login that shares their email, if any, and
 * answers four questions a later, separately approved phase would act on:
 * would they be provisioned at first login, would their login be disabled,
 * does their confirmed position map to a different role, does their mapped
 * primary salon differ from their salon scope. Nothing reads these answers to
 * act; phase one has no code path that writes a login, a role or a scope.
 *
 * THE LOGIN-EMAIL RULE IS APPLIED HERE, not in SQL, because it is
 * configuration (`WOVEN_LOGIN_EMAIL_DOMAINS`). While it is unset, nobody is a
 * provisioning candidate.
 */

const PAGE = 1000;

export async function loadAccessPreviewRows(loginEmailDomains: readonly string[]): Promise<AccessPreviewRow[]> {
  const db = getSupabaseAdmin();
  const preview: Record<string, unknown>[] = [];
  const names = new Map<string, string>();

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("employee_access_preview")
      .select("*")
      .order("employee_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw classifyStatusError(error);
    const page = (data ?? []) as Record<string, unknown>[];
    preview.push(...page);
    if (page.length < PAGE) break;
  }
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("employee_access_directory")
      .select("id, first_name, last_name, preferred_first_name")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw classifyStatusError(error);
    const page = (data ?? []) as Record<string, unknown>[];
    for (const row of page) {
      names.set(
        String(row.id),
        employeeName({
          firstName: typeof row.first_name === "string" ? row.first_name : null,
          lastName: typeof row.last_name === "string" ? row.last_name : null,
          preferredFirstName: typeof row.preferred_first_name === "string" ? row.preferred_first_name : null,
        }),
      );
    }
    if (page.length < PAGE) break;
  }

  return preview.map((row) => accessPreviewRowFromView(row, names.get(String(row.employee_id)) ?? "(no name in Woven)", loginEmailDomains));
}

export function accessPreviewRowFromView(
  row: Record<string, unknown>,
  name: string,
  loginEmailDomains: readonly string[],
): AccessPreviewRow {
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const email = str(row.email_address);
  const status = (EMPLOYMENT_STATUSES as readonly string[]).includes(String(row.employment_status))
    ? (row.employment_status as EmploymentStatus)
    : "unknown";
  const eligible = domainEligible(email, loginEmailDomains);
  return {
    employeeId: String(row.employee_id),
    externalEmployeeId: String(row.external_employee_id),
    employeeName: name,
    employmentStatus: status,
    emailAddress: email,
    emailIsDuplicated: row.email_is_duplicated === true,
    emailDomainEligible: eligible,
    positionMappingConfirmed: row.position_mapping_confirmed === true,
    mappedRole: str(row.mapped_role),
    mappedScopeLevel: str(row.mapped_scope_level),
    mappedPrimarySalonNumber: str(row.mapped_primary_salon_number),
    appUserRole: str(row.app_user_role),
    appUserStatus: str(row.app_user_status),
    appUserScopeLevel: str(row.app_user_scope_level),
    appUserScopePrimaryAreaId: str(row.app_user_scope_primary_area_id),
    hasLogin: row.app_user_id !== null && row.app_user_id !== undefined,
    /* The SQL answer AND the configured login-email rule. */
    wouldProvision: row.would_provision_candidate === true && eligible,
    wouldDeactivate: row.would_deactivate_candidate === true,
    roleDiffers: row.role_differs === true,
    primarySalonDiffers: row.primary_salon_differs === true,
    roleOverride: str(row.role_override),
    effectiveRole: str(row.effective_role),
    effectiveScopeLevel: str(row.effective_scope_level),
    roleSource: row.role_source === "override" || row.role_source === "position" ? row.role_source : "none",
  };
}
