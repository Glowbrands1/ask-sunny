import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayAnswer, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A NAME ON NO ROSTER, IN ANY PHRASING, IS SAID NOT FOUND (QA-A/QA-B, 5 Nov 2026)
 * ============================================================================
 *
 * Ported from the sibling app (Glowbrands1/Ask-bubbles#474). The re-flip's live
 * testers (QA-A/QA-B, flags on): a full name on no roster gave no "I couldn't
 * find **<name>** in the Woven roster" note. The note read the name only from
 * "for <Name>," or "for <Name>."; these requests said "i have an employee,
 * <name> that needs …" or ended with the name. ROSTER_NOT_FOUND_ANY_PHRASING_ENABLED
 * also reads "employee, <Name>" and "for <Name>" at the end of the message
 * (Title Case names only). The person is invented, checked against both
 * directories.
 */

const FIX = ["FORM_NAME_FROM_ROSTER_ENABLED", "ROSTER_NEAR_MISS_ENABLED", "ROSTER_NOT_FOUND_ANY_PHRASING_ENABLED"];

const notFound = (id: string, message: string, what: string): ReplayCase => ({
  id,
  title: `QA-A/QA-B shape (${what}): "${message}", on no roster: "I couldn't find **Zebulon Marchbanks** in the Woven roster", then asks who; never the employee`,
  report: "The re-flip's live testers, 5 Nov 2026 (QA-A/QA-B, flags on): an off-roster full name, no not-found note",
  // Changed on purpose (10 Nov 2026, QA's roster-set gate): OFF_ROSTER_ASK_BEFORE_CARD (on in production since 9 Nov) already
  // asks a salon manager "I can't find **<name>** on your roster — …" with the card held, which this case now accepts as
  // the not-found line; it holds with production's flags.
  status: "fixed",
  fixFlags: FIX,
  async run(t) {
    t.directory([...STAFF]);
    t.as("salon_director", KEARNEY);
    const thread = t.thread();
    const reply: ReplayAnswer = await thread.say(message);
    expect(thread.proposal?.employeeName ?? null, `a name on no roster is the employee:\n${reply.content}`).toBeNull();
    // Changed on purpose (10 Nov 2026, QA's roster-set ruling): with the name set on, a salon manager's not-found line is OFF_ROSTER_ASK's "I can't find **<name>** on your roster — …" (round 12's live wording), not "I couldn't find **<name>** in the Woven roster".
    expect(reply.content, `the typed name is never said to be not found:\n${reply.content}`).toMatch(/I couldn't find \*\*Zebulon Marchbanks\*\* in the Woven roster|I can't find \*\*Zebulon Marchbanks\*\* on your roster/);
    const elsewhere = reply.content.split("\n").filter((line) => !/I couldn't find \*\*|I can't find \*\*[^*]+\*\* on your roster/.test(line)).join("\n");
    expect(elsewhere, `the name is presented as the employee:\n${reply.content}`).not.toMatch(/Zebulon|Marchbanks/);
  },
});

export const NOV5_NOT_FOUND_ANY_PHRASING_CASES: ReplayCase[] = [
  notFound("nov5-not-found-employee-first", "i have an employee, Zebulon Marchbanks that needs a corrective action form with a customer complaint", "the employee first"),
  notFound("nov5-not-found-name-at-end", "create a ca form for Zebulon Marchbanks", "the name at the end"),
];
