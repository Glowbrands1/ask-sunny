import { expect, vi } from "vitest";

import { STAFF, KEARNEY, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * STALE PROMPT LINES (QA, 5 Nov 2026, item 8): A SALES CA TICKS THE STANDARDS
 * OF CONDUCT, NOT OTHER WITH A WRITE-IN
 * ============================================================================
 *
 * The draft prompt told the model to tick "other" AND name the topic in a
 * write-in field the current form does not have, and that under_performance
 * (a box the current form does not have) is for sales results. A live-style
 * draft that followed those lines ticked Other for a sales shortfall. With
 * CA_SALES_POLICY_ENABLED and STALE_PROMPT_LINES_OFF_ENABLED on, a sales
 * Corrective Action's Type of Offense is the Standards of Conduct. The prompt
 * itself is tested in src/app/api/forms/corrective-action-dm-feedback-e2e.test.ts
 * (the pack's template reaches none of the Type of Offense lines). The person
 * is invented.
 */

type T = ReplayContext;

const MARISOL: DirectoryRow = {
  id: "e-marisol-quenby",
  firstName: "Marisol",
  lastName: "Quenby",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function stalePromptLinesPeople(): readonly DirectoryRow[] {
  return [MARISOL];
}

const REPORT = "QA, 5 Nov 2026 (item 8, stale prompt lines): a sales Corrective Action's Type of Offense";
const FLAGS = ["CA_SALES_POLICY_ENABLED", "FORM_NAME_FROM_ROSTER_ENABLED", "STALE_PROMPT_LINES_OFF_ENABLED"];

async function salesCa(t: T, checked: Record<string, string[]>, values: Record<string, string> = {}) {
  vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
  t.directory([...STAFF, MARISOL]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  const reply = await thread.say("I need a verbal corrective action for Marisol Quenby. Not meeting sales requirements for the month of October");
  expect(thread.proposal, `no Corrective Action card for Marisol Quenby:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Marisol Quenby" });
  t.draftWrites({ observation: "Observed:\nMarisol Quenby did not meet her sales requirements for October.", ...values }, checked);
  const id = await thread.create();
  return t.checked(id).offense_type ?? [];
}

export const NOV5_STALE_PROMPT_LINES_CASES: ReplayCase[] = [
  {
    id: "nov5-stale-prompt-lines-sales-ticks-conduct",
    title: "a sales CA the model ticks Standards of Conduct for is saved as Standards of Conduct",
    report: REPORT,
    // A guard: it holds with production's flags too (the card is made for this wording either way).
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      expect(await salesCa(t, { offense_type: ["standards_of_conduct"] }), "Type of Offense").toEqual(["standards_of_conduct"]);
    },
  },
  {
    id: "nov5-stale-prompt-lines-sales-other-write-in",
    title: "live-style: the model followed the stale lines (ticked other, named \"Sales\" in a write-in): the sales CA is saved as Standards of Conduct",
    report: REPORT,
    /*
     * OPEN in both modes (QA's call pending, 5 Nov 2026): nothing moves an Other tick to the Standards of
     * Conduct for a sales account (ca-conduct-reason.ts only moves the Standards of Conduct to Other). The
     * prompt flag makes this tick less likely; the stubbed model cannot show that.
     */
    // Changed on purpose (8 Nov 2026): fixed in production by the sales triple (SALES_SHORTFALL_OBJECT_ENABLED, SALES_OBSERVATION_ACCOUNT_ENABLED, CA_PERFORMANCE_REASON_ENABLED), QA round 5, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      expect(await salesCa(t, { offense_type: ["other"] }, { other_offense: "Sales" }), "Type of Offense").toEqual(["standards_of_conduct"]);
    },
  },
  {
    id: "nov5-stale-prompt-lines-sales-under-performance",
    title: "live-style: the model ticked the removed under_performance box: the sales CA is saved as Standards of Conduct",
    report: REPORT,
    // A guard: revision 7 maps the removed under_performance box to the Standards of Conduct, flag or not.
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      expect(await salesCa(t, { offense_type: ["under_performance"] }), "Type of Offense").toEqual(["standards_of_conduct"]);
    },
  },
];
