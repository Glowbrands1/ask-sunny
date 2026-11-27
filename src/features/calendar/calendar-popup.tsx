"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { CalendarView } from "./calendar-view";
import { loadCalendarPopupAction, type CalendarPopupData } from "./actions";

/**
 * THE FLOATING CALENDAR (the owner, 27 Nov 2026: "can we make the calendar pop up and be resizable so anytime we go in
 * other tabs it stays there pls resizable and can click X for both apps").
 *
 * A button opens the Calendar in a window over the app: the same month view, filters, panels and click-through as the
 * Calendar page, read the same way (loadCalendarPopupAction), so the attendee-only rule holds in it too. It is mounted in
 * the (app) layout, which stays mounted while the person moves between pages, so it stays open where it was. Drag its
 * header to move it; drag the corner to resize it (never below MIN); the X closes it. Open or closed, position and size
 * are remembered for this person in this browser (localStorage, wrapped: a private window simply starts closed). At
 * phone width it fills the screen.
 */
export const MIN = { w: 360, h: 320 } as const;
const DEFAULT = { x: 24, y: 80, w: 720, h: 560 };
const PHONE = 640;

export type PopupState = { open: boolean; x: number; y: number; w: number; h: number };

export const storageKey = (userKey: string | null) => `ask-calendar-popup:v1:${userKey ?? "anon"}`;

export function readState(key: string): PopupState {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { open: false, ...DEFAULT };
    const v = JSON.parse(raw) as Partial<PopupState>;
    const num = (n: unknown, d: number) => (typeof n === "number" && Number.isFinite(n) ? n : d);
    return { open: v.open === true, x: num(v.x, DEFAULT.x), y: num(v.y, DEFAULT.y), w: Math.max(MIN.w, num(v.w, DEFAULT.w)), h: Math.max(MIN.h, num(v.h, DEFAULT.h)) };
  } catch {
    return { open: false, ...DEFAULT };
  }
}

function writeState(key: string, state: PopupState) {
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* Storage blocked: the window still works, it just is not remembered. */
  }
}

/** Keep the window's header on screen, so it can always be dragged back. */
export function clampToViewport(s: PopupState, vw: number, vh: number): PopupState {
  const w = Math.max(MIN.w, Math.min(s.w, vw));
  const h = Math.max(MIN.h, Math.min(s.h, vh));
  return { ...s, w, h, x: Math.min(Math.max(0, s.x), Math.max(0, vw - 80)), y: Math.min(Math.max(0, s.y), Math.max(0, vh - 40)) };
}

const noSubscribe = () => () => {};
const onResize = (fn: () => void) => {
  window.addEventListener("resize", fn);
  return () => window.removeEventListener("resize", fn);
};

export function CalendarPopup({ userKey, load = loadCalendarPopupAction }: { userKey: string | null; load?: (month: string | null) => Promise<CalendarPopupData> }) {
  const key = storageKey(userKey);
  // Nothing is drawn until the page has hydrated (the server never reads storage), so both renders match.
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const phone = useSyncExternalStore(onResize, () => window.innerWidth < PHONE, () => false);
  const [state, setState] = useState<PopupState | null>(() => (typeof window === "undefined" ? null : clampToViewport(readState(key), window.innerWidth, window.innerHeight)));
  const [data, setData] = useState<CalendarPopupData | null>(null);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const save = useCallback(
    (next: PopupState) => {
      setState(next);
      writeState(key, next);
    },
    [key],
  );

  const fetchMonth = useCallback(
    (m: string | null) =>
      load(m).then(
        (d) => {
          setFailed(!d.ok);
          if (d.ok) setData(d);
        },
        () => setFailed(true),
      ),
    [load],
  );

  const open = state?.open === true;
  // The first month when the window opens; later months come from its own buttons.
  const asked = useRef(false);
  useEffect(() => {
    if (!open || asked.current) return;
    asked.current = true;
    void fetchMonth(null);
  }, [open, fetchMonth]);

  // Remember the size the person drags it to.
  useEffect(() => {
    const el = box.current;
    if (!open || phone || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setState((s) => {
        if (!s) return s;
        const next = { ...s, w: Math.max(MIN.w, Math.round(el.offsetWidth)), h: Math.max(MIN.h, Math.round(el.offsetHeight)) };
        if (next.w === s.w && next.h === s.h) return s;
        writeState(key, next);
        return next;
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, phone, key]);

  const startDrag = (ev: React.PointerEvent) => {
    if (phone || !state || (ev.target as HTMLElement).closest("button")) return;
    const start = { px: ev.clientX, py: ev.clientY, x: state.x, y: state.y };
    const move = (e: PointerEvent) =>
      setState((s) => (s ? clampToViewport({ ...s, x: start.x + e.clientX - start.px, y: start.y + e.clientY - start.py }, window.innerWidth, window.innerHeight) : s));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setState((s) => {
        if (s) writeState(key, s);
        return s;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!hydrated || !state) return null;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => save({ ...state, open: true })}
        className="fixed bottom-4 right-4 z-40 rounded-full border border-border-strong bg-surface px-4 py-2 text-sm font-semibold shadow-lg"
        aria-label="Open the Calendar window"
      >
        📅 Calendar
      </button>
    );
  }
  const frame = phone
    ? { left: 0, top: 0, width: "100vw", height: "100dvh" }
    : { left: state.x, top: state.y, width: state.w, height: state.h, minWidth: MIN.w, minHeight: MIN.h, resize: "both" as const };
  return (
    <div
      ref={box}
      role="dialog"
      aria-label="Calendar window"
      aria-modal="false"
      style={frame}
      className="fixed z-50 flex flex-col overflow-hidden rounded-lg border border-border-strong bg-surface shadow-2xl"
    >
      <div onPointerDown={startDrag} className={`flex items-center gap-2 border-b border-border px-3 py-2 ${phone ? "" : "cursor-move select-none"}`} data-testid="calendar-window-header">
        <h2 className="m-0 flex-1 text-sm font-semibold">Calendar</h2>
        <a href="/calendar" className="text-xs underline">
          Open the full page
        </a>
        <button type="button" onClick={() => save({ ...state, open: false })} aria-label="Close the Calendar window" className="rounded px-2 py-1 text-sm">
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {failed ? (
          <p role="status" className="m-0 text-sm">
            Your calendar could not be loaded just now. Try again in a minute.
          </p>
        ) : !data || !data.ok ? (
          <p className="m-0 text-sm text-muted-foreground">Loading your calendar…</p>
        ) : (
          <CalendarView
            key={data.month}
            view={data.view}
            month={data.month}
            today={data.today}
            meetings={data.meetings}
            hubUrl={data.hubUrl}
            hubCalendarUrl={data.hubCalendarUrl}
            canEditSchedules={data.canEditSchedules}
            onMonth={(m) => void fetchMonth(m)}
            onRefresh={() => void fetchMonth(data.month)}
          />
        )}
      </div>
    </div>
  );
}
