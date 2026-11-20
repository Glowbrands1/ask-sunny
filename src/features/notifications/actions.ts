"use server";

import { revalidatePath } from "next/cache";

import { pageIdentity } from "@/lib/auth/page";
import { markNotificationsRead } from "@/lib/notifications/repository";

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
