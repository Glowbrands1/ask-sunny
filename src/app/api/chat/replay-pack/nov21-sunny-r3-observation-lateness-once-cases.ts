import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * EACH LATENESS IS STATED ONCE IN THE SAVED OBSERVED (QA2's Sunny live R3, 21 Nov 2026)
 * ============================================================================
 *
 * The saved Observed stated the lateness three times for two dates: "<First> was late to work on November 17, 2026.
 * <First> was late to work on November 18, 2026. <First> was late on the last two shifts, 11/17 and 11/18." The drafter
 * wrote one sentence per date; the keep-the-facts pass (`account-facts-kept.ts`) read the card's date-list sentence as
 * missing ("last", "shifts" are in neither) and added it. Invented person: Tavish Orcutt (on no fixture).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA2's Sunny live R3 (21 Nov 2026): the saved Observed stated the lateness three times for two dates";
const TAVISH: DirectoryRow = { id: "e-tavish-orcutt", firstName: "Tavish", lastName: "Orcutt", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const SAID = "ca for Tavish Orcutt, he was late on the last two shifts, 11/17 and 11/18";
const ACCOUNT = "Tavish was late on the last two shifts, 11/17 and 11/18.";
const DRAFTED = "Observed:\nTavish was late to work on November 17, 2026. Tavish was late to work on November 18, 2026.\n\nExpectation:\nTavish is expected to arrive on time for every scheduled shift.";

export const NOV21_SUNNY_R3_OBSERVATION_LATENESS_ONCE_CASES: ReplayCase[] = [
  {
    id: "nov21-sunny-r3-observation-lateness-stated-once",
    title: `QA2's Sunny R3: "${SAID}", Create, and the drafter writes one sentence per date: the saved Observed states each lateness once, never again "late on the last two shifts, 11/17 and 11/18"`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-21T18:40:00Z"));
      t.directory([...STAFF, TAVISH]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => lastResult(view, "propose_form")
        ? { text: "Here's the Corrective Action Form for **Tavish**." }
        : { tool: "propose_form", input: { template_key: "dpoa", employee_id: TAVISH.id, person_evidence: evidenceFrom(view, "Tavish Orcutt"), what_happened: ACCOUNT, incident_date: "2026-11-18" } }));
      const thread = t.thread();
      await thread.say(SAID);
      expect((thread.proposal as { fromAgentLoop?: boolean } | null)?.fromAgentLoop, "no loop card was made (the case proves nothing)").toBe(true);
      t.draftWrites({ observation: DRAFTED });
      const id = await thread.create();
      const observed = (t.values(id).observation ?? "").split(/\n\s*Expectation:/)[0]!;
      expect(observed.match(/\blate\b/g) ?? [], `the lateness is stated more than once per date:\n${observed}`).toHaveLength(2);
      expect(observed, observed).not.toMatch(/last two shifts/);
      for (const date of ["November 17, 2026", "November 18, 2026"]) expect(observed.split(date).length - 1, `${date} is not stated exactly once:\n${observed}`).toBe(1);
    },
  },
];
