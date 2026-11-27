// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CalendarEvent } from "@/lib/calendar/types";
import { CalendarView, cellSummary, dayLabel, monthLabel } from "./calendar-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("./actions", () => ({ saveReminderAction: vi.fn(), deleteReminderAction: vi.fn(), saveMeetingScheduleAction: vi.fn() }));

/* Invented people only. */
const fu = (n: number, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ id: `sunny:follow-up:${n}`, source: "ask-sunny", kind: "form-follow-up", title: `Avery Sample · Coaching Form ${n}`, date: "2026-11-30", href: `/forms/monitoring?followup=open&employee=Avery%20Sample`, ...extra });
const EVENTS: CalendarEvent[] = [
  { id: "hub:meeting:stc-dm:2026-11-30", source: "leadership-hub", kind: "meeting", title: "STC DM L10", date: "2026-11-30", startTime: "10:00", minutes: 90, href: "/meetings/stc-dm", meetingKey: "stc-dm" },
  fu(1, { status: "overdue" }),
  fu(2),
  fu(3),
  { id: "sunny:hr-approval:h1", source: "ask-sunny", kind: "hr-approval", title: "With HR: Policy Review · Blake Example", date: "2026-11-30", href: "/forms/hr-approval/h1" },
  { id: "sunny:reminder:a", source: "ask-sunny", kind: "reminder", title: "Order lamps", date: "2026-11-30", href: "/calendar", visibility: "only_me", mine: true, reminderId: "11111111-1111-1111-1111-111111111111" },
  { id: "sunny:reminder:b", source: "ask-sunny", kind: "reminder", title: "Prep huddle", date: "2026-11-30", href: "/calendar", visibility: "my_team", mine: false, by: "Casey Example", reminderId: "22222222-2222-2222-2222-222222222222" },
];
const view = (events = EVENTS, notes: string[] = []) => ({ from: "2026-11-01", to: "2026-12-12", events, notes });

afterEach(() => cleanup());

describe("Calendar (month view)", () => {
  it("shows the month, a note per failed source and filter chips with this month's counts", () => {
    render(<CalendarView month="2026-11" today="2026-11-30" view={view(EVENTS, ["Couldn't load meetings and reminders from the Leadership Hub just now. Showing everything else. Refresh to try again."])} save={vi.fn()} remove={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "November 2026" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Leadership Hub/);
    expect(screen.getByRole("button", { name: /Form follow-ups/ }).textContent).toMatch(/3$/);
    expect(screen.getByRole("button", { name: /Reminders/ }).textContent).toMatch(/2$/);
  });

  it("keeps a busy day readable: two events, then counts per type", () => {
    render(<CalendarView month="2026-11" today="2026-11-30" view={view()} save={vi.fn()} remove={vi.fn()} />);
    const cell = screen.getByRole("button", { name: "Monday, Nov 30: 7 events" });
    expect(within(cell).getByText("+2 follow-ups")).toBeTruthy();
    expect(within(cell).getByText("+1 approval")).toBeTruthy();
    expect(within(cell).getByText("+2 reminders")).toBeTruthy();
  });

  it("today's panel links to the form and the L10 tab, shows overdue, and lets only the owner delete a reminder", async () => {
    const remove = vi.fn(async () => ({ ok: true }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<CalendarView month="2026-11" today="2026-11-30" view={view()} save={vi.fn()} remove={remove} />);
    const day = within(screen.getByRole("region", { name: "Monday, Nov 30" }));
    expect(day.getByRole("link", { name: "STC DM L10" }).getAttribute("href")).toBe("/meetings/stc-dm");
    expect(day.getByText("10:00 AM CT · 90 min")).toBeTruthy();
    expect(day.getByText("Overdue")).toBeTruthy();
    expect(day.getByText(/from Casey Example/)).toBeTruthy();
    expect(day.queryByRole("button", { name: "Delete reminder Prep huddle" })).toBeNull();
    await userEvent.click(day.getByRole("button", { name: "Delete reminder Order lamps" }));
    expect(remove).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
  });

  it("+ New event saves a reminder as the person, Only me by default", async () => {
    const save = vi.fn(async () => ({ ok: true as const, id: "x", already: false }));
    render(<CalendarView month="2026-11" today="2026-11-30" view={view([])} save={save} remove={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "+ New event" }));
    await userEvent.type(screen.getByLabelText("Title"), "Order lamps");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: "Order lamps", date: "2026-11-30", time: null, visibility: "only_me" }));
  });

  it("formats labels", () => {
    expect(dayLabel("2026-12-01")).toBe("Tuesday, Dec 1");
    expect(monthLabel("2027-01")).toBe("January 2027");
    expect(cellSummary(EVENTS.slice(0, 2)).more).toEqual([]);
  });
});

