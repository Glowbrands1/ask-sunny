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
  status: { open: "with production's flags (FORM_NAME off) the card keeps the typed name" },
  fixFlags: FIX,
  async run(t) {
    t.directory([...STAFF]);
    t.as("salon_director", KEARNEY);
    const thread = t.thread();
    const reply: ReplayAnswer = await thread.say(message);
    expect(thread.proposal?.employeeName ?? null, `a name on no roster is the employee:\n${reply.content}`).toBeNull();
    expect(reply.content, `the typed name is never said to be not found:\n${reply.content}`).toMatch(/I couldn't find \*\*Zebulon Marchbanks\*\* in the Woven roster/);
    const elsewhere = reply.content.split("\n").filter((line) => !/I couldn't find \*\*/.test(line)).join("\n");
    expect(elsewhere, `the name is presented as the employee:\n${reply.content}`).not.toMatch(/Zebulon|Marchbanks/);
  },
});

export const NOV5_NOT_FOUND_ANY_PHRASING_CASES: ReplayCase[] = [
  notFound("nov5-not-found-employee-first", "i have an employee, Zebulon Marchbanks that needs a corrective action form with a customer complaint", "the employee first"),
  notFound("nov5-not-found-name-at-end", "create a ca form for Zebulon Marchbanks", "the name at the end"),
];
