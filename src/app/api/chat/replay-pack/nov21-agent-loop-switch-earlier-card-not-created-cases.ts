import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A SWITCHED-FROM CARD THAT WAS NEVER CREATED IS NOT IN FORM MONITORING (QA2, 21 Nov 2026; #1172's live test on 3b0038f4)
 * ============================================================================
 *
 * T1 "ca for <P>, late on 11/18" (a Corrective Action card; Create never pressed), T2 "make it a coaching form": the reply
 * said "The earlier Corrective Action card stays as it is; it's left unused unless you'd like it deleted from Form
 * Monitoring." Nothing was ever created, so nothing is in Form Monitoring. General rule: the card says which form it was
 * switched from and whether that form was created (form_changed); with earlier_created false the reply never mentions
 * Form Monitoring, deleting it or keeping it unused (it says nothing, or at most "The Corrective Action card was not
 * created."). A switch away from a created draft still may say the draft is left as it is. QA2's turns, word for word;
 * invented name: Remy Calder (the pack's roster).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA2 (21 Nov 2026), #1172's live test on 3b0038f4: \"make it a coaching form\" after a CA card never created, and the reply said it was \"left unused unless you'd like it deleted from Form Monitoring\"";
const T1 = "ca for Remy Calder, late on 11/18";
const T2 = "make it a coaching form";
const LIVE_T2 = "Here's the Coaching Form for **Remy Calder**. The earlier Corrective Action card stays as it is; it's left unused unless you'd like it deleted from Form Monitoring.";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-21T02:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}
type Out = { card?: unknown; facts?: { form_changed?: { from?: string; earlier_created?: boolean } } } | null;
const checkedBack = (view: LoopView) => view.turns.some((turn) => /^\[app check\]/.test(turn.text) && /Form Monitoring/.test(turn.text));

/** T1: the Corrective Action card. */
async function caCard(t: ReplayContext) {
  const thread = t.thread();
  t.loopModel!(loopStandIn((view): LoopDecision => {
    if (lastResult(view, "propose_form")) return { text: "Here's the Corrective Action Form for **Remy Calder**." };
    return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Late on 11/18.", incident_date: "2026-11-18", policy: headingWith(view, /^attendance/i) } };
  }));
  await thread.say(T1);
  expect(thread.proposal?.templateKey, "T1 made no Corrective Action card (the case proves nothing)").toBe("dpoa");
  return thread;
}

/** T2: the live model, switching to coaching and writing the live reply until the app hands it back. */
const switchModel = () => loopStandIn((view): LoopDecision => {
  if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: "Late on 11/18.", incident_date: "2026-11-18", policy: headingWith(view, /^attendance/i), form_change_evidence: evidenceFrom(view, T2) } };
  return { text: checkedBack(view) ? "Here's the Coaching Form for **Remy Calder**." : LIVE_T2 };
});

export const NOV21_AGENT_LOOP_SWITCH_EARLIER_CARD_NOT_CREATED_CASES: ReplayCase[] = [
  {
    id: "nov21-switch-earlier-card-never-created-no-form-monitoring",
    title: "QA2: T1 \"ca for <P>, late on 11/18\" (card, no Create), T2 \"make it a coaching form\": the coaching card says the CA was never created (form_changed earlier_created false), and the reply never mentions Form Monitoring or deleting it",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const thread = await caCard(t);
      const model = switchModel();
      t.loopModel!(model);
      const reply = await thread.say(T2);
      expect(thread.proposal?.templateKey, reply.content).toBe("coaching");
      const result = lastResult(model.views.at(-1)!, "propose_form") as Out;
      expect(result?.facts?.form_changed, `the card does not say the earlier card was never created:\n${JSON.stringify(result?.facts ?? null).slice(0, 600)}`).toEqual({ from: "Corrective Action Form", earlier_created: false });
      expect(reply.content, `the reply speaks of Form Monitoring or deleting a card never created:\n${reply.content}`).not.toMatch(/Form Monitoring|delet|left unused/i);
      expect(reply.content, "the reply lost the coaching card").toMatch(/Coaching Form/);
    },
  },
  {
    id: "nov21-switch-earlier-draft-created-may-say-form-monitoring",
    title: "Control: T1's CA card is created (a draft exists), then \"make it a coaching form\": form_changed says earlier_created true, and the reply may say the created draft is left as it is in Form Monitoring",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const thread = await caCard(t);
      await thread.create();
      const model = switchModel();
      t.loopModel!(model);
      const reply = await thread.say(T2);
      const result = lastResult(model.views.at(-1)!, "propose_form") as Out;
      expect(result?.facts?.form_changed?.earlier_created, `the created draft is not reported as created:\n${JSON.stringify(result).slice(0, 600)}`).toBe(true);
      expect(reply.content, "a true line about a created draft was taken out").toMatch(/Form Monitoring/);
    },
  },
];
