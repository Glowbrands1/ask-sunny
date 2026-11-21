import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE SAVED COACHING FORM SAYS WHAT THE CARD SHOWED (QA's live L4/L5 on prod 14fed8c, 22 Nov 2026)
 * ============================================================================
 *
 * After #1198 the reply and the card read "…to show the team the new puppy", but Create saved coaching_details "…to show
 * the team a new puppy" (L4); and "The shift lead <S1> told Test to go home and Test refused." on the card saved as
 * "Shift lead <S1> told Test to go home, and Test refused." (L5). The saved form must be the card's own text. The
 * tester's "Test Testy" is STAFF's invented Remy Calder; <S1> is the invented Corin Vale.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live L4/L5 on prod 14fed8c (22 Nov 2026): the saved coaching_details differ from the card";

/** `drafted`: the Observed sentence production's drafting model wrote at Create (QA's live saved text). */
async function createdCoaching(t: ReplayContext, said: string, account: string, topic: string, drafted: string) {
  vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(loopStandIn((view): LoopDecision => lastResult(view, "propose_form")
    ? { text: `Here's the Coaching Form for **Remy**. What happened: ${account}` }
    : {
        tool: "propose_form",
        input: { template_key: "coaching", employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "Remy Calder"), what_happened: account, topic, topic_evidence: evidenceFrom(view, topic), incident_date: "2026-11-22" },
      }));
  t.draftWrites({ coaching_details: `Observed:\n${drafted}\n\nExpectation:\nRemy follows the policy going forward.` });
  const thread = t.thread();
  const reply = await thread.say(said);
  const issue = String((thread.proposal as { issue?: string } | undefined)?.issue ?? "");
  const id = await thread.create();
  return { reply, issue, values: t.values(id) };
}

const fixed = (id: string, title: string, body: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.()) return;
    await body(t);
  },
});

export const NOV22_AGENT_LOOP_SAVED_EQUALS_CARD_CASES: ReplayCase[] = [
  fixed("nov22-l4-saved-coaching-equals-card-puppy", "L4: \"coaching for Remy Calder, she came into the salon to show her team her new puppy\": the saved coaching_details say what the card's issue says", async (t) => {
    const { issue, values } = await createdCoaching(t, "coaching for Remy Calder, she came into the salon to show her team her new puppy", "Remy came into the salon to show her team her new puppy.", "new puppy", "Remy came into the salon to show the team a new puppy.");
    expect(issue, "the card has no issue (the case proves nothing)").toMatch(/to show the team the new puppy/);
    expect(values.coaching_details ?? "", JSON.stringify(values)).toContain(issue.replace(/\.$/, ""));
    expect(values.coaching_details ?? "", "the drafted Expectation is kept").toMatch(/Expectation:\nRemy follows the policy going forward\./);
  }),
  fixed("nov22-l5-saved-coaching-equals-card-shift-lead", "L5: \"coaching for Remy Calder. Her shift lead Corin Vale told her to go home and she refused\": the saved coaching_details say what the card's issue says", async (t) => {
    const { issue, values } = await createdCoaching(t, "coaching for Remy Calder. Her shift lead Corin Vale told her to go home and she refused", "Her shift lead Corin Vale told her to go home and she refused.", "go home", "Shift lead Corin Vale told Remy to go home, and Remy refused.");
    expect(issue, "the card has no issue (the case proves nothing)").toMatch(/go home/);
    expect(values.coaching_details ?? "", JSON.stringify(values)).toContain(issue.replace(/\.$/, ""));
    expect(values.coaching_details ?? "", "the drafted Expectation is kept").toMatch(/Expectation:\nRemy follows the policy going forward\./);
  }),
];
