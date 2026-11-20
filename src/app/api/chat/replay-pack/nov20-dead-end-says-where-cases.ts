import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * WHEN SUNNY CAN'T DO IT, IT SAYS WHERE IN THE APP TO GO (QA item 25, the production audit, 20 Nov 2026)
 * ============================================================================
 *
 * An Assistant Salon Director (view_daily_stats, no view_reports) asked "Show me the most recent Daily Stats…" and got
 * "I don't have access to view reports with this account": the prompt told the model only that the account cannot open
 * Reports & Analytics. A Regional Manager (no view_l10_meetings) wrote "i need to add something to the DML10" and got
 * "'DML10' isn't one of the HR forms I can prepare". With DEAD_END_SAYS_WHERE_ENABLED the prompt routes by the person's
 * real permissions: Daily Stats on the Home page's Performance section; the L10 page under Resources for an account that
 * may open it, else ask their District Manager or an admin. Prompt only; the L10 page is untouched.
 */

const FIX = ["DEAD_END_SAYS_WHERE_ENABLED"];
const REPORT = "QA item 25 (production audit, 20 Nov 2026): Daily Stats got \"no access\" and the DM L10 got \"not a form I can prepare\"";
const REGION = { level: "region", primaryAreaId: "region-ne", alsoCoversAreaIds: [] };

const systemOf = async (t: ReplayContext, role: string, scope: unknown, said: string) => {
  vi.setSystemTime(new Date("2026-11-20T15:00:00Z"));
  t.directory([...STAFF]);
  t.as(role as never, scope as never);
  await t.thread().say(said);
  return t.answerSystems().at(-1) ?? "";
};

export const NOV20_DEAD_END_SAYS_WHERE_CASES: ReplayCase[] = [
  {
    id: "nov20-dead-end-daily-stats-asd-sent-home",
    title: "Item 25: an Assistant Salon Director's \"Show me the most recent Daily Stats and what I need to focus on today.\": the prompt sends them to the Home page's Performance section and never says they have no access",
    report: REPORT,
    status: { open: "DEAD_END_SAYS_WHERE_ENABLED is off in production" },
    fixFlags: FIX,
    async run(t) {
      const system = await systemOf(t, "assistant_salon_director", KEARNEY, "Show me the most recent Daily Stats and what I need to focus on today.");
      expect(system, "the prompt does not say where Daily Stats are").toMatch(/Performance section at the top of the Home page/);
      expect(system).toMatch(/never say they have no access/);
    },
  },
  {
    id: "nov20-dead-end-dml10-regional-manager-ask-dm",
    title: "Item 25: a Regional Manager's \"i need to add something to the DML10\" (no view_l10_meetings): the prompt says the DM L10 is on the L10 page and to ask their District Manager or an admin, never a form",
    report: REPORT,
    status: { open: "DEAD_END_SAYS_WHERE_ENABLED is off in production" },
    fixFlags: FIX,
    async run(t) {
      const system = await systemOf(t, "regional_manager", REGION, "i need to add something to the DML10");
      expect(system).toMatch(/DM L10 \(the L10 meeting\) is kept on the L10 page, which this account cannot open/);
      expect(system).toMatch(/ask their District Manager or an admin/);
      expect(system).not.toMatch(/Resources, then L10/);
    },
  },
  {
    id: "nov20-dead-end-dml10-admin-sent-to-l10-page",
    title: "Item 25: an admin (view_l10_meetings) asking the same is sent to the L10 page: Resources, then L10",
    report: REPORT,
    status: { open: "DEAD_END_SAYS_WHERE_ENABLED is off in production" },
    fixFlags: FIX,
    async run(t) {
      const system = await systemOf(t, "admin", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] }, "i need to add something to the DML10");
      expect(system).toMatch(/kept on the L10 page: Resources, then L10/);
    },
  },
];
