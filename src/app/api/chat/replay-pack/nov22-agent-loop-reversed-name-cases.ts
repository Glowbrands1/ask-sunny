import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A NAME TYPED SURNAME FIRST IS THE ROSTER'S PERSON (the 266-chat run's 117, QA's step 3 item 16, 22 Nov 2026)
 * ============================================================================
 *
 * The manager's turns, word for word (the person invented, the pack's roster): "put together a coaching document for
 * <First>", then the pasted write-up "Observation of Concern / Following a review of employee hours worked and tanning
 * history, it was confirmed that <Last> <First>'s utilized tanning equipment while clocked in for scheduled shifts. …".
 * The name came surname first, with a possessive, and was never read as the roster's person.
 *
 * Mechanism (`matchEmployeeName`, `employee-match.ts`): when the typed order matches nobody, the roster's own
 * "<last> <first>" order is read, for one person only (roster data, no word list). With #1246's possessive read, "<Last>
 * <First>'s" is that person. find_staff's order-free match already found a reversed name alone; the possessive read and
 * the older chat path use matchEmployeeName, which did not.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "The 266-chat run (case 117), re-checked on main 7787aa9: \"… it was confirmed that <Last> <First>'s utilized tanning equipment while clocked in …\" was never read as the roster's <First> <Last>";
const T1 = "put together a coaching document for Remy";
const T2 = "Observation of Concern\nFollowing a review of employee hours worked and tanning history, it was confirmed that Calder Remy's utilized tanning equipment while clocked in for scheduled shifts.";

export const NOV22_AGENT_LOOP_REVERSED_NAME_CASES: ReplayCase[] = [
  {
    id: "nov22-f038-117-reversed-possessive-name",
    title: "117: \"… it was confirmed that <Last> <First>'s utilized tanning equipment …\": the coaching card is the roster's Remy Calder",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("district_manager", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) return { text: "Here's the Coaching Form." };
        if (!view.turns.some((turn) => turn.role === "user" && turn.text.includes("Calder Remy's"))) return { text: "What happened?" };
        // The live model: the name as the write-up gives it.
        return { tool: "propose_form", input: { template_key: "coaching", employee_name: "Calder Remy's", person_evidence: evidenceFrom(view, "Calder Remy's"), what_happened: "Remy utilized tanning equipment while clocked in for scheduled shifts.", policy: "Other — Employee Tanning Privileges" } };
      }));
      const thread = t.thread();
      await thread.say(T1);
      const reply = await thread.say(T2);
      const card = thread.proposal as { employeeName?: string; employeeRole?: string | null } | undefined;
      expect(card?.employeeName, `the reversed name is not the roster's person:\n${reply.content}`).toBe("Remy Calder");
      // employeeRole comes from the roster row only: an off-roster name has none.
      expect(card?.employeeRole ?? null).toBe("Tanning Consultant");
    },
  },
];
