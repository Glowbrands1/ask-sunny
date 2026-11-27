import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * US HOLIDAYS ON THE CALENDAR, AND THE AI READS THEM (the owner, 27 Nov 2026)
 * ============================================================================
 *
 * The owner: "can you also add holidays in the calendar in all apps pls US holiday". Worked out in code
 * (src/config/holidays.ts); read_calendar gives them to the model with the right dates, and tells it a holiday says
 * nothing about whether a salon is open. Through the real chat route, Hub off:
 *   "what holidays are in December?" — Christmas Eve, Christmas Day and New Year's Eve 2026.
 *   "is the salon open on Thanksgiving?" — Thanksgiving is Nov 26, 2026; the model is told not to state hours.
 */
const REPORT = 'The owner, 27 Nov 2026: "can you also add holidays in the calendar in all apps pls US holiday"';
const FLAG = "AGENT_LOOP_ENABLED";

type CalendarOutput = { events?: { date: string; what: string; title: string }[]; note?: string; error?: string };

async function ask(t: ReplayContext, words: string, from: string, to: string): Promise<CalendarOutput> {
  const secret = process.env.HUB_PARTNER_SECRET;
  delete process.env.HUB_PARTNER_SECRET;
  try {
    const model = loopStandIn((view: LoopView) => (lastResult(view, "read_calendar") ? { text: "Here they are." } : { tool: "read_calendar", input: { from, to } }));
    t.loopModel!(model);
    await t.thread().say(words);
    const output = model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_calendar")).at(-1)?.output as CalendarOutput | undefined;
    expect(output?.error, JSON.stringify(output)).toBeUndefined();
    return output!;
  } finally {
    if (secret !== undefined) process.env.HUB_PARTNER_SECRET = secret;
  }
}

export const NOV27_CALENDAR_HOLIDAYS_CASES: ReplayCase[] = [
  {
    id: "nov27-calendar-holidays-in-december-and-thanksgiving",
    title: `"what holidays are in December?" and "is the salon open on Thanksgiving?" — read_calendar gives the US holidays with the right dates, and never opening hours`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      vi.setSystemTime(new Date("2026-11-20T15:00:00Z"));

      const december = await ask(t, "what holidays are in December?", "2026-12-01", "2026-12-31");
      expect((december.events ?? []).filter((e) => e.what === "holiday").map((e) => [e.date, e.title])).toEqual([
        ["2026-12-24", "Christmas Eve (observance)"],
        ["2026-12-25", "Christmas Day"],
        ["2026-12-31", "New Year's Eve (observance)"],
      ]);

      const thanksgiving = await ask(t, "is the salon open on Thanksgiving?", "2026-11-22", "2026-11-28");
      expect((thanksgiving.events ?? []).filter((e) => e.what === "holiday").map((e) => [e.date, e.title])).toEqual([
        ["2026-11-26", "Thanksgiving"],
        ["2026-11-27", "Black Friday (observance)"],
      ]);
      expect(thanksgiving.note).toMatch(/never state opening hours/);
    },
  },
];
