import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A COACHING CARD'S ACCOUNT IS LABELLED "DETAILS OF COACHING" (the 266-chat run's 039 and 241, QA's step 3, 22 Nov 2026)
 * ============================================================================
 *
 * The manager's turns, word for word (the person invented, the pack's roster): "thank you her name is <P>", then
 * "create a coaching form for <P>". The loop's reply read "Here's the Coaching Form for **<P>**. / **Observation of
 * Offense:** Coaching on how to update clients' checking account information …": a Corrective Action's label on a
 * Coaching Form, whose field is "Details of Coaching".
 *
 * Mechanism: the rules book gave every incident card the label "Observation of Offense". propose_form's card now
 * carries account_label, the label of the form's own account field read from its template, and the rules book has the
 * model use it.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "The 266-chat run (cases 039, 241), re-checked on main 7787aa9: a Coaching Form card read \"**Observation of Offense:** Coaching on how to update clients' checking account information …\"";

type Out = { card?: { observation?: string | null; account_label?: string | null } } | null;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("assistant_salon_director", KEARNEY);
}

/** The model writes the account line as the rules book has it: the card's own label, then the account. */
function model(templateKey: "coaching" | "dpoa") {
  return loopStandIn((view): LoopDecision => {
    const result = lastResult(view, "propose_form") as Out;
    if (result) return { text: `Here's the card for **Remy**.\n**${result.card?.account_label ?? "?"}:** ${result.card?.observation ?? ""}` };
    return {
      tool: "propose_form",
      input: templateKey === "coaching"
        ? { template_key: "coaching", employee_id: "e-2", topic: "updating client accounts", what_happened: "Coaching on how to update clients' checking account information.", policy: "Other — Updating client accounts" }
        : { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy did not update a client's checking account information.", policy: "Other — Updating client accounts" },
    };
  });
}

const labelOf = (standIn: ReturnType<typeof model>) => (standIn.views.flatMap((view) => view.results.filter((result) => result.tool === "propose_form")).at(-1)?.output as Out)?.card?.account_label;

export const NOV22_AGENT_LOOP_COACHING_ACCOUNT_LABEL_CASES: ReplayCase[] = [
  {
    id: "nov22-f038-039-coaching-account-label",
    title: "039/241: \"create a coaching form for <P>\": the card's account label is Details of Coaching, never Observation of Offense",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      const standIn = model("coaching");
      t.loopModel!(standIn);
      const reply = await t.thread().say("create a coaching form for Remy");
      expect(labelOf(standIn), "the coaching card does not carry its own account label").toBe("Details of Coaching");
      expect(reply.content, `the coaching card reads a Corrective Action's label:\n${reply.content}`).not.toMatch(/Observation of Offense/);
    },
  },
  {
    id: "nov22-f038-039-control-ca-account-label",
    title: "control: a Corrective Action card's account label is still Observation of Offense",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      const standIn = model("dpoa");
      t.loopModel!(standIn);
      await t.thread().say("create a CA for Remy");
      expect(labelOf(standIn)).toBe("Observation of Offense");
    },
  },
];
