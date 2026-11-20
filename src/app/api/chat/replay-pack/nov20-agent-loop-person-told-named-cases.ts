import { expect, vi } from "vitest";

import { TESTY } from "@/lib/ai/agent-loop/phrasing-table";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";
import { lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE PERSON TOLD BY SOMEONE ELSE IS NAMED, NEVER A PRONOUN (QA, 20 Nov 2026, board row f059; Pau's rule)
 * ============================================================================
 *
 * The live test of #1117 (conv_mwoz3z9a2i44yx4): the manager typed "Test Testy's shift lead, <L>, told her to clock out
 * early and she refused"; the saved Observation used "Test", but the reply's account line read "<L>, the shift lead, told
 * her to clock out early and she refused." The pronoun guard read "her" as part of what <L> said (a non-leader's reported
 * clause). General rule: the pronoun right after "told / asked / reminded …" (before "to / not / that …") is the listener;
 * when someone other than the card's person is telling, the listener is the card's person, named, and so is the same
 * pronoun opening a joined clause ("and she refused"). The manager's wording is kept; <L> is invented (Corin Ashby).
 * Test Testy is the app's test employee.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA board row f059 (20 Nov 2026, live test of #1117): the reply's Observation line kept \"told her … she refused\" for the card's person";
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const SAID = "Test Testy's shift lead, Corin Ashby, told her to clock out early and she refused";
const TEST_TESTY: DirectoryRow = { id: TESTY.id, firstName: TESTY.firstName, lastName: TESTY.lastName, preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

export const NOV20_AGENT_LOOP_PERSON_TOLD_NAMED_CASES: ReplayCase[] = [
  {
    id: "nov20-person-told-named-f059",
    title: "f059: \"Test Testy's shift lead, Corin Ashby, told her to clock out early and she refused\": the reply's Observation line names Test (\"told Test to clock out early and Test refused\"), never her/she",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      vi.setSystemTime(new Date("2026-11-20T15:00:00Z"));
      t.directory([...STAFF, TEST_TESTY]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
        ? { text: "Here's the Corrective Action Form for **Test**.\n\n**Observation of Offense:** Corin Ashby, the shift lead, told her to clock out early and she refused." }
        : { tool: "propose_form", input: { template_key: "dpoa", employee_id: TESTY.id, what_happened: "Corin Ashby, the shift lead, told Test to clock out early and Test refused.", incident_date: "2026-11-20" } })));
      const reply = await t.thread().say(SAID);
      expect(reply.content, `the reply kept a pronoun for the card's person:\n${reply.content}`).toContain("told Test to clock out early and Test refused");
      expect(reply.content).not.toMatch(/\btold her\b|\bshe refused\b/);
    },
  },
];
