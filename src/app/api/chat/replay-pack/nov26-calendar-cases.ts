import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE AI CAN READ THE CALENDAR, AND ADDS TO IT ONLY THROUGH A CARD (Pau, 26 Nov 2026)
 * ============================================================================
 *
 * The Calendar (one calendar with the Leadership Hub and Ask Bubbles) is a new page, so it ships with its reader
 * (CLAUDE.md §5): read_calendar is the page's own read, and propose_reminder puts a reminder card on screen that the
 * manager confirms (the sibling Ask Vicki's "Add a reminder to my calendar for January 20 titled Order lamps"). Asked
 * in a manager's words, through the real chat route:
 *   1. "what's on my calendar this week?" — the follow-ups due this week reach the model, overdue flagged.
 *   2. "when is my next L10?" — the L10 meeting the Leadership Hub returns reaches the model with its day and CT time.
 *   3. "Add a reminder to my calendar for January 20 titled Order lamps" — a card on the answer; nothing saved.
 * Invented people only.
 */
const REPORT = "Pau, 26 Nov 2026: a Calendar in Ask Sunny, Ask Bubbles and the Leadership Hub, readable by the AI";
const FLAG = "AGENT_LOOP_ENABLED";
type Row = Record<string, unknown>;

async function seedFollowUps(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-24T15:00:00Z"));
  t.loopModel!(loopStandIn((view: LoopView) => (lastResult(view, "propose_form")
    ? { text: "Here's the card." }
    : { tool: "propose_form", input: { template_key: "coaching", employee_id: STAFF[0]!.id, what_happened: "Arrived late to open.", incident_date: "2026-11-24" } })));
  const setup = t.thread();
  await setup.say(`coaching form for ${STAFF[0]!.firstName} ${STAFF[0]!.lastName}, late to open`);
  const id = await setup.create();
  const forms = t.forms() as unknown as Row[];
  const base = forms.find((row) => row.id === id)!;
  forms.splice(forms.indexOf(base), 1);
  const add = (id: string, followUp: string) => forms.push({ ...base, id, status: "finalized", revises_instance_id: null, follow_up_date: followUp, followed_up_at: null, created_at: "2026-11-01T10:00:00Z" });
  add("cal-late", "2026-11-23");
  add("cal-thu", "2026-11-26");
  add("cal-next-month", "2027-01-05");
  vi.setSystemTime(new Date("2026-11-24T16:00:00Z"));
}

type CalendarOutput = { events?: { date: string; what: string; title: string; status?: string; time_ct?: string | null; weekday?: string }[]; refused?: string; error?: string };
const calendarOf = (model: ReturnType<typeof loopStandIn>) =>
  model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_calendar")).at(-1)?.output as CalendarOutput | undefined;

export const NOV26_CALENDAR_CASES: ReplayCase[] = [
  {
    id: "nov26-calendar-whats-on-my-calendar-this-week",
    title: `"what's on my calendar this week?" — read_calendar gives the model this week's follow-ups (overdue flagged) from the Calendar page's own read`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      await seedFollowUps(t);
      const model = loopStandIn((view: LoopView) => (lastResult(view, "read_calendar") ? { text: "Here's your week." } : { tool: "read_calendar", input: { from: "2026-11-23", to: "2026-11-29" } }));
      t.loopModel!(model);
      await t.thread().say("what's on my calendar this week?");
      const output = calendarOf(model);
      expect(output?.refused, JSON.stringify(output)).toBeUndefined();
      expect(output?.error, JSON.stringify(output)).toBeUndefined();
      const followUps = (output?.events ?? []).filter((e) => e.what === "form-follow-up");
      expect(followUps.map((e) => [e.date, e.status])).toEqual([
        ["2026-11-23", "overdue"],
        ["2026-11-26", "upcoming"],
      ]);
      expect(followUps[0]!.title).toContain(STAFF[0]!.lastName);
      // Never next month's, never time off.
      expect((output?.events ?? []).some((e) => e.date > "2026-11-29")).toBe(false);
    },
  },
  {
    id: "nov26-calendar-when-is-my-next-l10",
    title: `"when is my next L10?" — the L10 the Leadership Hub returns for this person reaches the model with its day and CT time`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      vi.setSystemTime(new Date("2026-11-24T16:00:00Z"));
      const secret = process.env.HUB_PARTNER_SECRET;
      process.env.HUB_PARTNER_SECRET = "replay-hub-secret-0123456789abcdef0123";
      const hubAsked: string[] = [];
      vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
        hubAsked.push(JSON.parse(init.body).op);
        return new Response(
          JSON.stringify({ ok: true, events: [{ id: "hub:meeting:stc-dm:2026-12-01", source: "leadership-hub", kind: "meeting", title: "STC DM L10", date: "2026-12-01", startTime: "10:00", minutes: 90, status: "upcoming", href: "/meetings/stc-dm", meetingKey: "stc-dm" }] }),
          { status: url.endsWith("/api/partner/l10") ? 200 : 404 },
        );
      });
      try {
        const model = loopStandIn((view: LoopView) => (lastResult(view, "read_calendar") ? { text: "Your next L10 is Tuesday." } : { tool: "read_calendar", input: {} }));
        t.loopModel!(model);
        await t.thread().say("when is my next L10?");
        const meeting = (calendarOf(model)?.events ?? []).find((e) => e.what === "meeting");
        expect(hubAsked).toContain("calendar");
        expect(meeting).toMatchObject({ date: "2026-12-01", weekday: "Tuesday", time_ct: "10:00", title: "STC DM L10" });
      } finally {
        vi.unstubAllGlobals();
        if (secret === undefined) delete process.env.HUB_PARTNER_SECRET;
        else process.env.HUB_PARTNER_SECRET = secret;
      }
    },
  },
  {
    id: "nov26-calendar-add-a-reminder-is-a-card",
    title: `"Add a reminder to my calendar for January 20 titled Order lamps" — a reminder card on the answer (only me); the AI saves nothing`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      vi.setSystemTime(new Date("2026-11-24T16:00:00Z"));
      const model = loopStandIn((view: LoopView) => (lastResult(view, "propose_reminder") ? { text: "Your reminder card is ready." } : { tool: "propose_reminder", input: { title: "Order lamps", date: "2027-01-20" } }));
      t.loopModel!(model);
      const reply = await t.thread().say("Add a reminder to my calendar for January 20 titled Order lamps");
      expect(reply.reminderProposal).toEqual({ title: "Order lamps", date: "2027-01-20", time: null, visibility: "only_me" });
      const output = model.views.flatMap((view) => view.results.filter((result) => result.tool === "propose_reminder")).at(-1)?.output as { card?: { saved?: boolean } } | undefined;
      expect(output?.card?.saved).toBe(false);
    },
  },
  {
    id: "nov26-calendar-add-a-reminder-then-read-it-back",
    title: `"Add a reminder to my calendar for January 20 titled Order lamps", Add to calendar, then "what's on my calendar on January 20?" — the saved reminder is read back as theirs, only me`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      vi.setSystemTime(new Date("2026-11-24T16:00:00Z"));
      const add = loopStandIn((view: LoopView) => (lastResult(view, "propose_reminder") ? { text: "Your reminder card is ready." } : { tool: "propose_reminder", input: { title: "Order lamps", date: "2027-01-20" } }));
      t.loopModel!(add);
      const thread = t.thread();
      const reply = await thread.say("Add a reminder to my calendar for January 20 titled Order lamps");
      expect(reply.reminderProposal?.title).toBe("Order lamps");
      // The AI saved nothing; the manager presses Add to calendar (the Calendar's server action writes this row as them).
      expect(t.rows!("calendar_reminders")).toEqual([]);
      t.addRows!("calendar_reminders", [{ id: "11111111-1111-4111-8111-111111111111", owner_subject: "qa-manager", owner_email: "qa-manager@example.test", owner_name: "", title: "Order lamps", on_date: "2027-01-20", start_time: null, visibility: "only_me", team_salon_numbers: [], ref: "r-card", created_at: "2026-11-24T16:00:00Z", deleted_at: null }]);
      const read = loopStandIn((view: LoopView) => (lastResult(view, "read_calendar") ? { text: "You have Order lamps on January 20." } : { tool: "read_calendar", input: { from: "2027-01-20", to: "2027-01-20" } }));
      t.loopModel!(read);
      await thread.say("what's on my calendar on January 20?");
      const events = (calendarOf(read)?.events ?? []) as { what: string; title: string; who_can_see?: string; made_by?: string }[];
      expect(events.filter((e) => e.what === "reminder")).toEqual([expect.objectContaining({ title: "Order lamps", who_can_see: "only_me", made_by: "you" })]);
    },
  },
  {
    id: "nov26-calendar-time-off-is-refused",
    title: `"put my time off on my calendar for December 24" — refused: time off is never on the calendar; no card`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      vi.setSystemTime(new Date("2026-11-24T16:00:00Z"));
      const model = loopStandIn((view: LoopView) => (lastResult(view, "propose_reminder") ? { text: "Time off doesn't go on the calendar." } : { tool: "propose_reminder", input: { title: "Time off", date: "2026-12-24" } }));
      t.loopModel!(model);
      const reply = await t.thread().say("put my time off on my calendar for December 24");
      const output = model.views.flatMap((view) => view.results.filter((result) => result.tool === "propose_reminder")).at(-1)?.output as { refused?: string; reason_code?: string } | undefined;
      expect(output?.reason_code).toBe("time_off");
      expect(reply.reminderProposal).toBeUndefined();
    },
  },
  {
    id: "nov26-calendar-someone-elses-calendar-is-refused",
    title: `"add a reminder to Remy's calendar for Friday to restock lotion" — refused: only the manager's own calendar; no card`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      vi.setSystemTime(new Date("2026-11-24T16:00:00Z"));
      const model = loopStandIn((view: LoopView) => (lastResult(view, "propose_reminder") ? { text: "I can only add to your own calendar." } : { tool: "propose_reminder", input: { title: "Restock lotion", date: "2026-11-27", for_person: STAFF[1]!.firstName } }));
      t.loopModel!(model);
      const reply = await t.thread().say(`add a reminder to ${STAFF[1]!.firstName}'s calendar for Friday to restock lotion`);
      const output = model.views.flatMap((view) => view.results.filter((result) => result.tool === "propose_reminder")).at(-1)?.output as { refused?: string; reason_code?: string } | undefined;
      expect(output?.reason_code).toBe("not_for_others");
      expect(reply.reminderProposal).toBeUndefined();
      expect(t.rows!("calendar_reminders")).toEqual([]);
    },
  },
];
