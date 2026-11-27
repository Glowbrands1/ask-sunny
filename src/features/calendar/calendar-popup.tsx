"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { CalendarView } from "./calendar-view";
import { loadCalendarPopupAction, type CalendarPopupData } from "./actions";

/**
 * THE CALENDAR PANEL, DOCKED ON THE RIGHT (the owner, 27 Nov 2026: "can we make the calendar pop up and be resizable so
 * anytime we go in other tabs it stays there pls resizable and can click X for both apps", then "also i thought i said we
 * should have a way to minimize this and go through tabs with this open or something and a tab that we can collapse on
 * the right side or somethng").
 *
 * - Docked: a panel on the right of the app, beside whatever page is open (the page makes room for it). Drag its left
 *   edge to resize it, between MIN_WIDTH and MAX_WIDTH (never more than the window allows).
 * - Collapsed: "»" (or ✕) folds it to a slim "Calendar" tab on the right edge; the tab opens it again.
 * - Popped out: an optional floating window, moved by its header and resized by its corner, that can be docked again.
 * - The same month view, filters, meeting panel and in-panel time editor as the Calendar page, read the same way
 *   (loadCalendarPopupAction), so every rule the page follows holds here too.
 * It is mounted in the (app) layout, which stays mounted while the person moves between pages, so it stays as it was.
 * Docked or collapsed, its width and the floating window's place are remembered for this person in this browser
 * (localStorage, wrapped: blocked storage just means it starts collapsed). On a phone it opens as a full-screen sheet.
 */
export const MIN_WIDTH = 320;
export const MAX_WIDTH = 900;
export const MIN = { w: 360, h: 320 } as const;
const DEFAULT: PanelState = { mode: "collapsed", width: 420, x: 24, y: 80, w: 720, h: 560 };
const PHONE = 640;
/** The page keeps at least this much room beside the docked panel. */
const PAGE_ROOM = 320;

export type PanelMode = "docked" | "collapsed" | "floating";
export type PanelState = { mode: PanelMode; width: number; x: number; y: number; w: number; h: number };

export const storageKey = (userKey: string | null) => `ask-calendar-panel:v2:${userKey ?? "anon"}`;

const num = (n: unknown, d: number) => (typeof n === "number" && Number.isFinite(n) ? n : d);

export function readState(key: string): PanelState {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { ...DEFAULT };
    const v = JSON.parse(raw) as Partial<PanelState>;
    const mode: PanelMode = v.mode === "docked" || v.mode === "floating" ? v.mode : "collapsed";
    return {
      mode,
      width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, num(v.width, DEFAULT.width))),
      x: num(v.x, DEFAULT.x),
      y: num(v.y, DEFAULT.y),
      w: Math.max(MIN.w, num(v.w, DEFAULT.w)),
      h: Math.max(MIN.h, num(v.h, DEFAULT.h)),
    };
  } catch {
    return { ...DEFAULT };
  }
}

function writeState(key: string, state: PanelState) {
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* Storage blocked: the panel still works, it just is not remembered. */
  }
}

/** The docked width, kept between MIN_WIDTH and MAX_WIDTH and never so wide that the page has no room. */
export function clampWidth(width: number, viewportWidth: number): number {
  return Math.round(Math.max(MIN_WIDTH, Math.min(width, MAX_WIDTH, Math.max(MIN_WIDTH, viewportWidth - PAGE_ROOM))));
}

/** Keep the floating window's header on screen, so it can always be dragged back. */
export function clampToViewport(s: PanelState, vw: number, vh: number): PanelState {
  const w = Math.max(MIN.w, Math.min(s.w, vw));
  const h = Math.max(MIN.h, Math.min(s.h, vh));
  return { ...s, w, h, x: Math.min(Math.max(0, s.x), Math.max(0, vw - 80)), y: Math.min(Math.max(0, s.y), Math.max(0, vh - 40)) };
}

const noSubscribe = () => () => {};
const onResize = (fn: () => void) => {
  window.addEventListener("resize", fn);
  return () => window.removeEventListener("resize", fn);
};

