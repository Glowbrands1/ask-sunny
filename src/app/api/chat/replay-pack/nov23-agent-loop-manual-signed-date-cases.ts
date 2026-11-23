import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * "WHERE CAN I FIND THE DAY AN EMPLOYEE SIGNED THE JBA POLICY MANUAL" (the 266-chat run's 115; QA's item 14 (a), 23 Nov 2026)
 * ============================================================================
 *
 * The manager's turns, word for word (the person invented, the pack's roster): "can you create  a CA for a missing a
 * monthly meeting", "<P>", then "where can I find the day an employee signed the JBA policy manual". The loop said the
 * knowledge base has nothing and to check Woven or HR. The app keeps that date only on each Corrective Action, in its
 * "List date of JBA policy manual signed by employee" box (CA revision 9). QA's ruling (a): a rules-book line and a
 * read_form description line, so the loop reads <P>'s latest CA (with the usual privacy evidence), gives the date and
 * says which form it came from; with none, it says the date is only kept on Corrective Actions and none on file has it.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "The 266-chat run (case 115), re-checked on main 7787aa9: \"where can I find the day an employee signed the JBA policy manual\" got \"Nothing in the company knowledge base covers where …\"";
const T1 = "can you create  a CA for a missing a monthly meeting";
const T3 = "where can I find the day an employee signed the JBA policy manual";

type Found = { forms?: { instance_id?: string }[]; reason_code?: string } | null;
type Read = { values?: Record<string, unknown>; reason_code?: string } | null;

/** Remy Calder's earlier CA on file, its manual-signed box typed by the manager when `signed` is given. */
async function onFile(t: ReplayContext, signed: string | null): Promise<void> {
  vi.setSystemTime(new Date("2026-10-27T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form") ? { text: "Here's the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy was late to open on 10/27.", incident_date: "2026-10-27" } })));
  const setup = t.thread();
  await setup.say("ca for remy calder, late to open on 10/27");
  const id = await setup.create();
  if (signed) t.typeOnForm(id, { policy_manual_signed: signed });
  vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
}

const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";

/** 115's chat: the card for Remy, then the question; the model reads Remy's CAs as the rules book's line says. */
async function chat(t: ReplayContext) {
  const model = loopStandIn((view): LoopDecision => {
    if (said(view) !== T3) return lastResult(view, "propose_form") ? { text: "Here's the Corrective Action Form for **Remy**." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", person_evidence: evidenceFrom(view, "Remy Calder"), what_happened: "Missed a monthly meeting." } };
    const found = lastResult(view, "find_past_forms") as Found;
    if (!found) return { tool: "find_past_forms", input: { employee_name: "Remy Calder", form: "ca", forms_on_file_evidence: evidenceFrom(view, T3) } };
    const latest = found.forms?.[0]?.instance_id;
    if (latest && !lastResult(view, "read_form")) return { tool: "read_form", input: { instance_id: latest, forms_on_file_evidence: evidenceFrom(view, T3) } };
    return { text: "ok" };
  });
  t.loopModel!(model);
  const thread = t.thread();
  await thread.say(T1);
  await thread.say("Remy Calder");
  await thread.say(T3);
  const last = model.views.at(-1)!;
  return { system: last.system, found: lastResult(last, "find_past_forms") as Found, read: lastResult(last, "read_form") as Read };
}

export const NOV23_AGENT_LOOP_MANUAL_SIGNED_DATE_CASES: ReplayCase[] = [
  {
    id: "nov23-115-manual-signed-date-read-from-ca",
    title: "115: \"where can I find the day an employee signed the JBA policy manual\" with Remy's CA card on screen: the model is told the date is on each CA's box, and reads it from Remy's CA on file",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      await onFile(t, "10/15/2026");
      const { system, found, read } = await chat(t);
      expect(system, "the model is not told where the app keeps the date").toMatch(/the app keeps it only on each Corrective Action/);
      expect(system, "the rules book does not say how to read it").toMatch(/List date of JBA policy manual signed by employee" box\. When the manager asks for it/);
      expect(found?.reason_code ?? null, JSON.stringify(found)).toBeNull();
      expect(JSON.stringify(read?.values ?? {}), `the CA on file's date is not read:\n${JSON.stringify(read).slice(0, 500)}`).toContain("10/15/2026");
    },
  },
  {
    id: "nov23-115-manual-signed-date-none-on-file",
    title: "115, none on file: the model is told to say the date is only kept on Corrective Actions and none on file has it",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      await onFile(t, null);
      const { system, read } = await chat(t);
      expect(JSON.stringify(read?.values ?? {}), "the CA on file has a date (the case proves nothing)").not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
      expect(system, "the model is not told what to say when none has it").toMatch(/none on file for <P> has it/);
      expect(system, "the model may still say the knowledge base has nothing").toMatch(/Never say the knowledge base has nothing on it/);
    },
  },
];
