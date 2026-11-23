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
