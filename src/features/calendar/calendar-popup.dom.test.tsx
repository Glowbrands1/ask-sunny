// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CalendarPopupData } from "./actions";
import { CalendarPopup, MIN, clampToViewport, readState, storageKey } from "./calendar-popup";

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
 * pls resizable and can click X for both apps". Invented people only.
 */
const month = (m: string): CalendarPopupData => ({
  ok: true,
  month: m,
  today: "2026-11-27",
  view: { from: `${m}-01`, to: `${m}-28`, notes: [], events: [{ id: "hub:meeting:stc-dm:x", source: "leadership-hub", kind: "meeting", title: "STC DM L10", date: `${m}-02`, href: "/meetings/stc-dm", meetingKey: "stc-dm" }] },
  meetings: [],
  hubUrl: null,
  hubCalendarUrl: null,
  canEditSchedules: false,
});
const KEY = storageKey("user-1");

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
});
afterEach(() => cleanup());

describe("the floating Calendar (the owner, 27 Nov 2026)", () => {
  it("a button opens it over the app with the month view; X closes it; both are remembered", async () => {
    const load = vi.fn(async (m: string | null) => month(m ?? "2026-11"));
    render(<CalendarPopup userKey="user-1" load={load} />);
    await userEvent.click(await screen.findByRole("button", { name: "Open the Calendar window" }));
    const win = screen.getByRole("dialog", { name: "Calendar window" });
    expect(await screen.findByRole("heading", { name: "November 2026" })).toBeTruthy();
    expect(win.textContent).toMatch(/STC DM L10/);
    expect(load).toHaveBeenCalledWith(null);
    expect(JSON.parse(window.localStorage.getItem(KEY)!).open).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Close the Calendar window" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(KEY)!).open).toBe(false);
  });

  it('"stays there": reopened after a reload (or on another page) where it was left, the same size', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ open: true, x: 300, y: 120, w: 800, h: 600 }));
    render(<CalendarPopup userKey="user-1" load={async (m) => month(m ?? "2026-11")} />);
    const win = await screen.findByRole("dialog", { name: "Calendar window" });
    expect(win.style.left).toBe("300px");
    expect(win.style.top).toBe("120px");
    expect(win.style.width).toBe("800px");
    expect(win.style.height).toBe("600px");
    expect(win.style.resize).toBe("both");
    expect(win.style.minWidth).toBe(`${MIN.w}px`);
  });

  it("moves by dragging its header, and the new place is remembered", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ open: true, x: 100, y: 100, w: 700, h: 500 }));
    render(<CalendarPopup userKey="user-1" load={async (m) => month(m ?? "2026-11")} />);
    const header = await screen.findByTestId("calendar-window-header");
    act(() => {
      fireEvent.pointerDown(header, { clientX: 200, clientY: 200 });
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 260, clientY: 230 }));
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
    const win = screen.getByRole("dialog", { name: "Calendar window" });
    expect(win.style.left).toBe("160px");
    expect(win.style.top).toBe("130px");
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toMatchObject({ x: 160, y: 130 });
  });

  it("moves between months inside the window, without leaving the page", async () => {
    const load = vi.fn(async (m: string | null) => month(m ?? "2026-11"));
    window.localStorage.setItem(KEY, JSON.stringify({ open: true, x: 10, y: 10, w: 700, h: 500 }));
    render(<CalendarPopup userKey="user-1" load={load} />);
    await screen.findByRole("heading", { name: "November 2026" });
    await userEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(load).toHaveBeenLastCalledWith("2026-12");
    expect(await screen.findByRole("heading", { name: "December 2026" })).toBeTruthy();
  });

  it("fills the screen at phone width", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    window.localStorage.setItem(KEY, JSON.stringify({ open: true, x: 300, y: 120, w: 800, h: 600 }));
    render(<CalendarPopup userKey="user-1" load={async (m) => month(m ?? "2026-11")} />);
    const win = await screen.findByRole("dialog", { name: "Calendar window" });
    expect(win.style.width).toBe("100vw");
    expect(win.style.resize).toBe("");
  });

  it("works when storage is blocked (a private window): it starts closed and still opens", async () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<CalendarPopup userKey="user-1" load={async (m) => month(m ?? "2026-11")} />);
    await userEvent.click(await screen.findByRole("button", { name: "Open the Calendar window" }));
    expect(screen.getByRole("dialog", { name: "Calendar window" })).toBeTruthy();
    spy.mockRestore();
    set.mockRestore();
  });

  it("says so when the calendar cannot be read, never an empty month", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ open: true, x: 10, y: 10, w: 700, h: 500 }));
    render(<CalendarPopup userKey="user-1" load={async () => ({ ok: false })} />);
    expect((await screen.findByRole("status")).textContent).toMatch(/could not be loaded/);
  });

  it("keeps the window's header on screen and never smaller than the minimum", () => {
    expect(clampToViewport({ open: true, x: 5000, y: -40, w: 100, h: 100 }, 1280, 900)).toEqual({ open: true, x: 1200, y: 0, w: MIN.w, h: MIN.h });
    window.localStorage.setItem("k", "not json");
    expect(readState("k").open).toBe(false);
  });
});
