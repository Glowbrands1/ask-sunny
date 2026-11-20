import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A LONG ACCOUNT KEEPS EVERY FACT, AND THE PRIOR-ACTIONS COUNT SURVIVES CREATE (QA's live test of #1121, 20 Nov 2026; f061)
 * ============================================================================
 *
 * Tester-Sunny 2's chat conv_mwozbi5v2a7kvm0 (saved CA de9e77d5), on the real Create path (createInlineForm → POST
 * /api/forms/instances → POST …/draft; the drafting model is a stand-in that writes what the live one kept). The chat had
 * one manager turn, the 351-word account below, word for word; the tester's invented "Test Testy" is STAFF's invented Remy
 * Calder here. The card (the model's what_happened, verbatim) showed "Prior actions: Verbal (2), dates not given". Saved:
 *   - the Observation dropped "this is the third time in two months" and "a customer said she would not come back";
 *   - prior_actions read "Verbal coaching — date not given": one of the two verbal talks lost.
 * Rule: every fact the manager gave stays, and the card's prior-actions count survives Create.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live test of #1121 (20 Nov 2026, f061): a long account lost facts and a prior-actions count at Create";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

/** The manager's one turn, word for word (351 words; the person invented). */
const SAID = "CA for Remy Calder, late opening incident on 11/12. Remy Calder was scheduled to open the salon at 9:00 AM that Thursday. The first customers were waiting outside the front door by 8:55, which is normal for our Thursday memberships rush, and they were still waiting at 9:20 because the doors were not unlocked and the lights were off. I got a call from a customer at 9:05 asking if we were closed for the day. I tried calling Remy Calder twice and texted once, and there was no answer until 9:25, when Remy Calder replied that the alarm code had been entered wrong and the system had locked itself for fifteen minutes, then that the bus was late, and then that the key to the back door was in the other jacket. The explanations changed three times during the call. Remy Calder finally arrived at 9:38, thirty-eight minutes after the scheduled opening time. During those thirty-eight minutes we lost at least six scheduled sessions, two customers asked for refunds on their memberships, and one customer said she would not come back because this was the second time she had been left waiting outside. This is the third time in two months that Remy Calder has opened late, and the two earlier times were both discussed verbally with no paperwork. The opening checklist was not finished until 10:15, so the first sessions of the day were also delayed by twenty minutes. The bed cleaning log for the morning shows no entries for the first two rooms, so the rooms were used without the required wipe down. I explained again that opening the salon on time is a core part of the job, that customers are billed for time they never receive when the doors are late, and that the cleaning log must be completed before the first session of the day. Remy Calder said it would not happen again and that the pressure of the morning schedule is hard to manage alone. I want this documented as a written corrective action and the opening procedures reviewed with Remy Calder this week.";
/** The card's account, as the live model wrote it (verbatim; the person invented). */
const ACCOUNT = "On 11/12, Remy Calder was scheduled to open the salon at 9:00 AM that Thursday. The first customers were waiting outside the front door by 8:55, which is normal for the Thursday memberships rush, and the customers were still waiting at 9:20 because the doors were not unlocked and the lights were off. A customer called at 9:05 asking if the salon was closed for the day. Remy Calder was called twice and texted once, with no answer until 9:25, when Remy Calder replied that the alarm code had been entered wrong and the system had locked itself for fifteen minutes, then that the bus was late, and then that the key to the back door was in the other jacket. The explanations changed three times during the call. Remy Calder finally arrived at 9:38, thirty-eight minutes after the scheduled opening time. During those thirty-eight minutes at least six scheduled sessions were lost, two customers asked for refunds on their memberships, and one customer said she would not come back because this was the second time she had been left waiting outside. This is the third time in two months that Remy Calder has opened late. The opening checklist was not finished until 10:15, so the first sessions of the day were also delayed by twenty minutes. The bed cleaning log for the morning shows no entries for the first two rooms, so the rooms were used without the required wipe down. Remy Calder said it would not happen again and that the pressure of the morning schedule is hard to manage alone.";
/** What the live drafter kept: the account without the two facts, and one prior action. */
const LIVE_OBSERVATION = "Observed:\nOn 11/12, Remy Calder was scheduled to open the salon at 9:00 AM that Thursday. The first customers were waiting outside the front door by 8:55, which is normal for the Thursday memberships rush, and the customers were still waiting at 9:20 because the doors were not unlocked and the lights were off. A customer called at 9:05 asking if the salon was closed for the day. Remy Calder was called twice and texted once, with no answer until 9:25, when Remy Calder replied that the alarm code had been entered wrong and the system had locked itself for fifteen minutes, then that the bus was late, and then that the key to the back door was in the other jacket. The explanations changed three times during the call. Remy Calder finally arrived at 9:38, thirty-eight minutes after the scheduled opening time. During those thirty-eight minutes at least six scheduled sessions were lost and two customers asked for refunds on their memberships. The opening checklist was not finished until 10:15, so the first sessions of the day were also delayed by twenty minutes. The bed cleaning log for the morning shows no entries for the first two rooms, so the rooms were used without the required wipe down. Remy Calder said it would not happen again and that the pressure of the morning schedule is hard to manage alone.\n\nExpectation:\nRemy is expected to open the salon on time and complete the opening checklist and cleaning log before the first session.\n\nGoing Forward:\nRemy will open the salon on time for every scheduled opening.";

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    vi.setSystemTime(new Date("2026-11-20T18:00:00Z"));
    t.directory([...STAFF]);
    t.as("salon_director", KEARNEY);
    await run(t);
  },
});

