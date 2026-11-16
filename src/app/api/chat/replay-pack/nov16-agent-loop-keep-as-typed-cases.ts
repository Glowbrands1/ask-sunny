import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * KEEP-AS-TYPED IS HONOURED (QA's live test a4 on main e2e92554, 16 Nov 2026; Pau's ruling A)
 * ============================================================================
 *
 * Sunny asked "Did you mean <B>?" (reply "yes" to use <B>, or "no" to keep <B>x as typed). Both answers failed twice, with
 * no card in two turns: "no" and "use <B>x" each got "I can't find <B>x on your staff list. Reply use <B>x …". The app
 * offered an instruction it then did not honour. Ruling A: "no" keeps the name as typed, and "use <typed>" is always
 * honoured when the app offered it. An answer to a recorded name question is settled from the record, before any roster
 * refusal. Invented names only: Remy Calder (roster), "Remi Calder" (nobody).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const NEAR_MISS = "NEAR_MISS_NEVER_SEATED_ENABLED";
const REPORT = "QA's live test a4 (16 Nov 2026, main e2e92554): \"no\" and \"use <B>x\" after \"Did you mean <B>?\" both got \"I can't find <B>x … Reply use <B>x\", no card in 2 turns";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-15T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const lastSaid = (view: LoopView) => [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
type StaffOut = { note?: string; ask_exactly?: string; matches?: { employee_id: string }[] } | null;

/**
 * The model: T1 looks up the typed name and asks the Did-you-mean; T2 proposes with the name kept as typed (`lookupFirst`:
 * it looks the name up again first, as the live model did).
 */
function model(lookupFirst = false) {
  return loopStandIn((view): LoopDecision => {
    const said = lastSaid(view);
    const staff = lastResult(view, "find_staff") as StaffOut;
    if (/^ca for/i.test(said)) {
      if (!staff) return { tool: "find_staff", input: { name: "Remi Calder", person_evidence: evidenceFrom(view, "Remi Calder") } };
      const asked = /Ask the manager, in these words: ([\s\S]+)$/.exec(staff.note ?? "")?.[1];
      return { text: asked ?? "Did you mean **Remy Calder**?" };
    }
    if (lookupFirst && !staff) return { tool: "find_staff", input: { name: "Remi Calder", person_evidence: evidenceFrom(view, "Remi Calder", 1) } };
    const card = lastResult(view, "propose_form") as { reason_code?: string; ask_exactly?: string } | null;
    if (!card) return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remi Calder", what_happened: "She was late on 11/12.", incident_date: "2026-11-12", request_evidence: [evidenceFrom(view, "late on 11/12", 1)] } };
    return { text: card.ask_exactly ?? card.reason_code ?? "Here's the Corrective Action Form for **Remi**." };
  });
}

export const NOV16_AGENT_LOOP_KEEP_AS_TYPED_CASES: ReplayCase[] = ([["no", false], ["use Remi Calder", false], ["no", true], ["use Remi Calder", true]] as const).map(([answer, lookupFirst]): ReplayCase => ({
  id: `nov16-keep-as-typed-${answer === "no" ? "no" : "use-typed"}-after-did-you-mean-a4${lookupFirst ? "-looked-up-again" : ""}`,
  title: `Keep-as-typed (a4): "ca for Remi Calder, late on 11/12" asks "Did you mean **Remy Calder**?"; "${answer}"${lookupFirst ? " (the model looks the name up again first)" : ""} keeps "Remi Calder" as typed and makes the card at once, never "I can't find Remi Calder … Reply use Remi Calder"`,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG, NEAR_MISS],
  async run(t) {
    if (!t.loopOn?.()) return;
    start(t);
    t.loopModel!(model(lookupFirst));
    const thread = t.thread();
    const ask = await thread.say("ca for Remi Calder, late on 11/12");
    expect(ask.content, "T1 did not ask the Did-you-mean").toMatch(/Did you mean \*\*Remy Calder\*\*/);
    const reply = await thread.say(answer);
    expect(reply.content, "the app re-offered the instruction it had just given").not.toMatch(/I can't find \*\*Remi Calder\*\*/);
    expect(thread.proposal?.employeeName, `"${answer}" did not keep the name as typed:\n${reply.content}`).toBe("Remi Calder");
  },
}));