describe("Calendar (L10 details from the Leadership Hub)", () => {
  /* Invented people only. */
  const MEETINGS = [
    { key: "stc-dm", name: "STC DM L10", team: "STC District Managers", weekday: 1, startTime: "10:00", minutes: 90, leader: "Robin Example", attendees: ["Robin Example", "Pat Sample"] },
    { key: "stc-sd-one", name: "Example SD L10", team: null, weekday: null, startTime: null, minutes: 60, leader: "Lee Demo", attendees: ["Lee Demo"] },
  ];
  it("a meeting opens its details, read-only, with Open the L10 and Set it in the Leadership Hub", async () => {
    render(<CalendarView month="2026-11" today="2026-11-30" view={view()} meetings={MEETINGS} hubCalendarUrl="https://hub.example.test/meetings/calendar" save={vi.fn()} remove={vi.fn()} />);
    await userEvent.click(screen.getAllByRole("button", { name: "STC DM L10: details" })[0]!);
    const panel = screen.getByRole("region", { name: "STC DM L10 details" });
    expect(panel.textContent).toMatch(/Mondays at 10:00 AM CT · 90 min/);
    expect(within(panel).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Robin Example", "Pat Sample"]);
    expect(within(panel).getByRole("link", { name: "Open the L10" }).getAttribute("href")).toBe("/meetings/stc-dm");
    expect(within(panel).getByRole("link", { name: "Set it in the Leadership Hub" }).getAttribute("href")).toBe("https://hub.example.test/meetings/calendar");
    expect(within(panel).queryByRole("button", { name: /Save|Edit/ })).toBeNull();
  });
  it('lists the L10s with no day set, each opening its details with "Time not set"', async () => {
    render(<CalendarView month="2026-11" today="2026-11-30" view={view()} meetings={MEETINGS} hubCalendarUrl={null} save={vi.fn()} remove={vi.fn()} />);
    const list = screen.getByRole("region", { name: "No day set" });
    await userEvent.click(within(list).getByRole("button", { name: "Example SD L10: details" }));
    const panel = screen.getByRole("region", { name: "Example SD L10 details" });
    expect(panel.textContent).toMatch(/No day set/);
    expect(panel.textContent).toMatch(/Time not set/);
    expect(panel.textContent).toMatch(/set in the Leadership Hub/);
  });
});

/**
 * The owner, 27 Nov 2026, on the live Calendar as an admin with only the STC DM L10 plotted: "can u ask it to plot the
 * calendar pls for all meetings recurring DM L10 etc". The Leadership Hub now sends the Leadership and Maintenance L10s
 * too, marked opensInApp false: they are plotted and open in the Hub. The SD L10s with no day are listed as "day not
 * set", and an admin sets their day and time here (saved in the Hub). Invented people only.
 */
describe("Calendar: every recurring L10 (the owner, 27 Nov 2026)", () => {
  const HUB = "https://hub.example.test";
  const ALL: CalendarEvent[] = [
    { id: "hub:meeting:leadership:2026-11-30", source: "leadership-hub", kind: "meeting", title: "Leadership L10", date: "2026-11-30", startTime: "09:00", minutes: 90, href: `${HUB}/meetings/leadership`, meetingKey: "leadership" },
    { id: "hub:meeting:stc-dm:2026-11-30", source: "leadership-hub", kind: "meeting", title: "STC DM L10", date: "2026-11-30", minutes: 90, href: "/meetings/stc-dm", meetingKey: "stc-dm" },
    { id: "hub:meeting:maintenance:2026-11-25", source: "leadership-hub", kind: "meeting", title: "Maintenance L10", date: "2026-11-25", minutes: 60, href: `${HUB}/meetings/maintenance`, meetingKey: "maintenance" },
  ];
  const MEETINGS = [
    { key: "leadership", name: "Leadership L10", team: "Executive Team", weekday: 1, startTime: "09:00", minutes: 90, leader: "Robin Example", attendees: ["Robin Example"], opensInApp: false },
    { key: "maintenance", name: "Maintenance L10", team: "Maintenance Crew", weekday: 3, startTime: null, minutes: 60, leader: "Pat Sample", attendees: ["Pat Sample"], opensInApp: false },
    { key: "stc-dm", name: "STC DM L10", team: "STC District Managers", weekday: 1, startTime: null, minutes: 90, leader: "Lee Demo", attendees: ["Lee Demo"] },
    { key: "stc-sd-one", name: "Example SD L10", team: null, weekday: null, startTime: null, minutes: 60, leader: "Casey Example", attendees: ["Casey Example"] },
  ];
  const UNSET = "Example SD L10";

  it('"plot the calendar pls for all meetings recurring DM L10 etc": the Leadership, STC DM and Maintenance L10s are all on the calendar', () => {
    render(<CalendarView month="2026-11" today="2026-11-30" view={view(ALL)} meetings={MEETINGS} hubUrl={HUB} hubCalendarUrl={`${HUB}/meetings/calendar`} save={vi.fn()} remove={vi.fn()} />);
    for (const name of ["Leadership L10", "STC DM L10", "Maintenance L10"]) expect(screen.getAllByRole("button", { name: `${name}: details` }).length).toBeGreaterThan(0);
  });

  it("a meeting this app only shows opens in the Leadership Hub, not this app's L10 tab", async () => {
    render(<CalendarView month="2026-11" today="2026-11-30" view={view(ALL)} meetings={MEETINGS} hubUrl={HUB} hubCalendarUrl={`${HUB}/meetings/calendar`} save={vi.fn()} remove={vi.fn()} />);
    await userEvent.click(screen.getAllByRole("button", { name: "Leadership L10: details" })[0]!);
    const panel = screen.getByRole("region", { name: "Leadership L10 details" });
    expect(within(panel).getByRole("link", { name: "Open the L10 in the Leadership Hub" }).getAttribute("href")).toBe(`${HUB}/meetings/leadership`);
  });

  it('an admin sets a meeting\'s day and time from "day not set"; it is saved in the Hub and the calendar reloads', async () => {
    const saveSchedule = vi.fn().mockResolvedValue({ ok: true });
    render(<CalendarView month="2026-11" today="2026-11-30" view={view(ALL)} meetings={MEETINGS} hubUrl={HUB} canEditSchedules saveSchedule={saveSchedule} save={vi.fn()} remove={vi.fn()} />);
    const list = screen.getByRole("region", { name: "No day set" });
    expect(list.textContent).toMatch(/day not set/);
    await userEvent.click(within(list).getByRole("button", { name: `Set ${UNSET} day and time` }));
    const form = screen.getByRole("form", { name: `Set ${UNSET} day and time` });
    await userEvent.selectOptions(within(form).getByRole("combobox"), "Tuesday");
    await userEvent.type(form.querySelector('input[type="time"]') as HTMLInputElement, "10:30");
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(saveSchedule).toHaveBeenCalledWith({ key: MEETINGS[3]!.key, weekday: 2, time: "10:30", minutes: 60 });
    expect(screen.queryByRole("form", { name: `Set ${UNSET} day and time` })).toBeNull();
  });

  it("a refused save says why, and someone who is not an admin gets no editor", async () => {
    const saveSchedule = vi.fn().mockResolvedValue({ ok: false, reason: "forbidden" });
    render(<CalendarView month="2026-11" today="2026-11-30" view={view(ALL)} meetings={MEETINGS} hubUrl={HUB} canEditSchedules saveSchedule={saveSchedule} save={vi.fn()} remove={vi.fn()} />);
    await userEvent.click(within(screen.getByRole("region", { name: "No day set" })).getByRole("button", { name: `Set ${UNSET} day and time` }));
    await userEvent.click(within(screen.getByRole("form", { name: `Set ${UNSET} day and time` })).getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Only Leadership Hub admins/);
    cleanup();
    render(<CalendarView month="2026-11" today="2026-11-30" view={view(ALL)} meetings={MEETINGS} hubUrl={HUB} save={vi.fn()} remove={vi.fn()} />);
    expect(within(screen.getByRole("region", { name: "No day set" })).queryByRole("button", { name: /Set .* day and time/ })).toBeNull();
  });

  it("a struck-through filter chip is only toggled off: it starts on, hides its events when pressed, and shows them again", async () => {
    render(<CalendarView month="2026-11" today="2026-11-30" view={view()} save={vi.fn()} remove={vi.fn()} />);
    const chip = screen.getByRole("button", { name: /Form follow-ups/ });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(chip.className).not.toMatch(/line-through/);
    await userEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    expect(chip.className).toMatch(/line-through/);
    await userEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });
});

/** The owner, 27 Nov 2026: "can you also add holidays in the calendar in all apps pls US holiday". */
describe("Calendar: US holidays", () => {
  const XMAS: CalendarEvent = { id: "sunny:holiday:2026-12-25:christmas-day", source: "ask-sunny", kind: "holiday", title: "Christmas Day", date: "2026-12-25", href: "/calendar" };
  const EVE: CalendarEvent = { id: "sunny:holiday:2026-12-24:christmas-eve", source: "ask-sunny", kind: "holiday", title: "Christmas Eve (observance)", date: "2026-12-24", href: "/calendar" };
  it("shows them all day with their own Holidays chip; an entry is its name only, opening nothing", async () => {
    render(<CalendarView month="2026-12" today="2026-12-25" view={{ from: "2026-11-29", to: "2027-01-09", events: [XMAS, EVE], notes: [] }} meetings={[]} save={vi.fn()} remove={vi.fn()} />);
    const chip = screen.getByRole("button", { name: /Holidays/ });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    const day = screen.getByRole("region", { name: dayLabel("2026-12-25") });
    expect(day.textContent).toMatch(/All day/);
    expect(day.textContent).toMatch(/Christmas Day/);
    expect(within(day).queryByRole("link")).toBeNull();
    await userEvent.click(chip);
    expect(screen.getByRole("region", { name: dayLabel("2026-12-25") }).textContent).not.toMatch(/Christmas Day/);
  });
});
