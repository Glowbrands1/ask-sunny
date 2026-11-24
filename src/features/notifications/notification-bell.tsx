"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui/overlays";
import type { AppNotification, BellData } from "@/lib/notifications/types";
import { cn } from "@/lib/utils/cn";

import { dismissNotificationsAction, markNotificationsReadAction } from "./actions";
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
  const [, start] = useTransition();
  const isRead = (n: AppNotification) => !!n.readAt || readHere === "all" || readHere.has(n.id);
  const isGone = (n: AppNotification) => goneHere === "all" || goneHere.has(n.id);
  const items = data.items.filter((n) => !isGone(n));
  // Unread that this panel read or removed come off the server's count straight away.
  const unread =
    readHere === "all" || goneHere === "all"
      ? 0
      : Math.max(0, data.unread - data.items.filter((n) => !n.readAt && (readHere.has(n.id) || goneHere.has(n.id))).length);

  function openOne(n: AppNotification) {
    if (!isRead(n)) {
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
    setReadHere("all");
    start(async () => {
      await markNotificationsReadAction(null);
    });
  }

  /** The × on a row: removes that one from this person's list; never opens it. */
  function dismissOne(id: string) {
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

  /*
   * FORMS STILL WAITING FOR HR KEEP THE BADGE (Pau, 24 Nov 2026, on Form Monitoring showing "Pending HR approval (2)"
   * under an empty bar: "can u please not remove the notification in the bar on the left side if there are still
   * pending inside"). Opening, reading or removing a notification does not decide the form, so the badge shows the
   * larger of the unread count and the forms still needing this approver; only deciding them takes it away.
   */
  const waitingHr = Math.max(0, data.waitingHr ?? 0);
  const count = Math.max(unread, waitingHr);
  const waitingWords = `${waitingHr} ${waitingHr === 1 ? "form" : "forms"} waiting for your approval`;
  const label = unread
    ? `Notifications, ${unread} unread${waitingHr ? `, ${waitingWords}` : ""}`
    : waitingHr
      ? `Notifications, ${waitingWords}`
      : "Notifications";
  const badge = count ? (
    <span
      aria-hidden
      className={cn(
        "flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-none font-extrabold text-accent-foreground",
        variant === "bar" || collapsed ? "absolute -top-0.5 -right-0.5" : "ml-auto",
      )}
    >
      {count > 9 ? "9+" : count}
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
          rows={items.map((n) => ({ id: n.id, title: n.title, body: n.body, meta: timeAgo(n.createdAt), read: isRead(n) }))}
          unread={unread}
          onOpen={(id) => {
            const n = items.find((item) => item.id === id);
            if (n) openOne(n);
          }}
          onDismiss={dismissOne}
          onClearAll={clearAll}
          onMarkAllRead={readAll}
          footer={
            waitingHr ? (
              <Link
                href="/forms/monitoring?view=hr"
                onClick={() => {
                  setOpen(false);
                  onNavigate?.();
                }}
                className="text-xs font-semibold text-foreground underline-offset-4 hover:underline"
              >
                {waitingHr === 1 ? "1 form still needs your decision" : `${waitingHr} forms still need your decision`} →
              </Link>
            ) : undefined
          }
        />
      </PopoverContent>
    </Popover>
  );
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
