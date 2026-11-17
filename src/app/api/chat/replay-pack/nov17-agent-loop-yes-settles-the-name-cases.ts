import { expect, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A "YES" TO THE DID-YOU-MEAN SETTLES THE PERSON (Runner 2's c163 on main 33863575; QA, 17 Nov 2026)
 * ============================================================================
 *
 * c163 after #1087's ruling (b): T2 ("<first> <last minus a letter> was below the company average …") rightly asked
 * "Did you mean **<A>**?". T3 ("can you make a verbal warning Ca") did not answer it, but was read as the answer: the card
 * was built under the staff-list name (and the level, read as "the answer", was refused). T4's "yes" then answered
 * nothing, so the Did-you-mean was asked again (three asks in the chat), and T6's "we have already done coaching" got
 * "I'll add it as a prior action once the name is settled". The rule: a "yes" to this chat's recorded Did-you-mean settles
 * that person for every later turn, and no card is built under the offered name before the answer. Invented names only
 * (Remy Calder on the pack's staff list; "Remy Caldr" typed).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Runner 2's c163 on main 33863575 (QA, 17 Nov 2026): the manager's \"yes\" to the Did-you-mean was not accepted and the question was asked three times; the card was built under the offered name before the answer; the prior coaching was never added";
const TYPED = "Remy Caldr";
const ACCOUNT = "Was below the company average last month in the following categories; PPTA, LPSVA, Club Close%, and spa %";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-17T08:20:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
const quoted = (view: LoopView, quote: string) => ({ message_id: [...managerTurns(view)].reverse().find((turn) => turn.text.toLowerCase().includes(quote.toLowerCase()))?.messageIds?.at(-1) ?? "current", quote });
const said = (view: LoopView, words: string) => managerTurns(view).some((turn) => turn.text.toLowerCase().includes(words.toLowerCase()));
const card = (reply: { formProposal?: unknown }) => (reply.formProposal as ChatFormProposal | undefined) ?? null;

/**
 * The live model on every turn: propose_form for the staff-list person, the typed spelling as its evidence, with what the
 * manager has said so far (the level once said, prior coaching once said). It replies with the tool's own question when
 * refused, else the card; at T5 (no card change) it only answers.
 */
function liveModel() {
  return loopStandIn((view): LoopDecision => {
    const result = [...view.results].reverse().find((entry) => entry.tool === "propose_form")?.output;
    if (result) return { text: typeof result.ask_exactly === "string" ? result.ask_exactly : "Here's the Corrective Action Form for **Remy Calder**." };
    if (managerTurns(view).length === 1) return { text: "Who is this Corrective Action Form for?" };
    if (managerTurns(view).at(-1)?.text.startsWith("my DM")) return { text: "Noted; that doesn't change the card." };
    return {
      tool: "propose_form",
      input: {
        template_key: "dpoa",
        employee_name: managerTurns(view).at(-1)?.text === "no" ? TYPED : "Remy Calder",
        person_evidence: quoted(view, TYPED),
        what_happened: ACCOUNT,
        policy: "Other — Must See Behaviors",
        ...(said(view, "verbal warning") ? { warning_level: "verbal", level_evidence: quoted(view, "can you make a verbal warning Ca") } : {}),
        ...(said(view, "already done coaching") ? { prior_actions: "Coaching, date not given" } : {}),
      },
    };
  });
}

/**
 * Runner 2's c163 trace on main 33863575, call for call: T2 find_staff with the typed name; T3 propose_form with the TYPED
 * name, the level from T3; T4 ("yes") find_staff for the staff-list name, propose_form by employee_id with the level, and
 * propose_form by name with "yes" as the person evidence; T5 propose_form; T6 two propose_forms with the prior coaching.
 * A guard for the yes and the turns after it: in this harness T3's typed name is asked again (production seated the
 * staff-list person there, the T3-as-answer bug the case above fails on before the fix).
 */
function traceModel() {
  return loopStandIn((view): LoopDecision => {
    const turn = managerTurns(view).length;
    const done = view.results.filter((entry) => entry.tool === "propose_form" || entry.tool === "find_staff").map((entry) => entry.output);
    const level = { warning_level: "verbal", level_evidence: quoted(view, "can you make a verbal warning Ca") };
    const base = { template_key: "dpoa", what_happened: ACCOUNT, policy: "Other — Must See Behaviors" };
    if (done.length > 0) {
      const ask = done.map((output) => output.ask_exactly).find((question): question is string => typeof question === "string");
      const made = view.results.some((entry) => entry.tool === "propose_form" && !entry.output.reason_code);
      return { text: made ? "Here's the Corrective Action Form for **Remy Calder**." : ask ?? "Noted." };
    }
    if (turn === 1) return { text: "Who is this Corrective Action Form for?" };
    if (turn === 2) return { tool: "find_staff", input: { name: TYPED, person_evidence: quoted(view, TYPED) } };
    if (turn === 3) return { tool: "propose_form", input: { ...base, employee_name: TYPED, person_evidence: quoted(view, TYPED), ...level } };
    if (turn === 4) return { tools: [
      { tool: "find_staff", input: { name: "Remy Calder", person_evidence: quoted(view, "yes") } },
      { tool: "propose_form", input: { ...base, employee_id: "e-2", ...level } },
      { tool: "propose_form", input: { ...base, employee_name: "Remy Calder", person_evidence: quoted(view, "yes"), ...level } },
    ] };
    if (turn === 5) return { tool: "propose_form", input: { ...base, employee_name: "Remy Calder", person_evidence: quoted(view, TYPED), ...level } };
    return { tools: [
      { tool: "propose_form", input: { ...base, employee_name: "Remy Calder", person_evidence: quoted(view, TYPED), ...level, prior_actions: "Coaching, date not given" } },
      { tool: "propose_form", input: { ...base, employee_id: "e-2", ...level, prior_actions: "Coaching, date not given" } },
    ] };
  });
}

const DID_YOU_MEAN = /Did you mean \*\*Remy Calder\*\*\?/;

export const NOV17_AGENT_LOOP_YES_SETTLES_THE_NAME_CASES: ReplayCase[] = [
  {
    id: "nov17-yes-to-did-you-mean-settles-the-name-c163",
    title: "c163: \"can you create a CA for must see behaviors\", \"Remy Caldr was below …\" (Did you mean Remy Calder?), \"can you make a verbal warning Ca\" (no card before the answer), \"yes\" (settled: the card, Verbal, never asked again), \"my DM told me she gets one this month\", \"we have already done coaching\" (the prior coaching is on the card)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(liveModel());
      const thread = t.thread();
      await thread.say("can you create a CA for must see behaviors");
      const t2 = await thread.say(`${TYPED} ${ACCOUNT.charAt(0).toLowerCase()}${ACCOUNT.slice(1)}`);
      expect(t2.content, "T2 did not ask the Did-you-mean").toMatch(DID_YOU_MEAN);
      expect(card(t2), "T2 seated the offered person before the answer").toBeNull();
      const t3 = await thread.say("can you make a verbal warning Ca");
      expect(card(t3)?.employeeName ?? null, "T3 built the card under the offered name before the manager answered").toBeNull();
      const t4 = await thread.say("yes");
      expect(t4.content, "the manager's yes was not accepted: the Did-you-mean was asked again").not.toMatch(DID_YOU_MEAN);
      expect(card(t4)?.employeeName, `T4: ${t4.content}`).toBe("Remy Calder");
      expect(card(t4)?.warningLevel, "the level said while the question was open did not reach the card").toBe("verbal");
      expect(card(t4)?.payrollDeduct ?? null, "the yes to the name was also taken as payroll Yes").toBeNull();
      const t5 = await thread.say("my DM told me she gets one this month");
      expect(t5.content).not.toMatch(DID_YOU_MEAN);
      const t6 = await thread.say("we have already done coaching");
      expect(t6.content, "the name was asked about again after the yes").not.toMatch(DID_YOU_MEAN);
      expect(card(t6)?.employeeName).toBe("Remy Calder");
      expect(card(t6)?.priorActions ?? "", "the prior coaching was never added").toMatch(/Coaching/);
    },
  },
  {
    id: "nov17-yes-to-did-you-mean-settles-the-name-c163-trace",
    title: "c163 as Runner 2's trace on 33863575 shows it, call for call (T3 proposes the typed name; T4 \"yes\" makes three calls; T6 two): no card before the yes, the yes settles Remy Calder with Verbal, and the prior coaching is added at T6 with no Did-you-mean after the yes",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(traceModel());
      const thread = t.thread();
      await thread.say("can you create a CA for must see behaviors");
      const t2 = await thread.say(`${TYPED} ${ACCOUNT.charAt(0).toLowerCase()}${ACCOUNT.slice(1)}`);
      expect(t2.content).toMatch(DID_YOU_MEAN);
      const t3 = await thread.say("can you make a verbal warning Ca");
      expect(card(t3)?.employeeName ?? null, `T3 seated a person before the answer: ${t3.content}`).toBeNull();
      const t4 = await thread.say("yes");
      expect(t4.content, "the yes was not accepted").not.toMatch(DID_YOU_MEAN);
      expect(card(t4)?.employeeName, t4.content).toBe("Remy Calder");
      expect(card(t4)?.warningLevel).toBe("verbal");
      await thread.say("my DM told me she gets one this month");
      const t6 = await thread.say("we have already done coaching");
      expect(t6.content, "asked about the name again after the yes").not.toMatch(DID_YOU_MEAN);
      expect(card(t6)?.priorActions ?? "", `the prior coaching was never added: ${t6.content}`).toMatch(/Coaching/);
    },
  },
  {
    id: "nov17-no-after-an-unanswered-turn-keeps-the-typed-name",
    title: "Control: the Did-you-mean, a turn that does not answer it, then \"no\" (the model proposes the name as typed): the no is the answer, so the name is kept as typed and not asked about again, never Remy Calder",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(liveModel());
      const thread = t.thread();
      await thread.say("can you create a CA for must see behaviors");
      await thread.say(`${TYPED} ${ACCOUNT.charAt(0).toLowerCase()}${ACCOUNT.slice(1)}`);
      await thread.say("can you make a verbal warning Ca");
      const answer = await thread.say("no");
      expect(answer.content, "the no was not read as the answer: the Did-you-mean was asked again").not.toMatch(DID_YOU_MEAN);
      expect(card(answer)?.employeeName ?? null, `the name was not kept as typed: ${answer.content}`).toBe(TYPED);
    },
  },
];
