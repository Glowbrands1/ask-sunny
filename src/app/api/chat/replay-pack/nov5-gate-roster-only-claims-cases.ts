import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayAnswer, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * THE SALES-FLIP GATE'S REGRESSIONS (ask-sunny#530, run on 86e3aec2, 5 Nov 2026)
 * ============================================================================
 *
 * With FORM_NAME_FROM_ROSTER_ENABLED on, `forms/roster-only-names.ts` takes an
 * off-roster employee off the card after the reply is built. The gate found
 * two rows where the rest of the reply still spoke for the removed person:
 *
 *   nov3-street-then-placeholder, turn 2: it asked who, but the coaching
 *     preview still said "Everything I need is here … I have the employee and
 *     the salon".
 *   nov5-roster-only-ima-off-roster: it asked who, but the Observation read
 *     "ima employee, opening salon late on 9-28-26".
 *
 * Neither happens with production's flags today (FORM_NAME off), so each
 * case's fixFlags are the flip's flags: they fail on those before the fix and
 * pass after. The street case holds in production ("fixed"); the ima case is
 * OPEN there, as nov5-roster-only-ima-off-roster is (the card is for "ima"). The manager's words are the
 * cases' own; "ima employee" is invented and on no roster.
 */

const FLAG = "FORM_NAME_FROM_ROSTER_ENABLED";
const SALES = "CA_SALES_POLICY_ENABLED";
const GLOSSARY = "CHAT_GLOSSARY_ENABLED";

const ASKS_WHO = /Who is this (?:\*\*[^*]+\*\* |form )?for\?/i;
const CLAIMS_READY = /Everything I need is here|I have the employee/i;

/** The card's Observation of Offense line, or "". */
function observationLine(reply: ReplayAnswer): string {
  return reply.content.split("\n").find((line) => /\*\*Observation of Offense:?\*\*/i.test(line)) ?? "";
}

export const NOV5_GATE_ROSTER_ONLY_CLAIMS_CASES: ReplayCase[] = [
  {
    id: "nov5-gate-street-placeholder-no-ready-claim",
    title: "gate regression 1: \"make a coaching form for <name>, she was late today\" asks who and never says \"I have the employee\"; \"<name>\" never opens the Observation",
    report: "ask-sunny#530 (the sales-flip gate, 5 Nov 2026): nov3-street-then-placeholder turn 2, on — asks who, but the preview says \"Everything I need is here … I have the employee and the salon\"",
    status: "fixed",
    fixFlags: [FLAG, SALES, GLOSSARY],
    async run(t) {
      vi.setSystemTime(new Date("2026-10-26T15:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("coaching form for 123 Main Street");
      const reply = await thread.say("make a coaching form for <name>, she was late today");
      expect(reply.formProposal?.employeeName ?? null, "a non-person is the employee").toBeNull();
      expect(reply.content, `does not ask who:\n${reply.content}`).toMatch(ASKS_WHO);
      expect(reply.content, `says it has the employee while asking who:\n${reply.content}`).not.toMatch(CLAIMS_READY);
      expect(observationLine(reply), "the placeholder opens the Observation").not.toMatch(/<name>/i);
    },
  },
  {
    id: "nov5-gate-ima-off-roster-observation",
    title: "gate regression 2: \"create a CA form for ima employee, for opening salon late on 9-28-26\" asks who; the Observation is \"opening salon late on 9-28-26\", never \"ima employee, …\"",
    report: "ask-sunny#530 (the sales-flip gate, 5 Nov 2026): nov5-roster-only-ima-off-roster, on — asks who, but the Observation becomes \"ima employee, opening salon late on 9-28-26\"",
    // As nov5-roster-only-ima-off-roster: with production's flags (FORM_NAME off) the card is for "ima", a name on no roster.
    status: { open: "the card is for \"ima\", a name on no roster (FORM_NAME_FROM_ROSTER_ENABLED off)" },
    fixFlags: [FLAG, SALES, GLOSSARY],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-05T15:30:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("create a CA form for ima employee, for opening salon late on 9-28-26");
      expect(thread.proposal?.employeeName ?? null, "a name on no roster is the employee").toBeNull();
      expect(reply.content, `does not ask who:\n${reply.content}`).toMatch(ASKS_WHO);
      expect(observationLine(reply), "the removed name is in the Observation").not.toMatch(/\bima\b/i);
      expect(observationLine(reply), "the account is lost").toMatch(/opening salon late on 9-28-26/);
    },
  },
];
