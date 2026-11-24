"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui/overlays";
import type { AppNotification, BellData } from "@/lib/notifications/types";
import { cn } from "@/lib/utils/cn";

import { dismissNotificationsAction, markNotificationsReadAction, markNotificationsUnreadAction } from "./actions";
import { NotificationsPanel } from "./notifications-panel";

/**
 * THE BELL: the signed-in person's notifications, newest first, with a count of
 * the unread ones. Opening one marks it read and goes to it. First used for AI
 * Training submissions (Pau, 20 Nov 2026), then the HR form approval.
 *
 * WHERE IT SITS (Pau, 23 Nov 2026): first "can we remove this and add a notification bar instead below the overview",
 * then, with the sibling app's rail as the picture, "i dont want a bell, i need a bar". So it is a labelled
 * "Notifications" bar in the rail (`rail`), directly under Overview, on desktop and in the phone drawer alike, and the
 * top bar has no bell. Same people, same panel, same count. (`bar`, the top-bar button, is kept for any other caller.)
 */
export function NotificationBell({
  data,
  variant = "bar",
  collapsed = false,
  onNavigate,
  panelSide = "right",
  className,
}: {
  data: BellData;
  variant?: "bar" | "rail";
  /** The rail is collapsed to icons: no label, a tooltip instead. */
  collapsed?: boolean;
  /** Called after opening a notification (closes the drawer on a phone). */
  onNavigate?: () => void;
  /** Rail only: where the panel opens. The phone drawer is too narrow to open it to the side, so it opens below. */
  panelSide?: "right" | "bottom";
  /** Extra classes for the top-bar button (its colour on the band). */
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Read locally at once, so the badge drops before the server answers.
  const [readHere, setReadHere] = useState<Set<string> | "all">(new Set());
  // Removed locally at once (× or Clear all), so the list and the badge change before the server answers.
  const [goneHere, setGoneHere] = useState<Set<string> | "all">(new Set());
  // Put back to unread here at once (the envelope on a read row), so the row and the badge change before the server answers.
  const [unreadHere, setUnreadHere] = useState<Set<string>>(new Set());
  const [, start] = useTransition();
  // A pinned one (HR's "waiting for your approval" while the form still waits) is never read or removed from here: it
  // stays for every approver until HR approves, rejects or sends the form back (owner, 24 Nov 2026).
  const isRead = (n: AppNotification) => !n.pinned && !unreadHere.has(n.id) && (!!n.readAt || readHere === "all" || readHere.has(n.id));
  const isGone = (n: AppNotification) => !n.pinned && (goneHere === "all" || goneHere.has(n.id));
  const items = data.items.filter((n) => !isGone(n));
  // Unread that this panel read or removed come off the server's count straight away, and ones it put back to unread
  // go on; pinned ones stay counted.
  const unread =
    readHere === "all" || goneHere === "all"
      ? data.items.filter((n) => n.pinned).length + items.filter((n) => !n.pinned && !isRead(n)).length
      : Math.max(
          0,
          data.unread -
            data.items.filter((n) => !n.pinned && !n.readAt && (readHere.has(n.id) || goneHere.has(n.id))).length +
            data.items.filter((n) => !n.pinned && !!n.readAt && unreadHere.has(n.id) && !isGone(n)).length,
        );

  function openOne(n: AppNotification) {
    if (!n.pinned && !isRead(n)) {
      setUnreadHere((prev) => withoutId(prev, n.id));
      setReadHere((prev) => (prev === "all" ? prev : new Set(prev).add(n.id)));
      start(async () => {
        await markNotificationsReadAction([n.id]);
      });
    }
    setOpen(false);
    if (n.href) {
      onNavigate?.();
      router.push(n.href);
    }
  }

  function readAll() {
    setUnreadHere(new Set());
    setReadHere("all");
    start(async () => {
      await markNotificationsReadAction(null);
    });
  }

  /** The envelope on a read row: puts it back to unread so it stays bold and counted; never opens it. */
  function unreadOne(id: string) {
    const n = data.items.find((item) => item.id === id);
    if (!n || n.pinned) return;
    setUnreadHere((prev) => new Set(prev).add(id));
    setReadHere((prev) => (prev === "all" ? prev : withoutId(prev, id)));
    start(async () => {
      await markNotificationsUnreadAction([id]);
    });
  }

  /** The × on a row: removes that one from this person's list; never opens it. A pinned row has no ×. */
  function dismissOne(id: string) {
    if (data.items.find((n) => n.id === id)?.pinned) return;
    setGoneHere((prev) => (prev === "all" ? prev : new Set(prev).add(id)));
    start(async () => {
      await dismissNotificationsAction([id]);
    });
  }

  /** Clear all: removes every one of this person's notifications. */
  function clearAll() {
    setGoneHere("all");
    start(async () => {
      await dismissNotificationsAction(null);
    });
  }

  const label = unread ? `Notifications, ${unread} unread` : "Notifications";
  const badge = unread ? (
    <span
      aria-hidden
      className={cn(
        "flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-none font-extrabold text-accent-foreground",
        variant === "bar" || collapsed ? "absolute -top-0.5 -right-0.5" : "ml-auto",
      )}
    >
      {unread > 9 ? "9+" : unread}
    </span>
  ) : null;

  const trigger =
    variant === "rail" ? (
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "relative flex w-full items-center gap-2.5 rounded-full border border-rail-border text-[13.5px] font-semibold text-sidebar-foreground transition-colors hover:bg-hover-surface hover:text-foreground",
            collapsed ? "justify-center px-0 py-2.5" : "px-3.5 py-2.5",
          )}
        >
          <Bell className="size-4 shrink-0" aria-hidden />
          {!collapsed ? <span className="truncate">Notifications</span> : null}
          {badge}
        </button>
      </PopoverTrigger>
    ) : (
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          className={cn("relative text-chrome-foreground hover:bg-hover-surface hover:text-hover-surface-foreground", className)}
        >
          <Bell />
          {badge}
        </Button>
      </PopoverTrigger>
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {variant === "rail" && collapsed ? (
        <Tooltip content="Notifications" side="right">
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}
      <PopoverContent
        align={variant === "rail" ? "start" : "end"}
        side={variant === "rail" ? panelSide : "bottom"}
        className="w-[min(22rem,calc(100vw-1.5rem))] p-0"
      >
        <NotificationsPanel
          rows={items.map((n) => ({ id: n.id, title: n.title, body: n.body, meta: timeAgo(n.createdAt), read: isRead(n), pinned: n.pinned === true }))}
          unread={unread}
          onOpen={(id) => {
            const n = items.find((item) => item.id === id);
            if (n) openOne(n);
          }}
          onDismiss={dismissOne}
          onClearAll={clearAll}
          onMarkAllRead={readAll}
          onMarkUnread={unreadOne}
        />
      </PopoverContent>
    </Popover>
  );
}

function withoutId(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  next.delete(id);
  return next;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", then the date. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
