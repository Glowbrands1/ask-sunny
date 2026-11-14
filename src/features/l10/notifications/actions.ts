"use server";

import { listNotifications, markAllRead, markRead, sendNote, unreadCount } from "@/features/l10/data.server";
import { isMeetingKey } from "@/features/l10/lib/config";
import type { AppNotification, NoteResult } from "./types";

/**
 * The bell's Server Functions: the same names, inputs and checks as the Leadership Hub's
 * src/app/notifications/actions.ts. They act only for the verified signed-in person (data.server.ts), and the Hub's
 * database only ever reads or marks that person's own notes, for the meetings Ask Sunny may open.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function unreadCountAction(): Promise<number | null> {
  return unreadCount();
}

export async function listNotificationsAction(): Promise<{ ok: true; notifications: AppNotification[] } | { ok: false }> {
  const r = await listNotifications(100);
  return r.ok ? r : { ok: false };
}

export async function markReadAction(ids: string[]): Promise<{ ok: boolean }> {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || !ids.every((i) => typeof i === "string" && UUID.test(i))) return { ok: false };
  return { ok: await markRead(ids) };
}

export async function markAllReadAction(): Promise<{ ok: boolean }> {
  return { ok: await markAllRead() };
}

/**
 * Sends a note the person approved on the assistant's note card (they pressed Send): the same checks as the Hub's
 * sendNoteAction. `ref` is the assistant's draft id, so pressing Send twice never sends twice. The person is the
 * verified session's; the recipients must be on the meeting's list from the Hub (data.server.ts checks).
 */
export async function sendNoteAction(meetingKey: string, recipientIds: string[], text: string, ref: string): Promise<NoteResult> {
  if (typeof meetingKey !== "string" || !isMeetingKey(meetingKey)) return { ok: false, reason: "invalid" };
  if (!Array.isArray(recipientIds) || recipientIds.length === 0 || recipientIds.length > 10 || !recipientIds.every((i) => typeof i === "string" && UUID.test(i))) return { ok: false, reason: "invalid" };
  if (typeof text !== "string" || !text.trim() || text.length > 500) return { ok: false, reason: "invalid" };
  if (typeof ref !== "string" || !/^[A-Za-z0-9_-]{1,60}$/.test(ref)) return { ok: false, reason: "invalid" };
  return sendNote({ meetingKey, recipientIds, text: text.trim(), ref });
}
