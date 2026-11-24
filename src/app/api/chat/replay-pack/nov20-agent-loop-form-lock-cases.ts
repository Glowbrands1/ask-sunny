import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE FORM IS LOCKED TO THE OPEN CARD (QA item 7, 20 Nov 2026; Pau's name/form lock)
 * ============================================================================
 *
 * The rules book says a short answer or more of the account updates THAT card, with the same form and person, unless the
 * manager asks for a new or different form; nothing enforced it, except for the answer to a name check
 * (name_answer_keeps_form). General rule: once a card for form X is on screen for a person, propose_form refuses another
 * template_key for that person unless this turn's own words ask for it: new_form_evidence (another form, a new request)
 * or form_change_evidence (this card made a different form, the same request: "make it a CA").
 * Invented names only: Tamsin Orwell (roster), Remy Calder (the pack's roster).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA (20 Nov 2026), item 7: a later turn proposed a different template_key for the open card's person with no words asking for it";
const TAMSIN: DirectoryRow = { id: "e-tamsin-orwell", firstName: "Tamsin", lastName: "Orwell", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-19T22:40:00Z"));
  t.directory([...STAFF, TAMSIN]);
  t.as("salon_director", KEARNEY);
}
type Out = { reason_code?: string; error?: string; template_key?: string; ask_exactly?: string; card?: unknown } | null;
const proposeResults = (model: { views: LoopView[] }) => model.views.flatMap((view) => view.results).filter((result) => result.tool === "propose_form").map((result) => result.output as Out);

/** T1: the Coaching card for Tamsin. */
async function coachingCard(t: ReplayContext) {
  t.loopModel!(loopStandIn((view): LoopDecision => {
    if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "coaching", employee_id: TAMSIN.id, what_happened: "Not greeting guests at the front desk.", incident_date: "2026-11-18" } };
    return { text: "Here's the Coaching Form for **Tamsin Orwell**." };
  }));
  const thread = t.thread();
  await thread.say("coaching for Tamsin Orwell, not greeting guests at the front desk on 11/18");
  expect(thread.proposal?.templateKey).toBe("coaching");
  return thread;
}

/** The live model: a Corrective Action for the person, with `extra` evidence; after a lock refusal, the refused form again. */
/*
 * Changed on purpose (the issue-line port, 6f27926: a Corrective Action account with no subject is handed back,
 * account_no_subject): the stand-in writes its CA account with the person's first name as its subject, as the live model
 * is taught to. The cases' expectations (which form the card is) are unchanged.
 */
const caAccount = (employeeId: string) => `${employeeId === TAMSIN.id ? "Tamsin" : "Remy"} was not greeting guests at the front desk; also late on 11/14.`;
const caModel = (employeeId: string, extra: (view: LoopView) => Record<string, unknown> = () => ({})) => loopStandIn((view): LoopDecision => {
  const tries = proposeResults({ views: [view] });
  const last = tries.at(-1);
  if (last?.card) return { text: "Here's the card." };
  if (last?.reason_code === "form_locked" && tries.length === 1) return { tool: "propose_form", input: { template_key: last.template_key, employee_id: employeeId, what_happened: caAccount(employeeId), incident_date: "2026-11-18" } };
  if (last) return { text: last.ask_exactly ?? last.error ?? "" };
  return { tool: "propose_form", input: { template_key: "dpoa", employee_id: employeeId, what_happened: caAccount(employeeId), incident_date: "2026-11-18", ...extra(view) } };
});

export const NOV20_AGENT_LOOP_FORM_LOCK_CASES: ReplayCase[] = [
  {
    id: "nov20-form-lock-more-account-keeps-the-form",
    title: "Coaching card on screen for Tamsin; \"she was also late on 11/14\" has the model propose a Corrective Action with no words asking for one: refused (form_locked), the card stays the Coaching Form",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const thread = await coachingCard(t);
      const model = caModel(TAMSIN.id);
      t.loopModel!(model);
      const reply = await thread.say("she was also late on 11/14");
      const first = proposeResults(model)[0];
      expect(first?.reason_code, `another form was taken:\n${JSON.stringify(first)}`).toBe("form_locked");
      expect(first?.template_key).toBe("coaching");
      expect(reply.formProposal?.templateKey ?? thread.proposal?.templateKey, reply.content).toBe("coaching");
    },
  },
  {
    id: "nov20-form-lock-control-make-it-a-ca",
    title: "Control: \"make it a CA\" with form_change_evidence (this message's words) switches the Coaching card to a Corrective Action, the same request",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const thread = await coachingCard(t);
      t.loopModel!(caModel(TAMSIN.id, (view) => ({ form_change_evidence: evidenceFrom(view, "make it a CA") })));
      const reply = await thread.say("make it a CA");
      expect(reply.formProposal?.templateKey, reply.content).toBe("dpoa");
    },
  },
  {
    id: "nov20-form-lock-control-another-form-asked",
    title: "Control: \"also do a CA for her, she was late again on 11/14\" with new_form_evidence makes the Corrective Action",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const thread = await coachingCard(t);
      t.loopModel!(caModel(TAMSIN.id, (view) => ({ new_form_evidence: evidenceFrom(view, "also do a CA for her") })));
      const reply = await thread.say("also do a CA for her, she was late again on 11/14");
      expect(reply.formProposal?.templateKey, reply.content).toBe("dpoa");
    },
  },
  {
    id: "nov20-form-lock-control-another-person",
    title: "Control: with Tamsin's Coaching card on screen, \"CA for Remy Calder, late on 11/14\" is another person's card: no lock",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const thread = await coachingCard(t);
      const model = caModel("e-2");
      t.loopModel!(model);
      await thread.say("CA for Remy Calder, late on 11/14");
      expect(proposeResults(model)[0]?.reason_code ?? null).toBeNull();
      expect(thread.proposal?.templateKey).toBe("dpoa");
    },
  },
];
