import { expect, vi } from "vitest";

import { finalizeInstance, saveInstanceValues } from "@/lib/forms/instances";
import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * EVERY RECURRING L10, AND A CALENDAR THAT SYNCS (the owner, 27 Nov 2026)
 * ============================================================================
 *
 * On the live Calendar, signed in as an admin, only the STC DM L10 was plotted. The owner: "can u ask it to plot the
 * calendar pls for all meetings recurring DM L10 etc" and "make sure calendar syncs when new forms come etc". The
 * Leadership Hub only sent the meetings this app may open; it now also sends the shared Leadership and Maintenance L10s
 * (leadership-hub 20261216120000), which open in the Hub. Through the real chat route, Hub stubbed:
 *   1. "plot the calendar pls for all meetings recurring DM L10 etc" — read_calendar gives the model the Leadership,
 *      STC DM and Maintenance L10s that week, each with its day.
 *   2. "make sure calendar syncs when new forms come" — a coaching form filed just now, with a follow-up date, is on the
 *      calendar on that date at once: no cache, no nightly job.
 * Invented people only.
 */
const REPORT =
  "The owner, 27 Nov 2026: plot every recurring L10 on the Calendar, and new forms show on it at once";
const FLAG = "AGENT_LOOP_ENABLED";

type CalendarOutput = {
  events?: {
    date: string;
    what: string;
    title: string;
    status?: string;
    time_ct?: string | null;
    weekday?: string;
  }[];
  refused?: string;
  error?: string;
};
const calendarOf = (model: ReturnType<typeof loopStandIn>) =>
  model.views
    .flatMap((view) =>
      view.results.filter((result) => result.tool === "read_calendar"),
    )
    .at(-1)?.output as CalendarOutput | undefined;

const HUB_EVENTS = [
  {
    id: "hub:meeting:leadership:2026-11-30",
    source: "leadership-hub",
    kind: "meeting",
    title: "Leadership L10",
    date: "2026-11-30",
    startTime: "09:00",
    minutes: 90,
    status: "upcoming",
    href: "/meetings/leadership",
    meetingKey: "leadership",
    opensInApp: false,
  },
  {
    id: "hub:meeting:stc-dm:2026-11-30",
    source: "leadership-hub",
    kind: "meeting",
    title: "STC DM L10",
    date: "2026-11-30",
    minutes: 90,
    status: "upcoming",
    href: "/meetings/stc-dm",
    meetingKey: "stc-dm",
  },
  {
    id: "hub:meeting:maintenance:2026-12-02",
    source: "leadership-hub",
    kind: "meeting",
    title: "Maintenance L10",
    date: "2026-12-02",
    minutes: 60,
    status: "upcoming",
    href: "/meetings/maintenance",
    meetingKey: "maintenance",
    opensInApp: false,
  },
];

/** The Hub answers "calendar" with `events`; every other op is an empty success. */
async function withHub(events: unknown[], body: () => Promise<void>) {
  const secret = process.env.HUB_PARTNER_SECRET;
  process.env.HUB_PARTNER_SECRET = "replay-hub-secret-0123456789abcdef0123";
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const op = JSON.parse(init.body).op;
    return new Response(
      JSON.stringify(
        op === "calendar" ? { ok: true, events } : { ok: true, meetings: [] },
      ),
      { status: 200 },
    );
  });
  try {
    await body();
  } finally {
    vi.unstubAllGlobals();
    if (secret === undefined) delete process.env.HUB_PARTNER_SECRET;
    else process.env.HUB_PARTNER_SECRET = secret;
  }
}

function asAdmin(t: ReplayContext) {
  t.directory(STAFF);
  t.as("admin", KEARNEY);
}

export const NOV27_CALENDAR_ALL_MEETINGS_CASES: ReplayCase[] = [
  {
    id: "nov27-calendar-plot-all-meetings-recurring-dm-l10",
    title: `"can u ask it to plot the calendar pls for all meetings recurring DM L10 etc" — the Leadership, STC DM and Maintenance L10s all reach the model`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      asAdmin(t);
      vi.setSystemTime(new Date("2026-11-27T16:00:00Z"));
      await withHub(HUB_EVENTS, async () => {
        const model = loopStandIn((view: LoopView) =>
          lastResult(view, "read_calendar")
            ? { text: "Here are your L10s." }
            : {
                tool: "read_calendar",
                input: { from: "2026-11-30", to: "2026-12-06" },
              },
        );
        t.loopModel!(model);
        await t
          .thread()
          .say(
            "can u ask it to plot the calendar pls for all meetings recurring DM L10 etc",
          );
        const output = calendarOf(model);
        expect(output?.refused, JSON.stringify(output)).toBeUndefined();
        expect(output?.error, JSON.stringify(output)).toBeUndefined();
        const meetings = (output?.events ?? []).filter(
          (e) => e.what === "meeting",
        );
        expect(meetings.map((e) => [e.date, e.title]).sort()).toEqual([
          ["2026-11-30", "Leadership L10"],
          ["2026-11-30", "STC DM L10"],
          ["2026-12-02", "Maintenance L10"],
        ]);
      });
    },
  },
  {
    id: "nov27-calendar-syncs-when-new-forms-come",
    title: `"make sure calendar syncs when new forms come etc" — a form filed just now is on the calendar on its follow-up date at once`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      vi.setSystemTime(new Date("2026-11-27T15:00:00Z"));
      // File a coaching form through the chat, then finalize it with a follow-up date, as the form page does.
      t.loopModel!(
        loopStandIn((view: LoopView) =>
          lastResult(view, "propose_form")
            ? { text: "Here's the card." }
            : {
                tool: "propose_form",
                input: {
                  template_key: "coaching",
                  employee_id: STAFF[0]!.id,
                  what_happened: "Arrived late to open.",
                  incident_date: "2026-11-27",
                },
              },
        ),
      );
      const setup = t.thread();
      await setup.say(
        `coaching form for ${STAFF[0]!.firstName} ${STAFF[0]!.lastName}, late to open`,
      );
      const id = await setup.create();
      await saveInstanceValues(
        id,
        {
          values: {},
          checked: {
            coaching_type: ["underperformance"],
            coaching_topics: ["store_tours"],
          },
        },
        "replay-manager",
      );
      await finalizeInstance(id, "replay-manager", "2026-12-03", {
        acknowledgeUnverifiedPolicy: true,
      } as never);
      const row = (t.forms() as unknown as Record<string, unknown>[]).find(
        (r) => r.id === id,
      )!;
      expect(row.status).toBe("finalized");
      expect(row.follow_up_date).toBe("2026-12-03");

      // A minute later, with nothing re-run in between: the calendar already has it.
      vi.setSystemTime(new Date("2026-11-27T15:01:00Z"));
      await withHub([], async () => {
        const model = loopStandIn((view: LoopView) =>
          lastResult(view, "read_calendar")
            ? { text: "It's on Dec 3." }
            : {
                tool: "read_calendar",
                input: { from: "2026-11-30", to: "2026-12-06" },
              },
        );
        t.loopModel!(model);
        await t
          .thread()
          .say("make sure calendar syncs when new forms come etc");
        const output = calendarOf(model);
        expect(output?.error, JSON.stringify(output)).toBeUndefined();
        const followUps = (output?.events ?? []).filter(
          (e) => e.what === "form-follow-up",
        );
        expect(
          followUps.map((e) => e.date),
          JSON.stringify(output),
        ).toEqual(["2026-12-03"]);
        expect(followUps[0]!.title).toContain(STAFF[0]!.lastName);
      });
    },
  },
];
