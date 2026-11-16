import { expect, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE OPEN CARD KEEPS ITS PAYROLL AFTER A REPLY WITH NO CARD (Runner 2's c163 on d7042447, QA 16 Nov 2026)
 * ============================================================================
 *
 * c163: payroll Yes was set at T4 ("yes" to "Payroll deduct isn't set; tell me if it applies"). T5 ("my DM told me she
 * gets one this month") got a reply with no card. T6 ("we have already done coaching") rebuilt the card with the same
 * account, and the model's payroll evidence (m4) was refused (evidence_after_card): with no card on the last reply,
 * nothing was "on screen", so the carry did not apply and payroll dropped to unset. The general rule: the chat's latest
 * card, rebuilt with the SAME account (a one-way key on the card record), is the open card, and keeps its payroll; a new
 * account (another incident) is a new card and carries nothing. Invented names only (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Runner 2's c163 on d7042447 (QA, 16 Nov 2026): payroll Yes set at T4 dropped to unset at T6 (\"we have already done coaching\") after a reply with no card";
const ACCOUNT = "Was below the company average last month in the following categories; PPTA, LPSVA, Club Close%, and spa %";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T21:50:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

/** The manager's own messages in the view (the app's self-check notes carry no message id). */
const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
const nth = (view: LoopView) => managerTurns(view).length;
/** Evidence quoting `quote` from the manager message that holds it (the latest one). */
function quoted(view: LoopView, quote: string) {
  const turn = [...managerTurns(view)].reverse().find((entry) => entry.text.toLowerCase().includes(quote.toLowerCase()));
  return { message_id: turn?.messageIds?.at(-1) ?? "current", quote };
}
const payrollOf = (proposal: unknown) => (proposal as ChatFormProposal | null)?.payrollDeduct ?? null;
const CARD_REPLY = "Here's the Corrective Action Form for **Remy Calder**. Payroll deduct isn't set; tell me if it applies.";
const BASE = { template_key: "dpoa", employee_name: "Remy Calder", what_happened: ACCOUNT, policy: "Other — Must See Behaviors" };
const withEvidence = (view: LoopView, extra: Record<string, unknown> = {}) => ({ ...BASE, person_evidence: quoted(view, "Remy Calder"), ...extra });
const verbal = (view: LoopView) => ({ warning_level: "verbal", level_evidence: quoted(view, "can you make a verbal warning Ca") });

/** c163's T1-T5 as the live model took them: the who-question, the card, Verbal, "yes" as payroll, a reply with no card. */
function c163Model(t6: (view: LoopView) => LoopDecision) {
  return loopStandIn((view): LoopDecision => {
    const turn = nth(view);
    if (turn === 1) return lastResult(view, "propose_form") ? { text: "Who is this Corrective Action Form for?" } : { tool: "propose_form", input: { template_key: "dpoa", policy: "Other — Must See Behaviors" } };
    if (turn === 5) return { text: "I've noted that, but it doesn't change any field on the card. The card above is still open; press Create when it looks right." };
    if (lastResult(view, "propose_form")) return { text: CARD_REPLY };
    if (turn === 2) return { tool: "propose_form", input: withEvidence(view) };
    if (turn === 3) return { tool: "propose_form", input: withEvidence(view, verbal(view)) };
    if (turn === 4) return { tool: "propose_form", input: withEvidence(view, { ...verbal(view), payroll_deduct: "yes", payroll_evidence: quoted(view, "yes") }) };
    return t6(view);
  });
}

async function throughT5(t: ReplayContext, t6: (view: LoopView) => LoopDecision) {
  start(t);
  t.loopModel!(c163Model(t6));
  const thread = t.thread();
  await thread.say("can you create a CA for must see behaviors");
  await thread.say(`Remy Calder ${ACCOUNT.charAt(0).toLowerCase()}${ACCOUNT.slice(1)}`);
  await thread.say("can you make a verbal warning Ca");
  await thread.say("yes");
  expect(payrollOf(thread.proposal), "payroll Yes did not reach the card at T4 (the case proves nothing)").toBe("yes");
  await thread.say("my DM told me she gets one this month");
  return thread;
}

export const NOV16_AGENT_LOOP_OPEN_CARD_KEEPS_PAYROLL_CASES: ReplayCase[] = [
  {
    id: "nov16-open-card-keeps-payroll-c163",
    title: "c163: payroll Yes (T4), a reply with no card (T5), then \"we have already done coaching\" rebuilds the same card (same account, prior actions added, the model's payroll evidence m4 refused): the card keeps payroll Yes",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = await throughT5(t, (view) => (lastResult(view, "propose_form") ? { text: CARD_REPLY } : { tool: "propose_form", input: withEvidence(view, { ...verbal(view), payroll_deduct: "yes", payroll_evidence: quoted(view, "yes"), prior_actions: "Coaching, date not given" }) }));
      await thread.say("we have already done coaching");
      expect(payrollOf(thread.proposal), "the open card's payroll was dropped by an edit that did not mention it").toBe("yes");
      expect((thread.proposal as ChatFormProposal | null)?.warningLevel).toBe("verbal");
    },
  },
  {
    id: "nov16-open-card-keeps-payroll-control-new-incident",
    title: "Control: after the same reply with no card, \"another ca for remy calder, she was rude to a guest on 11/14\" (a new account, no new_form_evidence from the model, no payroll) is a new card: no payroll carried",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = await throughT5(t, (view) => (lastResult(view, "propose_form") ? { text: CARD_REPLY } : { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: quoted(view, "remy calder"), what_happened: "She was rude to a guest on 11/14.", incident_date: "2026-11-14" } }));
      await thread.say("another ca for remy calder, she was rude to a guest on 11/14");
      expect(thread.proposal?.employeeName).toBe("Remy Calder");
      expect(payrollOf(thread.proposal), "a new incident's card inherited the earlier card's payroll").toBeNull();
    },
  },
  {
    id: "nov16-name-question-not-swallowed-c163",
    title: "c163 T3/T4 (QA's items 1 and 2): the manager typed \"Remy Calderon\" (the card holds the staff list's Remy Calder); at T3 the model calls propose_form with the typed name (Did you mean) and, in the same step, with the staff-list name: no card is made for the guessed name, and the reply ends with the Did-you-mean; at T4 \"yes\" confirms the name and is never also payroll Yes",
    report: `${REPORT}; QA's items 1 and 2 on c163: the Did-you-mean was swallowed at T3, and one "yes" was used as the name answer and payroll Yes`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const typed = "Remy Calderon";
      const results: Array<Record<string, unknown>> = [];
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const turn = nth(view);
        const done = view.results.filter((result) => result.tool === "propose_form").map((result) => result.output);
        const base = { template_key: "dpoa", what_happened: ACCOUNT, policy: "Other — Must See Behaviors", person_evidence: quoted(view, typed) };
        if (done.length > 0) {
          results.push(...done);
          const ask = done.map((result) => result.ask_exactly).find((question): question is string => typeof question === "string");
          return { text: done.some((result) => !result.reason_code) ? CARD_REPLY : `Set the level to Verbal.${ask ? `\n\n${ask}` : ""}` };
        }
        if (turn === 1) return { tool: "propose_form", input: { ...base, employee_id: "e-2" } };
        if (turn === 2) return { tools: [
          { tool: "propose_form", input: { ...base, employee_name: typed, ...verbal(view) } },
          { tool: "propose_form", input: { ...base, employee_name: "Remy Calder", ...verbal(view) } },
        ] };
        return { tool: "propose_form", input: { ...base, employee_name: "Remy Calder", ...verbal(view), payroll_deduct: "yes", payroll_evidence: quoted(view, "yes") } };
      }));
      const thread = t.thread();
      await thread.say(`${typed} ${ACCOUNT.charAt(0).toLowerCase()}${ACCOUNT.slice(1)}, a CA for must see behaviors`);
      const asked = await thread.say("can you make a verbal warning Ca");
      expect(asked.content, `T3 did not ask the Did-you-mean: ${asked.content}`).toMatch(/Did you mean \*\*Remy Calder\*\*\?/);
      expect(asked.formProposal ?? null, "a card was made for the guessed name before the manager answered").toBeNull();
      const confirmed = await thread.say("yes");
      expect(payrollOf(confirmed.formProposal ?? thread.proposal), `the "yes" to the name question was also taken as payroll Yes: ${JSON.stringify(results.at(-1))}`).toBeNull();
    },
  },
];
