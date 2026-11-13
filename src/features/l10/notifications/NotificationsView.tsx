"use client";
// Copied from the Leadership Hub (src/app/notifications/NotificationsView.tsx); keep in step with it. See src/features/l10/README.md.

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, Card, cx } from "@/features/l10/ui/ui";
import { NOTIFICATIONS_CHANGED } from "@/features/l10/ui/NotificationBell";
import { headline, noteHref, timeAgo } from "@/features/l10/notifications/logic";
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
  const [notes, setNotes] = useState(initial);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="m-0 text-sm text-muted" aria-live="polite">
          {unread === 0 ? "You are all caught up." : `${unread} unread`}
        </p>
        <Button type="button" onClick={readAll} disabled={unread === 0 || pending} className="ml-auto">
          Mark all read
        </Button>
        {compact && (
          <Link href={hubUrl ? `${hubUrl}/notifications` : "/notifications"} target={hubUrl ? "_blank" : undefined} rel={hubUrl ? "noopener noreferrer" : undefined} onClick={onNavigate} className="inline-flex min-h-11 items-center text-[13px] font-semibold text-bronze-deep hover:underline">
            See all
          </Link>
        )}
        <Link href={hubUrl ? `${hubUrl}/notifications/settings` : "/notifications/settings"} target={hubUrl ? "_blank" : undefined} rel={hubUrl ? "noopener noreferrer" : undefined} onClick={onNavigate} className="inline-flex min-h-11 items-center text-[13px] font-semibold text-bronze-deep hover:underline">
          Settings
        </Link>
      </div>
      {error && (
        <p role="alert" className="m-0 text-sm font-semibold text-[#9b1c1c]">
          {error}
        </p>
      )}
      {notes.length === 0 ? (
        <Card>
          <p className="m-0 text-sm">No notifications yet. You will see a note here when someone mentions you, gives you a to-do, or something of yours changes in a meeting.</p>
        </Card>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {notes.map((n) => (
            <li key={n.id}>
              <Link
                href={noteHref(n)}
                onClick={() => (read([n.id]), onNavigate?.())}
                className={cx(
                  "flex min-h-11 flex-col gap-0.5 rounded-[10px] border px-4 py-3 text-ink no-underline transition-colors hover:border-gold-hover",
                  n.read_at ? "border-line bg-white" : "border-gold bg-[#fff9e8]",
                )}
              >
                <span className="flex flex-wrap items-center gap-x-2 text-sm">
                  {!n.read_at && <span className="rounded-full bg-gold px-2 text-[11px] font-bold text-[#111111]">New</span>}
                  <span className={n.read_at ? "font-medium" : "font-bold"}>{headline(n)}</span>
                  <span className="text-xs text-muted">
                    · {n.meeting_name} · {timeAgo(n.updated_at, now)}
                  </span>
                </span>
                {n.excerpt && <span className="text-sm text-[#444]">{n.excerpt}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
