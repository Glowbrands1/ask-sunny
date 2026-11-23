import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE ACTION PLAN ADDS THE STEP THE MANAGER ASKED FOR (STATED_PLAN_STEPS_ENABLED; Pau via QA, 20 Nov 2026, f062)
 * ============================================================================
 *
 * QA's live test of #1121 (conv_mwozbi5v2a7kvm0, item 6; saved CA de9e77d5). The manager's one 351-word turn ended "I
 * want this documented as a written corrective action and the opening procedures reviewed with <P> this week." The
 * saved action_plan was the generic two sentences, "Management will review the Late Opening policy with <first>.
 * Future policy violations …". Pau ("YEAH add"): old Sunny's plan stays exactly, and each step the manager stated is
 * added in their words before the closing; with no step the plan is byte-identical. On the real Create path, on the
 * regular chat (the intent reader's planSteps slot) and on the agent loop (the card's plan_steps with evidence).
 * Tester-Sunny 2's message word for word; their invented "Test Testy" is STAFF's invented Remy Calder here.
 */

const REPORT = "QA's live test of #1121 (20 Nov 2026, f062): the Action Plan ignored the step the manager asked for";
/* Changed on purpose (QA2, 21 Nov 2026): Pau approved STATED_PLAN_STEPS_ENABLED on in Sunny production (13:31Z), so the stated-step cases hold with production's flags. */
const OPEN = "fixed" as const;

/** Tester-Sunny 2's one manager turn, word for word (351 words; the person invented). */
const SAID = "CA for Remy Calder, late opening incident on 11/12. Remy Calder was scheduled to open the salon at 9:00 AM that Thursday. The first customers were waiting outside the front door by 8:55, which is normal for our Thursday memberships rush, and they were still waiting at 9:20 because the doors were not unlocked and the lights were off. I got a call from a customer at 9:05 asking if we were closed for the day. I tried calling Remy Calder twice and texted once, and there was no answer until 9:25, when Remy Calder replied that the alarm code had been entered wrong and the system had locked itself for fifteen minutes, then that the bus was late, and then that the key to the back door was in the other jacket. The explanations changed three times during the call. Remy Calder finally arrived at 9:38, thirty-eight minutes after the scheduled opening time. During those thirty-eight minutes we lost at least six scheduled sessions, two customers asked for refunds on their memberships, and one customer said she would not come back because this was the second time she had been left waiting outside. This is the third time in two months that Remy Calder has opened late, and the two earlier times were both discussed verbally with no paperwork. The opening checklist was not finished until 10:15, so the first sessions of the day were also delayed by twenty minutes. The bed cleaning log for the morning shows no entries for the first two rooms, so the rooms were used without the required wipe down. I explained again that opening the salon on time is a core part of the job, that customers are billed for time they never receive when the doors are late, and that the cleaning log must be completed before the first session of the day. Remy Calder said it would not happen again and that the pressure of the morning schedule is hard to manage alone. I want this documented as a written corrective action and the opening procedures reviewed with Remy Calder this week.";
/** The loop card's account as the live model wrote it (the person invented). */
const ACCOUNT = "On 11/12, Remy Calder was scheduled to open the salon at 9:00 AM that Thursday. The first customers were waiting outside the front door by 8:55, which is normal for the Thursday memberships rush, and the customers were still waiting at 9:20 because the doors were not unlocked and the lights were off. A customer called at 9:05 asking if the salon was closed for the day. Remy Calder was called twice and texted once, with no answer until 9:25, when Remy Calder replied that the alarm code had been entered wrong and the system had locked itself for fifteen minutes, then that the bus was late, and then that the key to the back door was in the other jacket. The explanations changed three times during the call. Remy Calder finally arrived at 9:38, thirty-eight minutes after the scheduled opening time. During those thirty-eight minutes at least six scheduled sessions were lost, two customers asked for refunds on their memberships, and one customer said she would not come back because this was the second time she had been left waiting outside. This is the third time in two months that Remy Calder has opened late. The opening checklist was not finished until 10:15, so the first sessions of the day were also delayed by twenty minutes. The bed cleaning log for the morning shows no entries for the first two rooms, so the rooms were used without the required wipe down. Remy Calder said it would not happen again and that the pressure of the morning schedule is hard to manage alone.";
const ASKED = "the opening procedures reviewed with Remy Calder this week";
const STEP = "Review the opening procedures with Remy this week.";
const OBSERVATION = `Observed:\n${ACCOUNT}\n\nExpectation:\nRemy is expected to open the salon on time.`;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-20T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

