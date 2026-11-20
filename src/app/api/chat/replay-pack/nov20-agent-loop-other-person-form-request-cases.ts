import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A FORM ASKED FOR SOMEBODY ELSE DOES NOT CLOSE THIS CARD (c134; QA, 20 Nov 2026)
 * ============================================================================
 *
 * c134: an exit card for person A was still open, then the manager pasted a write-up about person B (an "Observation of
 * Concern" with "Coaching & Expectations Moving Forward" and "further corrective action" in it, no request; Runner 2's shape). Create on A's exit card refused: "This proposal is out of date: the conversation has since
 * asked for a different form." Pau's rule: a later form request counts against a card only when it is for that card's
 * person or names no person. The control stays: the same person asking for another form is still refused. Each case
 * presses Create. Invented names only (Remy Calder on the staff list; Tessa Marlow, not).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Coding-C item 6 (QA, 20 Nov 2026): c134, Create on an open exit card refused after a pasted write-up asked for a CA for somebody else";

const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
const quoted = (view: LoopView, quote: string) => ({ message_id: [...managerTurns(view)].reverse().find((turn) => turn.text.toLowerCase().includes(quote.toLowerCase()))?.messageIds?.at(-1) ?? "current", quote });

/** The live model: the exit card for Remy Calder on the first turn; every later turn only answers (no new card). */
const exitModel = loopStandIn((view): LoopDecision => {
  const result = [...view.results].reverse().find((entry) => entry.tool === "propose_form")?.output;
  if (result) return { text: typeof result.ask_exactly === "string" ? result.ask_exactly : "Here's the exit form for **Remy Calder**." };
  if (managerTurns(view).length > 1) return { text: "The exit card above is still open; press Create when it looks right." };
  return {
    tool: "propose_form",
    input: {
      template_key: "stc-exit",
      employee_name: "Remy Calder",
      person_evidence: quoted(view, "Remy Calder"),
      exit_evidence: { ...quoted(view, "put together an exit for Remy Calder"), kind: "asks_for_exit_form" },
      exit_type: "resignation",
      incident_date: "2026-10-25",
    },
  };
});

/** c134 T4, pasted with no other words (Runner 2's masked shape; the person's name invented). */
const C134_PASTE = `Observation of Concern

Following a review of employee hours worked and tanning history, it was confirmed that Tessa Marlow utilized tanning equipment while clocked in for scheduled shifts. This is a direct violation of Sun Tan City's Employee Tanning Privileges Policy, which strictly prohibits employees from tanning while on the clock.

Company Policy & Expectations

Per Sun Tan City's Employee Tanning Privileges Policy, the following expectations apply to all employees:

No tanning while on the clock. Employees are strictly prohibited from utilizing tanning equipment while clocked in.

Employee processing requirement: Another employee must be present to process each employee tanning session. Employees are not permitted to process their own tanning sessions.

Tanning outside scheduled hours: Employees may tan before or after their scheduled shifts, provided they are clocked out, another employee is present to process the session, and the tanning session does not create a hardship for the business.

Coaching & Expectations Moving Forward

Tessa has been coached on the importance of adhering to company policies and maintaining accountability during scheduled working hours.

Effective immediately, Tessa is expected to follow all employee tanning privileges policies without exception. All personal tanning sessions must take place while clocked out, be processed by another employee, and not interfere with salon operations.

Any additional violations of this policy may result in further corrective action, up to and including termination of employment, in accordance with company policy and HR guidance.`;

async function exitCard(t: ReplayContext, later: string) {
  vi.setSystemTime(new Date("2026-11-20T11:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(exitModel);
  const thread = t.thread();
  const first = await thread.say("put together an exit for Remy Calder, she resigned and her last day worked was 10/25");
  expect(thread.proposal?.employeeName, `no exit card for Remy Calder (the case proves nothing): ${first.content}`).toBe("Remy Calder");
  await thread.say(later);
  return thread;
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.()) return;
    await run(t);
  },
});

export const NOV20_AGENT_LOOP_OTHER_PERSON_FORM_REQUEST_CASES: ReplayCase[] = [
  fixed("nov20-create-exit-card-after-pasted-write-up-c134", "c134: the exit card for Remy Calder, then the manager pastes an \"Observation of Concern\" write-up about Tessa Marlow (not on the staff list) tanning while clocked in, with \"Coaching & Expectations Moving Forward\", \"has been coached\" and \"further corrective action\" in it and no request (no card for her): Create makes Remy Calder's exit card", async (t) => {
    const thread = await exitCard(t, C134_PASTE);
    await expect(thread.create()).resolves.toBeTruthy();
  }),
  fixed("nov20-create-exit-card-after-ca-asked-for-another-person", "A form asked for somebody else: the exit card for Remy Calder, then \"Please write up a corrective action for Tessa Marlow. On 11/12 Tessa Marlow was seen tanning while clocked in …\" (no card for her): Create makes Remy Calder's exit card", async (t) => {
    const thread = await exitCard(t, "Please write up a corrective action for Tessa Marlow. On 11/12 Tessa Marlow was seen tanning while clocked in. Tessa Marlow was reminded that tanning on the clock is not allowed and Tessa Marlow said she understood.");
    await expect(thread.create()).resolves.toBeTruthy();
  }),
  fixed("nov20-create-exit-card-control-same-person-asks-another-form", "Control: the exit card for Remy Calder, then \"actually I need a corrective action for Remy Calder instead\" (the model makes no new card): Create refuses the exit card", async (t) => {
    const thread = await exitCard(t, "actually I need a corrective action for Remy Calder instead");
    await expect(thread.create(), "the exit card was created after the same person was asked a CA").rejects.toThrow(/out of date/);
  }),
  fixed("nov20-create-exit-card-control-form-with-no-person", "Control: the exit card for Remy Calder, then \"I need a coaching form instead\" (names nobody; the model makes no new card): Create refuses the exit card", async (t) => {
    const thread = await exitCard(t, "I need a coaching form instead");
    await expect(thread.create(), "the exit card was created after a different form was asked for nobody named").rejects.toThrow(/out of date/);
  }),
];
