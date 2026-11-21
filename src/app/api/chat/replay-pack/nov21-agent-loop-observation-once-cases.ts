import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE SAVED OBSERVATION STATES THE OFFENSE ONCE (port from the sibling app: its QA's live re-test of the loop, 21 Nov
 * 2026, A2–A5)
 * ============================================================================
 *
 * The sibling's QA (loop on): "Every saved CA (QA's A2–A5): the Observation field states the offense twice: once
 * reworded, then again in the manager's raw words, e.g. "<P> did not attend the monthly meeting on October 20, 2026. <P>
 * did not attend the monthly meeting on 10-20-26." A3 also tacked on "...by the 10-15-26 deadline. On 10-20-26."" The
 * keep-the-facts pass (`account-facts-kept.ts`) did not read the manager's dashed date as the drafter's written-out one,
 * so the card's sentence looked missing and was added again. The loop's card goes through the real Create; the stand-in
 * drafter writes the date out, as the live one did. Remy Calder is the pack's invented person.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Port from the sibling app (its QA's live re-test, 21 Nov 2026, A2–A5, loop on): \"the Observation field states the offense twice: once reworded, then again in the manager's raw words\"";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-21T18:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

/** A verbal Corrective Action card for Remy Calder with the manager's account as typed (dashed dates and all). */
function verbalCard(account: string) {
  return loopStandIn((view): LoopDecision => {
    if (!lastResult(view, "propose_form")) {
      return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "remy calder", person_evidence: evidenceFrom(view, "remy calder"), warning_level: "verbal", level_evidence: evidenceFrom(view, "verbal"), what_happened: account } };
    }
    return { text: "Here's the Corrective Action Form for **Remy**." };
  });
}

export async function savedObservation(t: ReplayContext, said: string, account: string, drafted: string): Promise<string> {
  t.loopModel!(verbalCard(account));
  const thread = t.thread();
  await thread.say(said);
  expect((thread.proposal as { fromAgentLoop?: boolean } | null)?.fromAgentLoop, "no loop card was made (the case proves nothing)").toBe(true);
  t.draftWrites({ observation: drafted });
  const id = await thread.create();
  return t.values(id).observation ?? "";
}

export const NOV21_AGENT_LOOP_OBSERVATION_ONCE_CASES: ReplayCase[] = [
  {
    id: "nov21-agent-loop-observation-offense-stated-once",
    title: "\"create verbal ca for remy calder for not attending the monthly meeting on 10-20-26\", then Create, and the drafter writes \"October 20, 2026\": the saved Observation says it once, never again \"on 10-20-26\"",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const observation = await savedObservation(
        t,
        "create verbal ca for remy calder for not attending the monthly meeting on 10-20-26",
        "Remy did not attend the monthly meeting on 10-20-26.",
        "Observed:\nRemy did not attend the monthly meeting on October 20, 2026.\n\nExpectation:\nRemy is expected to attend every monthly meeting.",
      );
      expect(observation, observation).toMatch(/^Observed:\s*Remy did not attend the monthly meeting on October 20, 2026\.\s*Expectation:/);
      expect(observation.match(/did not attend the monthly meeting/g) ?? [], `the offense is stated more than once:\n${observation}`).toHaveLength(1);
    },
  },
  {
    id: "nov21-agent-loop-observation-no-dangling-date-clause",
    title: "A3: the account holds two dashed dates (\"On 10-20-26, … by the 10-15-26 deadline.\"); the drafter writes both out; nothing is tacked on (no \"This was due by the 10-15-26 deadline. On 10-20-26.\")",
    report: `${REPORT}; A3 "also tacked on \"...by the 10-15-26 deadline. On 10-20-26.\""`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const drafted = "Observed:\nAs of October 20, 2026, Remy had still not completed the tanning safety training, which was due by the October 15, 2026 deadline.\n\nExpectation:\nRemy is expected to complete required training by its deadline.";
      const observation = await savedObservation(
        t,
        "create verbal ca for remy calder, on 10-20-26 she had still not completed the tanning safety training, which was due by the 10-15-26 deadline",
        "On 10-20-26, Remy had still not completed the tanning safety training, which was due by the 10-15-26 deadline.",
        drafted,
      );
      expect(observation, observation).not.toMatch(/\b10-20-26\b|\b10-15-26\b/);
      expect(observation, observation).toBe(drafted);
    },
  },
];
