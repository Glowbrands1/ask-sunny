import { expect, vi } from "vitest";

import { STAFF, type ReplayCase } from "./cases";

/**
 * QA, 10 Nov 2026 (the roster-name set's eval, case n3, a global salon director): "name is TT and use todays date to create
 * coaching form". With the set on, "TT" is on nobody's roster and the card is emptied, but the salon question asked over the
 * card before that still said "The card is ready — choose the salon …", above "Who is this form for?". A card with no
 * employee is never called ready. CARD_READY_NEEDS_EMPLOYEE_ENABLED (`forms/roster-only-names.ts`). With production's flags
 * (FORM_NAME_FROM_ROSTER off) the card keeps "Tt", so it holds there too.
 */
const SAID = "name is TT and use todays date to create coaching form";
const EVERY_SALON = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

export const NOV10_CARD_READY_NEEDS_EMPLOYEE_CASES: ReplayCase[] = [
  {
    id: "nov10-card-ready-needs-employee",
    title: "\"name is TT and use todays date to create coaching form\" (a global salon director): a card with no employee is never \"ready\"",
    report: "QA, 10 Nov 2026: the roster-name set's eval n3 said \"The card is ready\" over a card with no employee",
    status: "fixed",
    fixFlags: ["FORM_NAME_FROM_ROSTER_ENABLED", "ROSTER_NEAR_MISS_ENABLED", "CARD_READY_NEEDS_EMPLOYEE_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-10-23T15:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", EVERY_SALON);
      const thread = t.thread();
      const { content } = await thread.say(SAID);
      if (!thread.proposal?.employeeName) {
        expect(content, `a card with no employee is called ready:\n${content}`).not.toMatch(/the card is ready/i);
        expect(content, `a card with no employee "has the employee":\n${content}`).not.toMatch(/I have the employee/);
      }
    },
  },
];
