// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { PARTNER_HEADERS, signPartnerRequest } from "@/features/l10/partner/signature";
import type { AuthenticatedIdentity } from "@/lib/auth/types";
import { mergeSources } from "./merge";
import { handlePartnerCalendar, type PartnerCalendarDeps } from "./partner";
import { monthGrid } from "./range";
import { followUpEvents, hrEvents, mayView, reminderEvents, reviewsEvents, reviewsSchedule } from "./sources";
import type { CalendarEvent } from "./types";

/* Invented people and places only (src/lib/security/no-real-people.test.ts). */
const ORIGIN = "https://sunny.example.test";

describe("this app's calendar events", () => {
  it("follow-ups are all-day 'Employee · form' on their date, flagged by the one overdue rule, opening that employee's follow-ups", () => {
    const [late, today] = followUpEvents(
      [
        { id: "f1", employeeName: "Avery Sample", templateName: "Coaching Form", locationName: "Example Salon", followUpDate: "2026-11-20", overdue: true },
        { id: "f2", employeeName: "Blake Example", templateName: "Policy Review", locationName: null, followUpDate: "2026-11-26", overdue: false },
      ],
      "2026-11-26",
      ORIGIN,
    );
    expect(late).toMatchObject({ id: "sunny:follow-up:f1", kind: "form-follow-up", title: "Avery Sample · Coaching Form", date: "2026-11-20", status: "overdue", location: "Example Salon" });
    expect(late.href).toBe(`${ORIGIN}/forms/monitoring?followup=overdue&employee=Avery%20Sample`);
    expect(today.status).toBe("due");
    expect(today.startTime).toBeUndefined();
  });

  it("HR approvals sit on their due day and open the form's HR page", () => {
    const [e] = hrEvents([{ id: "h1", line: "Coaching Form · Avery Sample", dueDate: "2026-11-27", overdue: false, label: "Approve" }], "2026-11-26", ORIGIN);
    expect(e).toMatchObject({ kind: "hr-approval", title: "Approve: Coaching Form · Avery Sample", date: "2026-11-27", status: "upcoming", href: `${ORIGIN}/forms/hr-approval/h1` });
  });

  it("Google Reviews: weekly per salon on the configured day (default Monday 9:30 CT); one check for an unlimited account", () => {
    expect(reviewsSchedule({})).toEqual({ weekday: 1, time: "09:30" });
    expect(reviewsSchedule({ CALENDAR_REVIEWS_WEEKDAY: "3", CALENDAR_REVIEWS_TIME: "14:15" })).toEqual({ weekday: 3, time: "14:15" });
    expect(reviewsSchedule({ CALENDAR_REVIEWS_WEEKDAY: "9", CALENDAR_REVIEWS_TIME: "noon" })).toEqual({ weekday: 1, time: "09:30" });
    const two = reviewsEvents({ all: false, salons: [{ number: "9001", name: "Example North" }, { number: "9002", name: "Example South" }] }, "2026-11-23", "2026-12-06", { weekday: 1, time: "09:30" }, ORIGIN);
    expect(two.map((e) => [e.date, e.location])).toEqual([
      ["2026-11-23", "Example North"],
      ["2026-11-23", "Example South"],
      ["2026-11-30", "Example North"],
      ["2026-11-30", "Example South"],
    ]);
    expect(two[0]).toMatchObject({ kind: "google-reviews", startTime: "09:30", title: "Check Google Reviews: Example North", href: `${ORIGIN}/reviews` });
    expect(reviewsEvents({ all: true }, "2026-11-23", "2026-11-29", { weekday: 1, time: "09:30" }, ORIGIN).map((e) => e.title)).toEqual(["Check Google Reviews: every salon"]);
  });

  it("a team reminder reaches the leaders whose salons overlap; an 'only me' reminder reaches nobody else", () => {
    const team = { owner_subject: "owner", visibility: "my_team" as const, team_salon_numbers: ["9001"] };
    expect(mayView(team, { subject: "owner", coverage: [], manager: true })).toBe(true);
    expect(mayView(team, { subject: "dm", coverage: ["9001", "9002"], manager: true })).toBe(true);
    expect(mayView(team, { subject: "admin", coverage: null, manager: true })).toBe(true);
    expect(mayView(team, { subject: "other", coverage: ["9003"], manager: true })).toBe(false);
    expect(mayView(team, { subject: "staff", coverage: ["9001"], manager: false })).toBe(false);
    expect(mayView({ ...team, visibility: "only_me" }, { subject: "dm", coverage: ["9001"], manager: true })).toBe(false);
    expect(mayView({ ...team, team_salon_numbers: null }, { subject: "sd", coverage: ["9003"], manager: true })).toBe(true);
    const [own, theirs] = reminderEvents(
      [
        { id: "11111111-1111-1111-1111-111111111111", owner_subject: "me", title: "Order lamps", on_date: "2027-01-20", start_time: "09:30:00", visibility: "only_me" },
        { id: "22222222-2222-2222-2222-222222222222", owner_subject: "them", owner_name: "Casey Example", title: "Prep huddle", on_date: "2027-01-21", start_time: null, visibility: "my_team" },
      ],
      "me",
      "",
    );
    expect(own).toMatchObject({ kind: "reminder", startTime: "09:30", mine: true, reminderId: "11111111-1111-1111-1111-111111111111" });
    expect(theirs).toMatchObject({ mine: false, by: "Casey Example" });
  });

  it("one failed source leaves the rest with a note; time off and the other company's events never show", () => {
    const view = mergeSources("2026-11-01", "2026-12-12", [
      { source: "ask-sunny", state: "ok", events: [...followUpEvents([{ id: "f1", employeeName: "Avery Sample", templateName: "Coaching Form", locationName: null, followUpDate: "2026-11-30", overdue: false }], "2026-11-26", ""), { id: "x", source: "ask-sunny", kind: "time-off", title: "PTO", date: "2026-11-30", href: "/x" } as unknown as CalendarEvent, { id: "b", source: "ask-bubbles", kind: "form-follow-up", title: "Other company", date: "2026-11-30", href: "/x" }] },
      { source: "leadership-hub", state: "failed" },
    ]);
    expect(view.events.map((e) => e.id)).toEqual(["sunny:follow-up:f1"]);
    expect(view.notes[0]).toMatch(/Couldn't load meetings and reminders from the Leadership Hub/);
    expect(monthGrid("2026-11").days).toHaveLength(42);
  });
});

describe("POST /api/partner/calendar (the Hub's signed read)", () => {
  const SECRET = "s".repeat(40);
  const NOW = Date.parse("2026-11-26T18:00:00Z");
  const PERSON: AuthenticatedIdentity = { subject: "u1", email: "avery@example.test", displayName: "Avery Sample", role: "salon_director", scope: { level: "salon", primaryAreaId: "loc-9001", alsoCoversAreaIds: [] }, verified: true };
  const EVENTS: CalendarEvent[] = [
    { id: "sunny:follow-up:f1", source: "ask-sunny", kind: "form-follow-up", title: "Avery Sample · Coaching Form", date: "2026-11-30", href: `${ORIGIN}/forms/monitoring` },
    { id: "hub:meeting:stc-dm:2026-12-01", source: "leadership-hub", kind: "meeting", title: "STC DM L10", date: "2026-12-01", href: "/meetings/stc-dm" },
  ];
  const deps = (over: Partial<PartnerCalendarDeps> = {}): PartnerCalendarDeps => ({
    secret: SECRET,
    origin: ORIGIN,
    now: NOW,
    claimNonce: async () => true,
    rateLimited: () => false,
    identityByEmail: async (email) => (email.toLowerCase() === "avery@example.test" ? PERSON : null),
    load: async (_i, range) => ({ ok: true, view: { ...range, events: EVENTS, notes: [] } }),
    ...over,
  });
  const signed = (body: object, partner = "leadership-hub", secret = SECRET) => {
    const text = JSON.stringify(body);
    const ts = String(NOW);
    return { headers: new Headers({ [PARTNER_HEADERS.partner]: partner, [PARTNER_HEADERS.timestamp]: ts, [PARTNER_HEADERS.signature]: signPartnerRequest(secret, partner, ts, text) }), text };
  };
  const BODY = { email: "Avery@Example.test", nonce: "n".repeat(20), from: "2026-11-01", to: "2026-12-12" };

  it("answers the Hub with this app's events only, read as that person", async () => {
    const load = vi.fn(deps().load);
    const { headers, text } = signed(BODY);
    const r = await handlePartnerCalendar(headers, text, deps({ load }));
    expect(r.status).toBe(200);
    expect((r.body.events as CalendarEvent[]).map((e) => e.id)).toEqual(["sunny:follow-up:f1"]);
    expect(load).toHaveBeenCalledWith(PERSON, { from: "2026-11-01", to: "2026-12-12" }, ORIGIN);
  });

  it.each([
    ["no secret", () => signed(BODY), { secret: undefined }],
    ["no https origin", () => signed(BODY), { origin: "http://sunny.example.test" }],
    ["signed as this app's own id", () => signed(BODY, "ask-sunny"), {}],
    ["a wrong secret", () => signed(BODY, "leadership-hub", "t".repeat(40)), {}],
    ["a replayed nonce", () => signed(BODY), { claimNonce: async () => false }],
    ["an unknown email", () => signed({ ...BODY, email: "nobody@example.test" }), {}],
  ])("is a plain 404 for %s", async (_label, make, over) => {
    const { headers, text } = make();
    expect((await handlePartnerCalendar(headers, text, deps(over as Partial<PartnerCalendarDeps>))).status).toBe(404);
  });

  it("refuses a bad range and rate-limits per person", async () => {
    const bad = signed({ ...BODY, to: "2027-06-01" });
    expect((await handlePartnerCalendar(bad.headers, bad.text, deps())).status).toBe(400);
    const ok = signed(BODY);
    expect((await handlePartnerCalendar(ok.headers, ok.text, deps({ rateLimited: () => true }))).status).toBe(429);
  });
});
