import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * "YES" TO THE LOOP'S OWN "OPEN <P>'S FORM ON FILE?" IS THE MANAGER ASKING FOR <P>'S FORMS (QA's shadow re-run S1(b))
 * ============================================================================
 *
 * S1 (22 Nov 2026): the reply asked "Do you want me to open <First>'s Corrective Action on file?" and the manager's answer
 * was refused again ("I need you to confirm the person in your own words"), five turns round. The forms-on-file person
 * check never read the app's own question: an answer that names nobody counted only an earlier manager turn naming the
 * person. Now the app's reply right before the answer, when it names this person, makes the answer about them. Invented
 * person: Remy Calder (STAFF).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's 266-chat shadow re-run (22 Nov 2026), S1(b): the manager's answer to the loop's own \"open <First>'s CA on file?\" was refused, turn after turn";
const QUESTION = "Do you want me to open Remy Calder's Corrective Action on file?";

type Found = { forms?: { instance_id?: string }[]; best_match?: string; reason_code?: string };

async function onFile(t: ReplayContext): Promise<string> {
  vi.setSystemTime(new Date("2026-11-19T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form") ? { text: "Here's the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy was late to open on 11/19.", incident_date: "2026-11-19" } })));
  const setup = t.thread();
  await setup.say("ca for remy calder, late to open on 11/19");
  const id = await setup.create();
  vi.setSystemTime(new Date("2026-11-22T15:00:00Z"));
  return id;
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

/** M1 names nobody; the model looks Remy up and asks its own question; M2 answers it. */
async function answer(t: ReplayContext, reply: string) {
  const id = await onFile(t);
  const model = loopStandIn((view): LoopDecision => {
    const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
    const found = lastResult(view, "find_past_forms") as Found | null;
    if (said !== reply) return { text: QUESTION };
    if (!found) return { tool: "find_past_forms", input: { employee_name: "Remy Calder", form: "ca", open: true, forms_on_file_evidence: evidenceFrom(view, reply) } };
    return { text: "Opening it." };
  });
  t.loopModel!(model);
  const thread = t.thread();
  await thread.say("open the ca for the girl who was late friday");
  await thread.say(reply);
  return { id, found: lastResult(model.views.at(-1)!, "find_past_forms") as Found };
}

export const NOV22_AGENT_LOOP_YES_TO_OWN_FORMS_QUESTION_CASES: ReplayCase[] = [
  fixed("nov22-s1b-yes-to-own-question-opens", `S1(b): the loop asked "${QUESTION}"; the manager's "yes" is asking for Remy's forms: found, never privacy_not_this_person`, async (t) => {
    const { id, found } = await answer(t, "yes");
    expect(found.reason_code ?? null, JSON.stringify(found)).not.toBe("privacy_not_this_person");
    expect([found.best_match, ...(found.forms ?? []).map((form) => form.instance_id)], JSON.stringify(found)).toContain(id);
  }),
  fixed("nov22-s1b-yes-please-to-own-question-opens", "S1(b): \"yes please\" the same way", async (t) => {
    const { found } = await answer(t, "yes please");
    expect(found.reason_code ?? null, JSON.stringify(found)).not.toBe("privacy_not_this_person");
  }),
  fixed("nov22-s1b-yes-never-opens-another-persons-forms", "Control: after the loop asked about Remy Calder, \"yes\" never opens Juno Paxton's forms (privacy_not_this_person)", async (t) => {
    await onFile(t);
    const model = loopStandIn((view): LoopDecision => {
      const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
      if (said !== "yes") return { text: QUESTION };
      if (!lastResult(view, "find_past_forms")) return { tool: "find_past_forms", input: { employee_name: "Juno Paxton", form: "ca", open: true, forms_on_file_evidence: evidenceFrom(view, "yes") } };
      return { text: "ok" };
    });
    t.loopModel!(model);
    const thread = t.thread();
    await thread.say("open the ca for the girl who was late friday");
    await thread.say("yes");
    const found = lastResult(model.views.at(-1)!, "find_past_forms") as Found;
    expect(found.reason_code, JSON.stringify(found)).toBe("privacy_not_this_person");
  }),
];
