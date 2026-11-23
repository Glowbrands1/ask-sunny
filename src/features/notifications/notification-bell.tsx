"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui/overlays";
import type { AppNotification, BellData } from "@/lib/notifications/types";
import { cn } from "@/lib/utils/cn";

import { markNotificationsReadAction } from "./actions";

/**
 * THE BELL: the signed-in person's notifications, newest first, with a count of
 * the unread ones. Opening one marks it read and goes to it. First used for AI
 * Training submissions (Pau, 20 Nov 2026), then the HR form approval.
 *
 * WHERE IT SITS (Pau, 23 Nov 2026, as an HR approver: "why no notification for [the approver]? should be same as
 * bubbles … for the form acceptance"): on desktop it is a "Notifications" item at the top of the rail (`rail`), as in
 * Ask Bubbles, so it is found where the rest of the navigation is; on phones, where the rail is a drawer, it stays in
 * the top bar (`bar`). Same people, same panel, same count either way.
 */
export function NotificationBell({
  data,
  variant = "bar",
  collapsed = false,
  onNavigate,
}: {
  data: BellData;
  variant?: "bar" | "rail";
  /** The rail is collapsed to icons: no label, a tooltip instead. */
  collapsed?: boolean;
  /** Called after opening a notification. */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Read locally at once, so the badge drops before the server answers.
  const [readHere, setReadHere] = useState<Set<string> | "all">(new Set());
  const [, start] = useTransition();
  const isRead = (n: AppNotification) => !!n.readAt || readHere === "all" || readHere.has(n.id);
  const unread = readHere === "all" ? 0 : Math.max(0, data.unread - data.items.filter((n) => !n.readAt && readHere.has(n.id)).length);

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
            "group relative mb-4 flex w-full items-center gap-2.5 rounded-full text-[13.5px] font-semibold text-sidebar-foreground transition-colors hover:bg-hover-surface hover:text-foreground",
            collapsed ? "justify-center px-0 py-2.5" : "px-3.5 py-2.5",
          )}
        >
          <Bell className="size-4 shrink-0 text-sidebar-foreground group-hover:text-foreground" aria-hidden />
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
          className="relative text-chrome-foreground hover:bg-hover-surface hover:text-hover-surface-foreground"
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
        side={variant === "rail" ? "right" : "bottom"}
        className="w-[min(22rem,calc(100vw-1.5rem))] p-0"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-sm font-bold text-foreground">Notifications</h2>
          {unread ? (
            <button type="button" onClick={readAll} className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Mark all as read
            </button>
          ) : null}
        </div>
        {data.items.length ? (
          <ul className="max-h-[min(26rem,70vh)] overflow-y-auto py-1" aria-label="Notifications">
            {data.items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openOne(n)}
                  className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hover-surface"
                >
                  <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", isRead(n) ? "bg-transparent" : "bg-accent")} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm text-foreground", isRead(n) ? "font-medium" : "font-bold")}>
                      {n.title}
                      {isRead(n) ? null : <span className="sr-only"> (unread)</span>}
                    </span>
                    {n.body ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{n.body}</span> : null}
                    <span className="mt-0.5 block text-[11px] text-subtle-foreground">{timeAgo(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing yet. New notifications will show here.</p>
        )}
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
