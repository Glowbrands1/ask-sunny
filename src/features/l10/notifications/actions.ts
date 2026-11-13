"use server";

import { listNotifications, markAllRead, markRead, unreadCount } from "@/features/l10/data.server";
import type { AppNotification } from "./types";

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