async function created(t: ReplayContext) {
  t.loopModel!(loopStandIn((view): LoopDecision => lastResult(view, "propose_form")
    ? { text: "Here's the Corrective Action Form for **Remy**." }
    : {
        tool: "propose_form",
        input: {
          template_key: "dpoa",
          employee_name: "Remy Calder",
          person_evidence: evidenceFrom(view, "CA for Remy Calder"),
          what_happened: ACCOUNT,
          policy: "Late Opening",
          incident_date: "2026-11-12",
          warning_level: "written",
          level_evidence: evidenceFrom(view, "documented as a written corrective action"),
          prior_actions: "Verbal (2), dates not given",
        },
      }));
  t.draftWrites({ observation: LIVE_OBSERVATION, prior_actions: "Verbal coaching — date not given" });
  const thread = t.thread();
  await thread.say(SAID);
  const shown = (thread.proposal as { priorActions?: string | null } | null)?.priorActions ?? "";
  expect(shown, "the card does not carry the two verbal talks (the case proves nothing)").toBe("Verbal (2), dates not given");
  const id = await thread.create();
  return t.values(id);
}

export const NOV20_WRITE_UP_ACCOUNT_FACTS_KEPT_CASES: ReplayCase[] = [
  fixed("nov20-f061-long-account-keeps-every-fact", "f061: the 351-word late-opening account: the saved Observation keeps \"third time in two months\" and \"a customer said she would not come back\"", async (t) => {
    const observation = (await created(t)).observation ?? "";
    expect(observation, "no Observation was saved (the case proves nothing)").toMatch(/thirty-eight minutes/);
    expect(observation, `the Observation lost "third time in two months":\n${observation}`).toMatch(/third time in two months/i);
    expect(observation, `the Observation lost the customer who would not come back:\n${observation}`).toMatch(/would not come back/i);
    expect(observation.match(/two customers asked for refunds/gi) ?? [], "a fact the drafter kept was written twice").toHaveLength(1);
  }),
  fixed("nov20-f061-prior-actions-count-survives-create", "f061: the card's \"Prior actions: Verbal (2), dates not given\" is the saved Prior actions, never one verbal line", async (t) => {
    const prior = (await created(t)).prior_actions ?? "";
    expect(prior, `the saved Prior actions lost the count:\n${prior}`).toMatch(/Verbal \(2\)/);
  }),
];
