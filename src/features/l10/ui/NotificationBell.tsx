"use client";
// Copied from the Leadership Hub (src/components/NotificationBell.tsx); keep in step with it. See src/features/l10/README.md.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { listNotificationsAction, unreadCountAction } from "@/features/l10/notifications/actions";
import { NotificationsView } from "@/features/l10/notifications/NotificationsView";
import type { AppNotification } from "@/features/l10/notifications/types";
import { badgeText } from "@/features/l10/notifications/logic";

/** Other screens tell the bell to refresh at once (for example after "mark all read"). */
export const NOTIFICATIONS_CHANGED = "hub:notifications-changed";

const REFRESH_MS = 60_000;

/**
 * The bell with the unread number. Clicking it opens a pop-up with the notes (no page change; "See all" opens the full page). The count is refreshed on page load, when the
 * tab regains focus and every 60 seconds (no realtime, as elsewhere); if a refresh fails the last number stays.
 * Its look is for a dark bar (the sidebar and the slim meeting bar).
 */
type Loaded = { notes: AppNotification[]; now: number } | "loading" | "error";

export function NotificationBell({
  className = "",
  refreshMs = REFRESH_MS,
  read = unreadCountAction,
  list = listNotificationsAction,
  hubUrl,
}: {
  /** Ask Sunny: "See all" and "Settings" open the Leadership Hub (this address, absolute). */
  hubUrl?: string;
  className?: string;
  refreshMs?: number;
  read?: () => Promise<number | null>;
  list?: () => Promise<{ ok: true; notifications: AppNotification[] } | { ok: false }>;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>("loading");
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const refresh = useCallback(async () => {
    try {
      const n = await read();
      if (typeof n === "number") setCount(n);
    } catch {
      /* keep the last number */
    }
  }, [read]);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const onFocus = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, refreshMs);
    window.addEventListener("focus", onFocus);
    window.addEventListener(NOTIFICATIONS_CHANGED, onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(NOTIFICATIONS_CHANGED, onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, refreshMs]);

  // Fetch the notes each time the pop-up opens, so it is never stale.
  useEffect(() => {
    if (!open) return;
    let live = true;
    list()
      .then((r) => live && setLoaded(r.ok ? { notes: r.notifications, now: Date.now() } : "error"))
      .catch(() => live && setLoaded("error"));
    return () => {
      live = false;
    };
  }, [open, list]);

  // Under the bell, kept inside the screen; a phone gets the full width.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = button.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(400, window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      setBox({ left, top: r.bottom + 8, width });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Closes on Escape or a click outside; focus returns to the bell.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const badge = badgeText(count ?? 0);
  const ringing = (count ?? 0) > 0 && !open;
  const label = count && count > 0 ? `Notifications, ${count} unread` : "Notifications";
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setLoaded("loading");
          setOpen((o) => !o);
        }}
        className={`relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-paper transition-colors hover:text-gold-hover ${className}`}
      >
        {/* Rings while anything is unread (stops at 0, while the list is open, and for reduced motion). */}
        <svg
          aria-hidden="true"
          data-testid="bell-icon"
          data-ringing={ringing}
          className={ringing ? "bell-ringing" : undefined}
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </svg>
        {badge && (
          <span aria-hidden="true" data-testid="bell-count" className="absolute right-0 top-0 min-w-[19px] rounded-full bg-[#d11a2a] px-1 text-center text-[11px] font-bold leading-[19px] text-white ring-2 ring-paper">
            {badge}
          </span>
        )}
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label="Notifications"
            style={{ left: box?.left ?? 8, top: box?.top ?? 60, width: box?.width ?? 360 }}
            className="fixed z-50 max-h-[min(70vh,560px)] overflow-y-auto rounded-2xl border border-line bg-cream p-3 text-ink shadow-2xl"
          >
            <h2 className="m-0 mb-2 px-1 text-base font-bold">Notifications</h2>
            {loaded === "loading" ? (
              <p role="status" className="m-0 px-1 py-3 text-sm text-muted">
                Loading…
              </p>
            ) : loaded === "error" ? (
              <p role="alert" className="m-0 px-1 py-3 text-sm font-semibold text-[#9b1c1c]">
                Notifications could not be loaded just now. Please try again in a minute.
              </p>
            ) : (
              <NotificationsView initial={loaded.notes} now={loaded.now} compact hubUrl={hubUrl} onNavigate={() => setOpen(false)} />
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
