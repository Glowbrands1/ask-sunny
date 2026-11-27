// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CalendarPopupData } from "./actions";
import { CalendarPopup, MAX_WIDTH, MIN, MIN_WIDTH, clampToViewport, clampWidth, readState, storageKey } from "./calendar-popup";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("./actions", () => ({
  saveReminderAction: vi.fn(),
  deleteReminderAction: vi.fn(),
  saveMeetingScheduleAction: vi.fn(),
  saveMeetingOccurrenceAction: vi.fn(),
  loadCalendarPopupAction: vi.fn(),
}));

/*
 * The owner, 27 Nov 2026: "can we make the calendar pop up and be resizable so anytime we go in other tabs it stays there
 * pls resizable and can click X for both apps", then "also i thought i said we should have a way to minimize this and go
 * through tabs with this open or something and a tab that we can collapse on the right side or somethng". Invented people
 * only.
 */
const month = (m: string): CalendarPopupData => ({
  ok: true,
  month: m,
  today: "2026-11-27",
  view: { from: `${m}-01`, to: `${m}-28`, notes: [], events: [{ id: "hub:meeting:stc-dm:x", source: "leadership-hub", kind: "meeting", title: "STC DM L10", date: `${m}-02`, href: "/meetings/stc-dm", meetingKey: "stc-dm" }] },
  meetings: [],
  hubUrl: null,
  canEditSchedules: false,
});
const KEY = storageKey("user-1");
const stored = () => JSON.parse(window.localStorage.getItem(KEY)!);
const loader = () => vi.fn(async (m: string | null) => month(m ?? "2026-11"));

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
});
afterEach(() => cleanup());

