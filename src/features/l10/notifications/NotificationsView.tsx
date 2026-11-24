"use client";
// The DM L10 bell's list: the Leadership Hub's notes (its read/mark logic copied from the Hub's NotificationsView), shown in Ask Sunny's own NotificationsPanel.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { NotificationsPanel, type PanelRow } from "@/features/notifications/notifications-panel";
import { headline, NOTIFICATIONS_CHANGED, noteHref, timeAgo } from "@/features/l10/notifications/logic";
import type { AppNotification } from "@/features/l10/notifications/types";
import { markAllReadAction, markReadAction } from "./actions";

export type MarkReadFn = (ids: string[]) => Promise<{ ok: boolean }>;
export type MarkAllFn = () => Promise<{ ok: boolean }>;

/** The list of notes, newest first. Excerpts are plain text (React escapes them); each note links to its meeting. */
export function NotificationsView({
  initial,
  now,
  markRead = markReadAction,
  markAll = markAllReadAction,
  compact = false,
  onNavigate,
  hubUrl,
}: {
  /** Ask Sunny: the full notifications page and its settings are in the Leadership Hub (this address, absolute). */
  hubUrl?: string;
  initial: AppNotification[];
  /** The server's time when the page was rendered. */
  now: number;
  markRead?: MarkReadFn;
  markAll?: MarkAllFn;
  /** Inside the bell's pop-up: tighter, with a link to the full page, and the pop-up closes when a note or link is followed. */
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(initial);
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();
  const unread = notes.filter((n) => !n.read_at).length;
  const stamp = () => new Date().toISOString();
  const changed = () => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));

  const read = (ids: string[]) => {
    if (ids.length === 0) return;
    // Opening a note marks it read; the change is shown at once and undone if it fails.
    setNotes((all) => all.map((n) => (ids.includes(n.id) && !n.read_at ? { ...n, read_at: stamp() } : n)));
    startTransition(async () => {
      const r = await markRead(ids).catch(() => ({ ok: false }));
      if (!r.ok) {
        setError("Could not mark that as read. Try again in a minute.");
        setNotes((all) => all.map((n) => (ids.includes(n.id) ? { ...n, read_at: initial.find((i) => i.id === n.id)?.read_at ?? null } : n)));
      } else {
        setError("");
        changed();
      }
    });
  };

  const readAll = () => {
    const before = notes;
    setNotes((all) => all.map((n) => (n.read_at ? n : { ...n, read_at: stamp() })));
    startTransition(async () => {
      const r = await markAll().catch(() => ({ ok: false }));
      if (!r.ok) {
        setError("Could not mark everything as read. Try again in a minute.");
        setNotes(before);
      } else {
        setError("");
        changed();
      }
    });
  };

  /*
   * Pau (23 Nov 2026): "for dm meeting make this UI same with bubble". In Ask Sunny the DM L10 bell shows Ask Sunny's own panel
   * (`NotificationsPanel`), with Mark all read and See all. No × or Clear all here: these notes live in the Leadership
   * Hub's database, which has no way to remove one yet (it needs a dismiss function there). The Hub's notification
   * Settings link is gone (it opened another app); the meta line has normal contrast.
   */
  const rows: PanelRow[] = notes.map((n) => ({
    id: n.id,
    title: headline(n),
    body: n.excerpt || null,
    meta: `${n.meeting_name} · ${timeAgo(n.updated_at, now)}`,
    read: Boolean(n.read_at),
  }));
  const open = (id: string) => {
    const n = notes.find((note) => note.id === id);
    if (!n) return;
    read([n.id]);
    onNavigate?.();
    router.push(noteHref(n));
  };
  return (
    <div className="flex flex-col">
      <NotificationsPanel
        rows={rows}
        unread={unread}
        onOpen={open}
        onMarkAllRead={readAll}
        emptyText="No notifications yet. You will see a note here when someone mentions you, gives you a to-do, or something of yours changes in a meeting."
        footer={
          compact ? (
            <Link
              href={hubUrl ? `${hubUrl}/notifications` : "/notifications"}
              target={hubUrl ? "_blank" : undefined}
              rel={hubUrl ? "noopener noreferrer" : undefined}
              onClick={onNavigate}
              className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              See all
            </Link>
          ) : undefined
        }
      />
      {error && (
        <p role="alert" className="m-0 px-4 pb-3 text-sm font-semibold text-status-failed">
          {error}
        </p>
      )}
    </div>
  );
}
