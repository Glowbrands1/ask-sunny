import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import { hrApprovalEnabled } from "./hr-approval-rules";

/**
 * WHO APPROVES FORMS AS HR: the accounts with an unrevoked row in
 * `form_hr_approvers` (migration 20261123001000), keyed to the account id like
 * `forms_all_store_access`. Being on it is what makes an account "HR" inside
 * the app; their role is untouched.
 *
 * Read only while FORMS_HR_APPROVAL_ENABLED is on. Every failure answers "not
 * an approver" — which hides waiting forms from that reader rather than showing
 * them to anybody.
 */
export async function resolveHrApprover(subject: string | null | undefined): Promise<boolean> {
  if (!hrApprovalEnabled() || !subject) return false;
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("form_hr_approvers")
      .select("app_user_id")
      .eq("app_user_id", subject)
      .is("revoked_at", null)
      .maybeSingle();
    return !error && data !== null;
  } catch {
    return false;
  }
}

export interface HrApproverAccount {
  id: string;
  email: string;
}

/** Every active approver with the email the bell addresses them by. Empty on any failure. */
export async function listHrApprovers(): Promise<HrApproverAccount[]> {
  if (!hrApprovalEnabled()) return [];
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("form_hr_approvers").select("app_user_id").is("revoked_at", null).limit(50);
    if (error || !data || data.length === 0) return [];
    const ids = (data as { app_user_id: unknown }[])
      .map((row) => row.app_user_id)
      .filter((id): id is string => typeof id === "string");
    const users = await supabase.from("app_users").select("id, email, status").in("id", ids);
    if (users.error || !users.data) return [];
    return (users.data as { id: unknown; email: unknown; status: unknown }[])
      .filter((row) => row.status === "active" && typeof row.email === "string" && typeof row.id === "string")
      .map((row) => ({ id: row.id as string, email: (row.email as string).trim().toLowerCase() }));
  } catch {
    return [];
  }
}

/** The email the bell addresses an account by, or null. */
export async function accountEmail(appUserId: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabaseAdmin().from("app_users").select("email").eq("id", appUserId).maybeSingle();
    if (error || !data || typeof (data as { email?: unknown }).email !== "string") return null;
    return ((data as { email: string }).email).trim().toLowerCase();
  } catch {
    return null;
  }
}

/**
 * WHETHER THE HOLD IS LIVE: the flag on and at least one active approver. Only then is a pending form kept from its
 * creator. Off, or with nobody left to approve (the flag turned off, the last approver revoked), a pending form would
 * otherwise be frozen with no way out, so its creator's edit or Finalize releases it (`releaseStaleHold`).
 */
export async function hrHoldLive(): Promise<boolean> {
  return hrApprovalEnabled() && (await listHrApprovers()).length > 0;
}

/** A pending form whose hold is no longer live goes back to an ordinary draft. Only a `pending` row is touched. */
export async function releaseStaleHold(instanceId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("form_instances")
    .update({ hr_approval_state: null, hr_approval_requested_at: null })
    .eq("id", instanceId)
    .eq("hr_approval_state", "pending");
  if (error) throw new Error(`Could not release the form from HR approval: ${error.message}`);
}
