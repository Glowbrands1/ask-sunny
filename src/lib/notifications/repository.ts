import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import { PINNED_REQUEST_KIND, pinnedIds } from "./pinned";
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

function row(r: NotificationDb, pinned: boolean): AppNotification {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    href: safeNotificationHref(r.href),
    createdAt: r.created_at,
    // A pinned item reads as unread until its matter is settled, even for someone who opened it before (pinned.ts).
    readAt: pinned ? null : r.read_at,
    ...(pinned ? { pinned: true } : {}),
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

/** The newest notifications for one person, and how many are unread (pinned ones count as unread, see pinned.ts). */
export async function listNotifications(email: string, limit = 20): Promise<BellData> {
  const db = getSupabaseAdmin();
  const to = normalise(email);
  const [list, count, requests] = await Promise.all([
    db.from("app_notifications").select(COLUMNS).eq("recipient_email", to).order("created_at", { ascending: false }).limit(limit),
    db.from("app_notifications").select("id", { count: "exact", head: true }).eq("recipient_email", to).is("read_at", null),
    // Every one of this person's approval requests, beyond the list's limit too, so the count includes each pinned one.
    db.from("app_notifications").select("id, kind, href, read_at").eq("recipient_email", to).eq("kind", PINNED_REQUEST_KIND),
  ]);
  if (list.error) throw new Error(`Could not read notifications: ${list.error.message}`);
  if (count.error) throw new Error(`Could not count notifications: ${count.error.message}`);
  if (requests.error) throw new Error(`Could not read notifications: ${requests.error.message}`);
  const requestRows = (requests.data ?? []) as { id: string; kind: string; href: string | null; read_at: string | null }[];
  const pinned = await pinnedIds(requestRows);
  const pinnedButRead = requestRows.filter((r) => pinned.has(r.id) && r.read_at !== null).length;
  return {
    items: (list.data as NotificationDb[]).map((r) => row(r, pinned.has(r.id))),
    unread: (count.count ?? 0) + pinnedButRead,
  };
}

/** Of the caller's rows matching the query (`ids`, or all of them), the ids that are not pinned now. */
async function unpinned(to: string, ids: string[] | null, unreadOnly: boolean): Promise<string[]> {
  let query = getSupabaseAdmin().from("app_notifications").select("id, kind, href").eq("recipient_email", to);
  if (unreadOnly) query = query.is("read_at", null);
  if (ids) query = query.in("id", ids);
  const { data, error } = await query;
  if (error) throw new Error(`Could not read notifications: ${error.message}`);
  const rows = (data ?? []) as { id: string; kind: string; href: string | null }[];
  const pinned = await pinnedIds(rows);
  return rows.map((r) => r.id).filter((id) => !pinned.has(id));
}

/**
 * Marks the caller's own notifications read: the given ids, or all of them. Only the caller's own rows: another
 * approver's copy of the same request is never touched. A pinned one (pinned.ts) is left unread.
 */
export async function markNotificationsRead(email: string, ids: string[] | null): Promise<void> {
  if (ids && !ids.length) return;
  const to = normalise(email);
  const targets = await unpinned(to, ids, true);
  if (!targets.length) return;
  const { error } = await getSupabaseAdmin()
    .from("app_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_email", to)
    .is("read_at", null)
    .in("id", targets);
  if (error) throw new Error(`Could not mark notifications read: ${error.message}`);
}

/**
 * Removes the caller's OWN notifications from their bell (Pau, 23 Nov 2026: "delete notification all or clicking x by
 * removing 1"): the given ids, or all of them. Each row is one recipient's own copy (`recipient_email`), so deleting it
 * hides it for that person only; the recipient filter is always applied, so an id that belongs to someone else matches
 * no row and nothing of theirs is touched. Forms and approvals are other tables and are never read or changed here.
 * A pinned one (pinned.ts) stays. Returns how many rows were removed.
 */
export async function dismissNotifications(email: string, ids: string[] | null): Promise<number> {
  if (ids && !ids.length) return 0;
  const to = normalise(email);
  const targets = await unpinned(to, ids, false);
  if (!targets.length) return 0;
  const { error, count } = await getSupabaseAdmin()
    .from("app_notifications")
    .delete({ count: "exact" })
    .eq("recipient_email", to)
    .in("id", targets);
  if (error) throw new Error(`Could not remove notifications: ${error.message}`);
  return count ?? 0;
}