/**
 * The chat on one path: the agent loop (its stand-in card) or the regular chat (its scripted intent reader; no loop model,
 * so the loop does not run, as in production for everyone not listed in AGENT_LOOP_USERS).
 */
async function savedPlan(t: ReplayContext, steps: string[] | null, loop: boolean) {
  if (loop) t.loopModel!(loopStandIn((view): LoopDecision => lastResult(view, "propose_form")
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
          ...(steps ? { plan_steps: steps, plan_evidence: evidenceFrom(view, ASKED) } : {}),
        },
      }));
  t.slotsRead({ employee: "Remy Calder", policyHeading: "Late Opening", warningLevel: "written", incidentDate: "11/12", ...(steps ? { planSteps: steps } : {}) });
  t.draftWrites({ observation: OBSERVATION });
  const thread = t.thread();
  await thread.say(SAID);
  /* The regular chat asks "Do you want a Corrective Action for <P>? Say yes …"; the manager says yes, and the card comes. */
  const card = loop ? null : await thread.say("yes");
  const id = await thread.create();
  const saved = (t.values(id).action_plan ?? "").replace(/\s+/g, " ").trim();
  if (card) {
    /* The card's Action Plan line is the plan Create saves (CARD_PLAN_MATCHES_CREATE). */
    const shown = (/\*\*Action plan:\*\*\s*([^\n]+)/i.exec(card.content)?.[1] ?? "").replace(/\s+/g, " ").trim();
    expect(shown, `the card's plan is not the saved plan:\ncard: ${shown}\nsaved: ${saved}`).toBe(saved);
  }
  return saved;
}

const STEPS = ["review the opening procedures with Remy Calder this week"];

function expectStepAdded(plan: string) {
  expect(plan, "no Action Plan was saved (the case proves nothing)").toMatch(/Future policy violations/);
  expect(plan, `the step the manager asked for is not in the plan:\n${plan}`).toContain(STEP);
  expect(plan.indexOf(STEP), `the step is not before the closing:\n${plan}`).toBeLessThan(plan.indexOf("Future policy violations"));
  expect(plan.replace(` ${STEP}`, ""), `the standard plan changed:\n${plan}`).toBe(STANDARD_PLAN);
}

/** Old Sunny's plan for this card with no stated step, as production saves it today (both paths). */
const STANDARD_PLAN = "Management will review the Late Opening policy with Remy. Future policy violations may result in additional corrective action up to and including termination of employment.";

const INVENTED = ["schedule a follow-up meeting in two weeks"];

const PATHS = [
  { key: "chat", name: "regular chat", loop: false, flags: ["STATED_PLAN_STEPS_ENABLED"] },
  { key: "loop", name: "agent loop", loop: true, flags: ["AGENT_LOOP_ENABLED", "STATED_PLAN_STEPS_ENABLED"] },
] as const;

export const NOV20_ACTION_PLAN_STATED_STEPS_CASES: ReplayCase[] = PATHS.flatMap((path): ReplayCase[] => [
  {
    id: `nov20-f062-stated-step-added-${path.key}`,
    title: `f062, ${path.name}: the 351-word late-opening account ending "… the opening procedures reviewed with <P> this week": the saved plan is old Sunny's plan with "${STEP}" before the closing`,
    report: REPORT,
    status: OPEN,
    fixFlags: [...path.flags],
    async run(t) {
      start(t);
      expectStepAdded(await savedPlan(t, STEPS, path.loop));
    },
  },
  {
    id: `nov20-f062-no-step-plan-byte-identical-${path.key}`,
    title: `f062 control, ${path.name}: the same account with no step read: the saved plan is old Sunny's plan, byte for byte, with the flag off or on`,
    report: REPORT,
    status: "fixed",
    fixFlags: [...path.flags],
    async run(t) {
      start(t);
      expect(await savedPlan(t, null, path.loop)).toBe(STANDARD_PLAN);
    },
  },
  {
    id: `nov20-f062-invented-step-never-added-${path.key}`,
    title: `f062, ${path.name}: a step the manager never asked for ("${INVENTED[0]}") is never added`,
    report: REPORT,
    status: "fixed",
    fixFlags: [...path.flags],
    async run(t) {
      start(t);
      expect(await savedPlan(t, INVENTED, path.loop)).toBe(STANDARD_PLAN);
    },
  },
]);
