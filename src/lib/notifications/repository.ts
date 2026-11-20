import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import { safeNotificationHref, type AppNotification, type BellData, type NewNotification } from "./types";

/**
 * THE BELL'S STORE — `app_notifications`, read and written on the server under
 * the secret key, always scoped to one recipient's email (RLS lets no browser
 * read it; see the migration).
 */

interface NotificationDb {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  created_at: string;
  read_at: string | null;
}

const COLUMNS = "id, kind, title, body, href, created_at, read_at";
const normalise = (email: string) => email.trim().toLowerCase();

function row(r: NotificationDb): AppNotification {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    href: safeNotificationHref(r.href),
    createdAt: r.created_at,
    readAt: r.read_at,
  };
}

export async function createNotifications(rows: NewNotification[]): Promise<void> {
  if (!rows.length) return;
  const { error } = await getSupabaseAdmin()
    .from("app_notifications")
    .insert(
      rows.map((n) => ({
        recipient_email: normalise(n.recipientEmail),
        kind: n.kind,
        title: n.title.slice(0, 300),
        body: n.body.slice(0, 2000),
        href: safeNotificationHref(n.href),
      })),
    );
  if (error) throw new Error(`Could not save the notification: ${error.message}`);
}

/** The newest notifications for one person, and how many are unread. */
export async function listNotifications(email: string, limit = 20): Promise<BellData> {
  const db = getSupabaseAdmin();
  const to = normalise(email);
  const [list, count] = await Promise.all([
    db.from("app_notifications").select(COLUMNS).eq("recipient_email", to).order("created_at", { ascending: false }).limit(limit),
    db.from("app_notifications").select("id", { count: "exact", head: true }).eq("recipient_email", to).is("read_at", null),
  ]);
  if (list.error) throw new Error(`Could not read notifications: ${list.error.message}`);
  if (count.error) throw new Error(`Could not count notifications: ${count.error.message}`);
  return { items: (list.data as NotificationDb[]).map(row), unread: count.count ?? 0 };
}

/** Marks the caller's own notifications read: the given ids, or all of them. */
export async function markNotificationsRead(email: string, ids: string[] | null): Promise<void> {
  let query = getSupabaseAdmin()
    .from("app_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_email", normalise(email))
    .is("read_at", null);
  if (ids) {
    if (!ids.length) return;
    query = query.in("id", ids);
  }
  const { error } = await query;
  if (error) throw new Error(`Could not mark notifications read: ${error.message}`);
}
