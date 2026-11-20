import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A ROSTER PERSON IS SEATED ONLY WHEN THE MANAGER NAMED OR PICKED THEM (QA item 8, 20 Nov 2026; Pau's name/form lock)
 * ============================================================================
 *
 * `closeSpellingNotSettled` returns null "when no words name <A> at all", so propose_form seated an employee_id (or a
 * roster name the model typed itself) that the manager never typed. General rule: a roster person goes on a card only
 * when the manager's words in this chat name them exactly (a full name, or a whole first or preferred name), as a close
 * spelling (the Did-you-mean, unchanged: ruling (b)'s order), or by a recorded pick or confirmation (an answer to this
 * chat's name question that offered them, a yes, an earlier card for them, the draft open for them). Otherwise
 * propose_form refuses (person_not_named) and asks who the form is for.
 * Invented names only: Tamsin Orwell (roster).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA (20 Nov 2026), item 8: propose_form seated a roster person the manager never named";
const TAMSIN: DirectoryRow = { id: "e-tamsin-orwell", firstName: "Tamsin", lastName: "Orwell", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-19T22:40:00Z"));
  t.directory([...STAFF, TAMSIN]);
  t.as("salon_director", KEARNEY);
}
type Out = { reason_code?: string; error?: string; ask_exactly?: string; card?: unknown } | null;
const proposeResults = (model: { views: LoopView[] }) => model.views.flatMap((view) => view.results).filter((result) => result.tool === "propose_form").map((result) => result.output as Out);

/** The live model: a Corrective Action for Tamsin, by id or by the roster name it typed itself. */
const guessModel = (by: "id" | "name", extra: (view: LoopView) => Record<string, unknown> = () => ({})) => loopStandIn((view): LoopDecision => {
  const card = lastResult(view, "propose_form") as Out;
  if (!card) return { tool: "propose_form", input: { template_key: "dpoa", ...(by === "id" ? { employee_id: TAMSIN.id } : { employee_name: "Tamsin Orwell" }), what_happened: "Late on 11/18.", incident_date: "2026-11-18", ...extra(view) } };
  return { text: card.card ? "Here's the Corrective Action Form for **Tamsin Orwell**." : card.ask_exactly ?? card.error ?? "" };
});

export const NOV20_AGENT_LOOP_PERSON_MUST_BE_NAMED_CASES: ReplayCase[] = [
  {
    id: "nov20-person-not-named-by-id",
    title: "\"ca for the new girl at the front desk, she was late on 11/18\": the model seats Tamsin Orwell's employee_id though no words name her: refused (person_not_named), no card, the reply asks who the form is for",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const model = guessModel("id");
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say("ca for the new girl at the front desk, she was late on 11/18");
      expect(proposeResults(model)[0]?.reason_code, `the unnamed person was seated:\n${JSON.stringify(proposeResults(model)[0])}`).toBe("person_not_named");
      expect(reply.formProposal ?? null, reply.content).toBeNull();
      expect(reply.content).toMatch(/Who is this .* for\?/);
    },
  },
  {
    id: "nov20-person-not-named-by-typed-roster-name",
    title: "The same request, the model typing the roster name \"Tamsin Orwell\" itself (propose_form's own lookup): refused (person_not_named), no card",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const model = guessModel("name");
      t.loopModel!(model);
      const reply = await t.thread().say("ca for the new girl at the front desk, she was late on 11/18");
      expect(proposeResults(model)[0]?.reason_code).toBe("person_not_named");
      expect(reply.formProposal ?? null, reply.content).toBeNull();
    },
  },
  {
    id: "nov20-person-named-control-first-name",
    title: "Control: \"ca for tamsin, she was late on 11/18\" (her whole first name) seats Tamsin Orwell",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const model = guessModel("id", (view) => ({ person_evidence: evidenceFrom(view, "tamsin") }));
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("ca for tamsin, she was late on 11/18");
      expect(proposeResults(model)[0]?.reason_code ?? null).toBeNull();
      expect(thread.proposal?.employeeName).toBe("Tamsin Orwell");
    },
  },
  {
    id: "nov20-person-named-control-earlier-card",
    title: "Control: after Tamsin Orwell's card, \"make another one, she was late again on 11/19\" (no name, new_form_evidence) seats her from the earlier card",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(guessModel("id"));
      const thread = t.thread();
      await thread.say("ca for Tamsin Orwell, she was late on 11/18");
      expect(thread.proposal?.employeeName).toBe("Tamsin Orwell");
      const model = guessModel("id", (view) => ({ new_form_evidence: evidenceFrom(view, "make another one"), what_happened: "Late again on 11/19.", incident_date: "2026-11-19" }));
      t.loopModel!(model);
      await thread.say("make another one, she was late again on 11/19");
      expect(proposeResults(model)[0]?.reason_code ?? null).toBeNull();
    },
  },
];
