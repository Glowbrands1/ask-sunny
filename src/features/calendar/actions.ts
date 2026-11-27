"use server";

import { pageIdentity } from "@/lib/auth/page";
import { activePermissionMatrix, hasPermission } from "@/lib/permissions";
import { reportingScopeOf } from "@/lib/reporting/scope/authorized-salons";
import { REMINDER_INPUT, type ReminderInput, type ReminderSaveResult } from "@/lib/calendar/reminders";
import { deleteReminderAs, saveReminderAs } from "@/lib/calendar/reminders.server";
import { MEETING_OCCURRENCE_INPUT, MEETING_SCHEDULE_INPUT, type MeetingDetails, type MeetingOccurrenceInput, type MeetingScheduleInput, type MeetingScheduleSaveResult } from "@/lib/calendar/meeting-details";
import { meetingDetailsFromHub, setMeetingOccurrenceInHub, setMeetingScheduleInHub } from "@/lib/calendar/hub";
import { loadCalendarFor } from "@/lib/calendar/load.server";
import { centralToday, isMonth, monthGrid, monthOf } from "@/lib/calendar/range";
import type { CalendarView as CalendarViewData } from "@/lib/calendar/types";
import { leadershipHubUrl } from "@/lib/config/app-switcher";
import { revalidatePath } from "next/cache";

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

/**
 * An L10's weekly day, Central time and length, set from the Calendar (the owner, 27 Nov 2026). As the verified signed-in
 * person; the Leadership Hub stores it only for the meeting's attendees and its admins, and tells the other attendees.
 */
export async function saveMeetingScheduleAction(input: MeetingScheduleInput): Promise<MeetingScheduleSaveResult> {
  const parsed = MEETING_SCHEDULE_INPUT.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const identity = await pageIdentity();
  if (!identity?.verified || !identity.email) return { ok: false, reason: "signin" };
  const result = await setMeetingScheduleInHub(identity.email, parsed.data);
  if (result.ok) revalidatePath("/calendar");
  return result;
}

/** "Only this date": one occurrence's time and length, or cancelled; the Leadership Hub decides who may and tells the attendees. */
export async function saveMeetingOccurrenceAction(input: MeetingOccurrenceInput): Promise<MeetingScheduleSaveResult> {
  const parsed = MEETING_OCCURRENCE_INPUT.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const identity = await pageIdentity();
  if (!identity?.verified || !identity.email) return { ok: false, reason: "signin" };
  const result = await setMeetingOccurrenceInHub(identity.email, parsed.data);
  if (result.ok) revalidatePath("/calendar");
  return result;
}

/** One month of the floating Calendar (calendar-popup.tsx): the Calendar page's own read, as the signed-in person. */
export type CalendarPopupData =
  | {
      ok: true;
      month: string;
      today: string;
      view: CalendarViewData;
      meetings: MeetingDetails[];
      hubUrl: string | null;
      hubCalendarUrl: string | null;
      canEditSchedules: boolean;
    }
  | { ok: false };

/**
 * The floating Calendar's month (the owner, 27 Nov 2026: "can we make the calendar pop up and be resizable so anytime we
 * go in other tabs it stays there"). Exactly what the Calendar page reads, with the same gate (view_overview) and the
 * same scope: this person's follow-ups, HR approvals, Google Reviews checks, reminders, and the L10s the Leadership Hub
 * lists for them (attendees and admins only).
 */
export async function loadCalendarPopupAction(month: string | null): Promise<CalendarPopupData> {
  const identity = await pageIdentity();
  if (!identity?.verified || !hasPermission(activePermissionMatrix(), identity.role, "view_overview")) return { ok: false };
  const today = centralToday();
  const m = month && isMonth(month) ? month : monthOf(today);
  const { from, to } = monthGrid(m);
  try {
    const [result, details] = await Promise.all([loadCalendarFor(identity, { from, to }, { origin: "", includeHub: true }), meetingDetailsFromHub(identity.email)]);
    if (!result.ok) return { ok: false };
    const hub = leadershipHubUrl();
    return {
      ok: true,
      month: m,
      today,
      view: result.view,
      meetings: details.state === "ok" ? details.meetings : [],
      hubUrl: hub || null,
      hubCalendarUrl: hub ? `${hub}/meetings/calendar` : null,
      canEditSchedules: true,
    };
  } catch {
    return { ok: false };
  }
}