describe("the Calendar panel docked on the right (the owner, 27 Nov 2026)", () => {
  it('starts as a "Calendar" tab on the right edge; the tab opens the panel beside the page, which makes room for it', async () => {
    const load = loader();
    render(<CalendarPopup userKey="user-1" load={load} />);
    await userEvent.click(await screen.findByRole("button", { name: "Open the Calendar panel" }));
    const panel = screen.getByRole("complementary", { name: "Calendar panel" });
    expect(await screen.findByRole("heading", { name: "November 2026" })).toBeTruthy();
    expect(panel.textContent).toMatch(/STC DM L10/);
    expect(panel.style.right).toBe("0px");
    expect(panel.style.width).toBe("420px");
    expect(document.body.style.paddingRight).toBe("420px");
    expect(load).toHaveBeenCalledWith(null);
    expect(stored().mode).toBe("docked");
    expect(screen.getByRole("link", { name: "Open the full page" }).getAttribute("href")).toBe("/calendar");
  });

  it('"»" collapses it back to the tab, the page gets its room back, and that is remembered', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ mode: "docked", width: 500 }));
    render(<CalendarPopup userKey="user-1" load={loader()} />);
    await screen.findByRole("complementary", { name: "Calendar panel" });
    await userEvent.click(screen.getByRole("button", { name: "Collapse the Calendar panel" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByRole("button", { name: "Open the Calendar panel" })).toBeTruthy();
    expect(document.body.style.paddingRight).toBe("");
    expect(stored().mode).toBe("collapsed");
  });

  it('"go through tabs with this open": docked after a reload (or on another page) at the width it was left', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ mode: "docked", width: 560 }));
    render(<CalendarPopup userKey="user-1" load={loader()} />);
    const panel = await screen.findByRole("complementary", { name: "Calendar panel" });
    expect(panel.style.width).toBe("560px");
  });

  it("resizes by dragging its left edge, within its limits, and the width is remembered", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ mode: "docked", width: 420 }));
    render(<CalendarPopup userKey="user-1" load={loader()} />);
    const edge = await screen.findByRole("separator", { name: "Resize the Calendar panel" });
    act(() => {
      fireEvent.pointerDown(edge, { clientX: 860 });
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 760 }));
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
    expect(screen.getByRole("complementary").style.width).toBe("520px");
    expect(stored().width).toBe(520);
    act(() => {
      fireEvent.pointerDown(edge, { clientX: 760 });
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 1270 }));
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
    expect(screen.getByRole("complementary").style.width).toBe(`${MIN_WIDTH}px`);
    // The keyboard does the same (arrow left widens).
    fireEvent.keyDown(edge, { key: "ArrowLeft" });
    expect(screen.getByRole("complementary").style.width).toBe(`${MIN_WIDTH + 24}px`);
  });

  it("never wider than its maximum, nor so wide the page has no room", () => {
    expect(clampWidth(5000, 2400)).toBe(MAX_WIDTH);
    expect(clampWidth(800, 1000)).toBe(680);
    expect(clampWidth(100, 1280)).toBe(MIN_WIDTH);
  });

  it("pops out as a floating window that moves by its header, and docks again", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ mode: "docked", width: 420, x: 100, y: 100, w: 700, h: 500 }));
    render(<CalendarPopup userKey="user-1" load={loader()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Pop out the Calendar" }));
    const win = screen.getByRole("dialog", { name: "Calendar window" });
    expect(document.body.style.paddingRight).toBe("");
    expect(win.style.resize).toBe("both");
    expect(win.style.minWidth).toBe(`${MIN.w}px`);
    const header = screen.getByTestId("calendar-window-header");
    act(() => {
      fireEvent.pointerDown(header, { clientX: 200, clientY: 200 });
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 260, clientY: 230 }));
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
    expect(win.style.left).toBe("160px");
    expect(win.style.top).toBe("130px");
    expect(stored()).toMatchObject({ mode: "floating", x: 160, y: 130 });
    await userEvent.click(screen.getByRole("button", { name: "Dock the Calendar on the right" }));
    expect(screen.getByRole("complementary", { name: "Calendar panel" })).toBeTruthy();
  });

  it("on a phone it opens as a full-screen sheet with an X", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    render(<CalendarPopup userKey="user-1" load={loader()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Open the Calendar panel" }));
    const sheet = screen.getByRole("dialog", { name: "Calendar window" });
    expect(sheet.style.width).toBe("100vw");
    expect(sheet.style.height).toBe("100dvh");
    expect(document.body.style.paddingRight).toBe("");
    expect(screen.queryByRole("separator")).toBeNull();
    expect(screen.getByRole("button", { name: "Collapse the Calendar panel" }).textContent).toBe("✕");
  });

  it("the month buttons inside it load that month in the panel", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ mode: "docked" }));
    const load = loader();
    render(<CalendarPopup userKey="user-1" load={load} />);
    await screen.findByRole("heading", { name: "November 2026" });
    await userEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(load).toHaveBeenLastCalledWith("2026-12");
    expect(await screen.findByRole("heading", { name: "December 2026" })).toBeTruthy();
  });

  it("says so when the calendar cannot be read, and never shows someone else's", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ mode: "docked" }));
    render(<CalendarPopup userKey="user-1" load={async () => ({ ok: false })} />);
    expect((await screen.findByRole("status")).textContent).toMatch(/could not be loaded/);
  });
});

describe("its remembered state", () => {
  it("is per person and survives bad or blocked storage", () => {
    expect(storageKey("a")).not.toBe(storageKey("b"));
    window.localStorage.setItem(KEY, "{not json");
    expect(readState(KEY)).toMatchObject({ mode: "collapsed" });
    window.localStorage.setItem(KEY, JSON.stringify({ mode: "docked", width: 99999, w: 10, h: 10 }));
    expect(readState(KEY)).toMatchObject({ mode: "docked", width: MAX_WIDTH, w: MIN.w, h: MIN.h });
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readState(KEY).mode).toBe("collapsed");
    get.mockRestore();
  });

  it("keeps the floating window's header on screen", () => {
    expect(clampToViewport({ mode: "floating", width: 420, x: -50, y: 5000, w: 700, h: 500 }, 1280, 900)).toMatchObject({ x: 0, y: 860 });
  });
});
