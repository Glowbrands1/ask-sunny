"use server";

import { pageIdentity } from "@/lib/auth/page";
import { activePermissionMatrix, hasPermission } from "@/lib/permissions";
import { reportingScopeOf } from "@/lib/reporting/scope/authorized-salons";
import { REMINDER_INPUT, type ReminderInput, type ReminderSaveResult } from "@/lib/calendar/reminders";
import { deleteReminderAs, saveReminderAs } from "@/lib/calendar/reminders.server";

/**
 * "+ New event" and the chat's reminder card. As the verified signed-in person only: the owner, their email and the
 * salons a team reminder reaches come from the session, never from the browser.
 */
export async function saveReminderAction(input: ReminderInput): Promise<ReminderSaveResult> {
  const parsed = REMINDER_INPUT.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const identity = await pageIdentity();
  if (!identity?.verified || !identity.subject || !hasPermission(activePermissionMatrix(), identity.role, "view_overview")) return { ok: false, reason: "signin" };
  const scope = reportingScopeOf(identity.scope);
  try {
    return await saveReminderAs(
      { subject: identity.subject, email: identity.email ?? "", name: identity.displayName ?? "", coverage: scope.unrestricted ? null : scope.salonNumbers },
      parsed.data,
    );
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function deleteReminderAction(id: string): Promise<{ ok: boolean }> {
  const identity = await pageIdentity();
  if (!identity?.verified || !identity.subject) return { ok: false };
  try {
    return await deleteReminderAs(identity.subject, id);
  } catch {
    return { ok: false };
  }
}
