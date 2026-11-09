import { expect, vi } from "vitest";

import { STAFF, type ReplayCase } from "./cases";
import { TURNS } from "./nov9-letter-title-date-cases";

/**
 * ============================================================================
 * A TERMINATION LETTER'S EXIT FORM IS DATED THE DAY THE TERMINATION TOOK EFFECT (QA, the live round 11, 9 Nov 2026;
 * EXIT_FORM_DATE_FROM_TERMINATION_ENABLED)
 * ============================================================================
 *
 * The Marcus/Dolores letter (people invented): "… your employment … is terminated, effective 11/08/2026, due to
 * repeated no-call no-shows on 11/3, 11/5 and 11/7", then "I need an exit form with this information. " and the same
 * letter. Round 11's card had the Date November 7, 2026 (the last no-show) beside the Resignation Date November 8,
 * 2026; round 10 had November 8. The slot model's reading of the last no-show as the incident's date is scripted, as
 * round 11 read it.
 */
export const NOV9_EXIT_FORM_DATE_TERMINATION_CASES: ReplayCase[] = [
  {
    id: "nov9-exit-form-date-termination",
    title: "the letter, then \"I need an exit form with this information.\" + the letter: the form's Date and Resignation Date are both November 8, 2026",
    report: "QA, the live round 11 (9 Nov 2026): a termination letter \"terminated, effective 11/08/2026\" gave the exit form the Date November 7 (the last no-show)",
    // Changed on purpose (9 Nov 2026): fixed in production by EXIT_FORM_DATE_FROM_TERMINATION_ENABLED, QA round 13, 9 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: ["EXIT_FORM_DATE_FROM_TERMINATION_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-08T18:00:00Z"));
      t.directory(STAFF);
      t.as("district_manager", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
      t.slotsRead({ employee: "Marcus Tellefsen", formType: "Resignation/Exit Form", formTurn: true, incidentDate: "2026-11-07" });
      const thread = t.thread();
      await thread.say(TURNS[0]);
      const { content } = await thread.say(TURNS[1]);
      expect(thread.proposal?.formDate ?? null, `the card's Date is not the termination's:\n${content}`).toBe("2026-11-08");
      expect(content, `the reply's Date line is not the termination's:\n${content}`).toMatch(/^- \*\*Date:\*\* November 8, 2026$/m);
      expect(content, `the Resignation Date is not the termination's:\n${content}`).toMatch(/\*\*Resignation Date:\*\*\s*November 8, 2026/);
    },
  },
];
