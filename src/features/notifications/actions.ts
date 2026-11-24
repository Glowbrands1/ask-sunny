"use server";

import { revalidatePath } from "next/cache";

import { pageIdentity } from "@/lib/auth/page";
import { dismissNotifications, markNotificationsRead } from "@/lib/notifications/repository";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Marks the SIGNED-IN person's own notifications read — the given ids, or all
 * of them. The recipient is never taken from the browser: it is the caller's
 * email, so nobody can clear someone else's bell.
 */
export async function markNotificationsReadAction(ids: string[] | null): Promise<{ ok: boolean }> {
  const identity = await pageIdentity();
  if (!identity?.email) return { ok: false };
  const list = ids === null ? null : (Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string" && UUID.test(id)).slice(0, 100);
  try {
    await markNotificationsRead(identity.email, list);
  } catch (error) {
    console.error("[notifications] could not mark read:", error);
    return { ok: false };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Removes the SIGNED-IN person's own notifications from their bell: the given ids (the × on a row), or all of them
 * (Clear all). As with marking read, the recipient is the caller's email, never taken from the browser, so nobody can
 * remove someone else's notifications.
 */
export async function dismissNotificationsAction(ids: string[] | null): Promise<{ ok: boolean }> {
  const identity = await pageIdentity();
  if (!identity?.email) return { ok: false };
  const list = ids === null ? null : (Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string" && UUID.test(id)).slice(0, 100);
  try {
    await dismissNotifications(identity.email, list);
  } catch (error) {
    console.error("[notifications] could not remove:", error);
    return { ok: false };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
