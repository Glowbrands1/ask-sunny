import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { ACCOUNT, T2 } from "./nov21-agent-loop-corrected-name-everywhere-cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A CARD MADE AT THE STEP LIMIT SAYS WHAT CHANGED, AND NEVER ASKS FOR IT AGAIN (port from the sibling app: its QA's live
 * re-test, 21 Nov 2026)
 * ============================================================================
 *
 * The sibling's conversation (`nov21-agent-loop-corrected-name-everywhere-cases.ts`, the person invented): after "Create
 * the coaching form with the information given. Her name is <First> <Lasty> …" the reply was only "Here is the **Coaching
 * Form** for **<name>** for you to review. Nothing else was saved yet. Please send the change you still need again, and
 * I'll make it." The card had applied the name and the form switch. The live model kept calling propose_form until the
 * turn's step limit; the reply is then the app's own (`stepLimitReply`). Expected: it says plainly what changed
 * (Corrective Action → Coaching, the person, the salon) and never asks to send the change again.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Port from the sibling app (its QA's live re-test, 21 Nov 2026, agent loop on): \"Please send the change you still need again\" after the card applied it";
const users = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").length;
const ASKS_AGAIN = /send (?:the|that|it|anything)[^.]*again|still need again/i;
const SALON_PLACE = "she is at the Kearney salon";
/** T1 spelled right here (this app asks "Did you mean" for a close spelling before any card), so T1 is a Corrective Action card. */
const T1 = "My employee Remy Calder was 10 minutes late on her last two shifts. Please create a CA form so I can document. She was late on 10/5 and 10/15";

/** T1 a Corrective Action card; T2 (and T3) the Coaching card proposed again and again, as live, until the step limit. */
const live = () =>
  loopStandIn((view): LoopDecision => {
    const turn = users(view);
    if (turn <= 1) {
      if (lastResult(view, "propose_form")) return { text: "Here is the Corrective Action Form." };
      return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: ACCOUNT, incident_date: "2026-10-15", person_evidence: evidenceFrom(view, "Remy Calder") } };
    }
    return { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: ACCOUNT, incident_date: "2026-10-15", person_evidence: evidenceFrom(view, "Remy Calder", turn - 2), form_change_evidence: evidenceFrom(view, "Create the coaching form", turn - 2) } };
  });

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.()) return;
    vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
    t.directory([...STAFF]);
    t.as("salon_director", KEARNEY);
    t.loopModel!(live());
    await run(t);
  },
});

export const NOV21_AGENT_LOOP_STEP_LIMIT_SAYS_CHANGE_CASES: ReplayCase[] = [
  fixed("nov21-agent-loop-step-limit-says-form-switch", "T2 \"Create the coaching form with the information given. Her name is Remy Calder\" at the step limit: the reply says the form changed from the Corrective Action Form to the Coaching Form, for Remy Calder at the salon, and never asks to send the change again", async (t) => {
    const thread = t.thread();
    await thread.say(T1);
    expect(thread.proposal?.templateKey, "T1 made no Corrective Action card (the case proves nothing)").toBe("dpoa");
    const reply = await thread.say(T2);
    expect(thread.proposal?.templateKey, "no Coaching card (the case proves nothing)").toBe("coaching");
    expect(reply.content, `the reply did not say what changed:\n${reply.content}`).toContain("I changed the form from the Corrective Action Form to the Coaching Form");
    expect(reply.content).toMatch(/The card is for Remy Calder at NE Kearney\./);
    expect(reply.content, `the reply asked for the change again:\n${reply.content}`).not.toMatch(ASKS_AGAIN);
  }),
  fixed("nov21-agent-loop-step-limit-says-salon", `T3 "${SALON_PLACE}" at the step limit: the reply confirms the card's person and salon, and never asks to send the change again`, async (t) => {
    const thread = t.thread();
    for (const said of [T1, T2]) await thread.say(said);
    const reply = await thread.say(SALON_PLACE);
    expect(reply.content, `the reply did not confirm the salon:\n${reply.content}`).toMatch(/The card is for Remy Calder at NE Kearney\./);
    expect(reply.content, `the reply asked for the change again:\n${reply.content}`).not.toMatch(ASKS_AGAIN);
  }),
];
