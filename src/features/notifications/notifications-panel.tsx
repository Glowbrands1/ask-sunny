"use client";

import { Mail, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * ONE NOTIFICATIONS PANEL (Pau, 23 Nov 2026): the list a bell opens, with an × on each row (removes that one from the
 * viewer's list) and Clear all (removes every one of theirs), beside Mark all as read. Clicking a row opens it; the ×
 * never does. The rows and actions come from the caller, so every bell in the app shows the same panel.
 *
 * TWO TABS (Pau, 28 Nov 2026: "for notification can we get history tab unread when we click it pls"): Unread holds
 * what is unread, plus anything pinned until its matter is settled; History holds the rest. Opening a row marks it read
 * (the caller's onOpen), so it moves to History the next time the panel opens; the envelope there puts it back.
 */
export interface PanelRow {
  readonly id: string;
  readonly title: string;
  /** A second line ("Corrective Action Form"), when there is one. */
  readonly body?: string | null;
  /** The meta line ("5 min ago", "· <meeting> · 6 d ago"). */
  readonly meta: string;
  readonly read: boolean;
  /** Stays until its matter is settled (HR's "waiting for your approval"): no ×, and a line saying why. */
  readonly pinned?: boolean;
  /** Buttons under the row (a follow-up notice's Completed / Extend), outside the row's open button. */
  readonly actions?: ReactNode;
}

export function NotificationsPanel({
  rows,
  unread,
  onOpen,
  onDismiss,
  onClearAll,
  onMarkAllRead,
  onMarkUnread,
  footer,
  emptyText = "Nothing yet. New notifications will show here.",
}: {
  rows: readonly PanelRow[];
  unread: number;
  onOpen: (id: string) => void;
  /** The × on each row; absent where the store has no way to remove one (the DM L10 bell's Hub notes). */
  onDismiss?: (id: string) => void;
  /** Clear all; absent with `onDismiss`. */
  onClearAll?: () => void;
  onMarkAllRead: () => void;
  /** The envelope on a read row (Pau, 24 Nov 2026): puts it back to unread so it stays. Absent where the store cannot. */
  onMarkUnread?: (id: string) => void;
  /** Links under the header ("See all"), when the bell has them. */
  footer?: ReactNode;
  emptyText?: string;
}) {
  const [tab, setTab] = useState<"unread" | "history">("unread");
  /*
   * A row read while the panel is open stays where it is until the panel is opened again, so its Completed / Extend
   * answer is seen; Mark all as read moves them all at once.
   */
  const [seenUnread, setSeenUnread] = useState<ReadonlySet<string>>(() => new Set(rows.filter((n) => !n.read).map((n) => n.id)));
  const newlyUnread = rows.filter((n) => !n.read && !seenUnread.has(n.id));
  if (newlyUnread.length) setSeenUnread(new Set([...seenUnread, ...newlyUnread.map((n) => n.id)]));
  const inUnread = (n: PanelRow) => !n.read || Boolean(n.pinned) || seenUnread.has(n.id);
  const unreadRows = rows.filter(inUnread);
  const shown = tab === "unread" ? unreadRows : rows.filter((n) => !inUnread(n));
  const empty = rows.length === 0 ? emptyText : tab === "unread" ? "You're all caught up. Read notifications are in History." : "Nothing read yet.";
  const tabClass = (active: boolean) =>
    cn("-mb-px border-b-2 px-1 pb-2 text-xs font-semibold transition-colors", active ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground");
  const markAllRead = () => {
    setSeenUnread(new Set());
    onMarkAllRead();
  };
  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-sm font-bold text-foreground">Notifications</h2>
        <span className="flex items-center gap-3">
          {unread ? (
            <button type="button" onClick={markAllRead} className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Mark all as read
            </button>
          ) : null}
          {rows.length && onClearAll ? (
            <button type="button" onClick={onClearAll} className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Clear all
            </button>
          ) : null}
        </span>
      </div>
      <div role="tablist" aria-label="Notification lists" className="flex gap-4 border-b border-border px-4 pt-2">
        <button type="button" role="tab" aria-selected={tab === "unread"} onClick={() => setTab("unread")} className={tabClass(tab === "unread")}>
          Unread{unreadRows.length ? ` (${unreadRows.length})` : ""}
        </button>
        <button type="button" role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")} className={tabClass(tab === "history")}>
          History
        </button>
      </div>
      {footer ? <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2">{footer}</div> : null}
      {shown.length ? (
        <ul className="max-h-[min(26rem,70vh)] overflow-y-auto py-1" aria-label="Notifications">
          {shown.map((n) => (
            <li key={n.id} className="group transition-colors hover:bg-hover-surface">
              <div className="flex items-start">
              <button type="button" onClick={() => onOpen(n.id)} className={cn("flex min-w-0 flex-1 items-start gap-3 py-2.5 pl-4 text-left", (onDismiss || (onMarkUnread && n.read)) && !n.pinned ? null : "pr-4")}>
                <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-accent")} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm text-foreground", n.read ? "font-medium" : "font-bold")}>
                    {n.title}
                    {n.read ? null : <span className="sr-only"> (unread)</span>}
                  </span>
                  {/* Three lines, not one: a note in the body has to be readable here (owner, 23 Nov 2026). */}
                  {n.body ? <span className="mt-0.5 line-clamp-3 text-xs break-words text-muted-foreground">{n.body}</span> : null}
                  {/* Normal contrast (Pau: the faint meta line was nearly unreadable). */}
                  <span className="mt-0.5 block text-xs text-muted-foreground">{n.meta}</span>
                  {n.pinned ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">Stays here until HR approves, rejects or sends it back.</span>
                  ) : null}
                </span>
              </button>
              {onMarkUnread && n.read && !n.pinned ? (
                <button
                  type="button"
                  aria-label={`Mark as unread: ${n.title}`}
                  title="Mark as unread"
                  onClick={() => onMarkUnread(n.id)}
                  className="my-1.5 ml-1 flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground hover:bg-hover-surface hover:text-foreground"
                >
                  <Mail className="size-4" aria-hidden />
                </button>
              ) : null}
              {onDismiss && !n.pinned ? (
              <button
                type="button"
                aria-label={`Remove notification: ${n.title}`}
                onClick={() => onDismiss(n.id)}
                className="m-1.5 flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground hover:bg-hover-surface hover:text-foreground"
              >
                <X className="size-4" aria-hidden />
              </button>
              ) : null}
              </div>
              {n.actions ? <div className="pr-4 pb-2.5 pl-9">{n.actions}</div> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}