/** Follow the pointer until it is released; `end` runs once on release. */
function dragWith(move: (e: PointerEvent) => void, end: () => void) {
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    end();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

export function CalendarPopup({ userKey, load = loadCalendarPopupAction }: { userKey: string | null; load?: (month: string | null) => Promise<CalendarPopupData> }) {
  const key = storageKey(userKey);
  // Nothing is drawn until the page has hydrated (the server never reads storage), so both renders match.
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const phone = useSyncExternalStore(onResize, () => window.innerWidth < PHONE, () => false);
  const [state, setState] = useState<PanelState | null>(() => {
    if (typeof window === "undefined") return null;
    const s = readState(key);
    return { ...clampToViewport(s, window.innerWidth, window.innerHeight), width: clampWidth(s.width, window.innerWidth) };
  });
  const [data, setData] = useState<CalendarPopupData | null>(null);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const save = useCallback(
    (next: PanelState) => {
      setState(next);
      writeState(key, next);
    },
    [key],
  );
  const remember = useCallback(() => {
    setState((s) => {
      if (s) writeState(key, s);
      return s;
    });
  }, [key]);

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

  const open = state !== null && state.mode !== "collapsed";
  // The first month when the panel opens; later months come from its own buttons.
  const asked = useRef(false);
  useEffect(() => {
    if (!open || asked.current) return;
    asked.current = true;
    void fetchMonth(null);
  }, [open, fetchMonth]);

  // Docked beside the page: the page makes room for it (not on a phone, where it is a full-screen sheet).
  const dockedWidth = state?.mode === "docked" && !phone ? state.width : 0;
  useEffect(() => {
    if (!dockedWidth) return;
    const body = document.body;
    const before = body.style.paddingRight;
    body.style.paddingRight = `${dockedWidth}px`;
    body.dataset.calendarPanel = "docked";
    return () => {
      body.style.paddingRight = before;
      delete body.dataset.calendarPanel;
    };
  }, [dockedWidth]);

  // Remember the size the floating window is dragged to.
  const floating = state?.mode === "floating" && !phone;
  useEffect(() => {
    const el = box.current;
    if (!floating || !el || typeof ResizeObserver === "undefined") return;
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
  }, [floating, key]);

  if (!hydrated || !state) return null;

  if (state.mode === "collapsed") {
    return (
      <button
        type="button"
        onClick={() => save({ ...state, mode: "docked" })}
        aria-label="Open the Calendar panel"
        className="fixed right-0 top-1/2 z-40 flex -translate-y-1/2 flex-col items-center gap-1 rounded-l-lg border border-r-0 border-border-strong bg-surface px-1.5 py-3 text-xs font-semibold shadow-lg"
      >
        <span aria-hidden>📅</span>
        <span className="[writing-mode:vertical-rl]">Calendar</span>
      </button>
    );
  }

  const startResize = (ev: React.PointerEvent) => {
    if (phone) return;
    ev.preventDefault();
    const start = { px: ev.clientX, width: state.width };
    dragWith(
      (e) => setState((s) => (s ? { ...s, width: clampWidth(start.width + (start.px - e.clientX), window.innerWidth) } : s)),
      remember,
    );
  };
  const resizeByKey = (ev: React.KeyboardEvent) => {
    const step = ev.key === "ArrowLeft" ? 24 : ev.key === "ArrowRight" ? -24 : 0;
    if (!step) return;
    ev.preventDefault();
    save({ ...state, width: clampWidth(state.width + step, window.innerWidth) });
  };
  const startMove = (ev: React.PointerEvent) => {
    if (phone || state.mode !== "floating" || (ev.target as HTMLElement).closest("button, a")) return;
    const start = { px: ev.clientX, py: ev.clientY, x: state.x, y: state.y };
    dragWith(
      (e) => setState((s) => (s ? clampToViewport({ ...s, x: start.x + e.clientX - start.px, y: start.y + e.clientY - start.py }, window.innerWidth, window.innerHeight) : s)),
      remember,
    );
  };

  const frame: React.CSSProperties = phone
    ? { left: 0, top: 0, width: "100vw", height: "100dvh" }
    : state.mode === "docked"
      ? { right: 0, top: 0, width: state.width, height: "100dvh" }
      : { left: state.x, top: state.y, width: state.w, height: state.h, minWidth: MIN.w, minHeight: MIN.h, resize: "both" };
  const docked = state.mode === "docked";

  return (
    <div
      ref={box}
      role={docked && !phone ? "complementary" : "dialog"}
      aria-label={docked && !phone ? "Calendar panel" : "Calendar window"}
      {...(docked && !phone ? {} : { "aria-modal": false })}
      style={frame}
      data-mode={phone ? "sheet" : state.mode}
      className={`fixed z-50 flex flex-col overflow-hidden border-border-strong bg-surface shadow-2xl ${docked && !phone ? "border-l" : "rounded-lg border"}`}
    >
      {docked && !phone ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the Calendar panel"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={state.width}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={resizeByKey}
          className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize hover:bg-border-strong focus-visible:bg-border-strong"
          data-testid="calendar-panel-resize"
        />
      ) : null}
      <div
        onPointerDown={startMove}
        className={`flex items-center gap-2 border-b border-border px-3 py-2 ${state.mode === "floating" && !phone ? "cursor-move select-none" : ""}`}
        data-testid="calendar-window-header"
      >
        <h2 className="m-0 flex-1 text-sm font-semibold">Calendar</h2>
        <a href="/calendar" className="text-xs underline">
          Open the full page
        </a>
        {!phone ? (
          state.mode === "docked" ? (
            <button type="button" onClick={() => save({ ...state, mode: "floating" })} className="rounded px-2 py-1 text-xs" aria-label="Pop out the Calendar">
              Pop out
            </button>
          ) : (
            <button type="button" onClick={() => save({ ...state, mode: "docked" })} className="rounded px-2 py-1 text-xs" aria-label="Dock the Calendar on the right">
              Dock
            </button>
          )
        ) : null}
        <button type="button" onClick={() => save({ ...state, mode: "collapsed" })} aria-label="Collapse the Calendar panel" className="rounded px-2 py-1 text-sm">
          {docked && !phone ? "»" : "✕"}
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
            canEditSchedules={data.canEditSchedules}
            onMonth={(m) => void fetchMonth(m)}
            onRefresh={() => void fetchMonth(data.month)}
          />
        )}
      </div>
    </div>
  );
}
