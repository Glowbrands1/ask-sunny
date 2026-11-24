import "server-only";

import { createNotifications } from "@/lib/notifications/repository";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * THE BELL ITEMS HR APPROVAL WRITES. Every one links to the form's record page,
 * which only the creator and HR may open while it waits, so a bell can never
 * lead anybody else to it. Failures are logged and never thrown: a missed bell
 * must not undo the approval step that wrote it.
 */
export const HR_REQUEST_KIND = "form_hr_approval_request";
export const HR_DECISION_KIND = "form_hr_approval_decision";
export const HR_COMMENT_KIND = "form_hr_approval_comment";
export const HR_REMINDER_KIND = "form_hr_approval_reminder";
/** The sender's own receipt: "You sent a form for HR approval" (owner, 24 Nov 2026). */
export const HR_SENT_KIND = "form_hr_approval_sent";
/** HR's: the manager changed a form while it waits for them, so HR reads the updated version (owner, 24 Nov 2026). */
export const HR_UPDATED_KIND = "form_hr_approval_updated";

export function formHref(instanceId: string): string {
  return `/forms/hr-approval/${instanceId}`;
}

export const HR_PENDING_TAB_HREF = "/forms/monitoring?view=hr";

export async function ringBells(
  rows: { recipientEmail: string; kind: string; title: string; body: string; href: string | null }[],
): Promise<void> {
  try {
    await createNotifications(rows.filter((row) => row.recipientEmail.length > 0));
  } catch (error) {
    console.error("[hr-approval] could not ring the bell", error instanceof Error ? error.message : error);
  }
}

/**
 * Of these recipients, those with no UNREAD item of this kind for this form yet. A card saves as the manager types, so
 * "the form was updated" rings once until it is read, never once per save.
 */
export async function withoutUnread(kind: string, href: string, emails: readonly string[]): Promise<string[]> {
  if (emails.length === 0) return [];
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("app_notifications")
      .select("recipient_email")
      .eq("kind", kind)
      .eq("href", href)
      .is("read_at", null);
    if (error) throw new Error(error.message);
    const unread = new Set(((data ?? []) as { recipient_email: string }[]).map((row) => row.recipient_email));
    return emails.filter((email) => !unread.has(email));
  } catch (error) {
    console.error("[hr-approval] could not read the unread bells", error instanceof Error ? error.message : error);
    return [...emails];
  }
}

/**
 * A form that stopped waiting (deleted, withdrawn, decided): HR's "waiting for
 * your approval" items for it are marked read, so the bell does not point at a
 * form that is no longer theirs to act on.
 */
export async function clearRequestBells(instanceId: string): Promise<void> {
  try {
    const { error } = await getSupabaseAdmin()
      .from("app_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("kind", HR_REQUEST_KIND)
      .eq("href", formHref(instanceId))
      .is("read_at", null);
    if (error) throw new Error(error.message);
  } catch (error) {
    console.error("[hr-approval] could not clear the request bells", error instanceof Error ? error.message : error);
  }
}
