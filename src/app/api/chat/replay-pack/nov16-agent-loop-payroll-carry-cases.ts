import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * PAYROLL STATED FOR THIS REQUEST STAYS ON THE CARD (QA, 16 Nov 2026; the 266 re-run's c022, per Coding-B)
 * ============================================================================
 *
 * c022 (Coding-B's #1069 shape, names invented; a roster name here so the case turns on payroll only): the card is made,
 * "payroll is deductable" puts Yes on it, and "she was caught vaping, given verbal warning" rebuilds it with the level,
 * but the payroll answer was dropped (the model cited it from the turn before, which the payroll evidence rule refuses,
 * or not at all). The general rule, as a stated level (#1056): the card record keeps the payroll answer and its amount,
 * and a rebuild of the same card in the same request keeps them. A later answer still belongs only to the card it
 * answered (PR 1c): a new request, or another person's card, never gets it.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's 266 re-run (16 Nov 2026), c022: the payroll stated at T3 was dropped from the card rebuilt at T4";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

type Card = { payrollDeduct?: string | null; payrollDeductAmount?: string | null; warningLevel?: string | null; employeeName?: string | null } | null | undefined;
const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
const card = (proposal: unknown) => proposal as Card;
const ACCOUNT = "She was caught vaping.";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

/** c022's turns: the card, the payroll answer, then the account with the level (the model's T4 payroll is `t4Payroll`). */
function c022Model(answer: string, t4Payroll: "cites-t3" | "none") {
  return loopStandIn((view): LoopDecision => {
    const text = said(view);
    const base = { template_key: "dpoa", employee_id: "e-2" };
    if (lastResult(view, "propose_form")) return { text: "Here's the card." };
    if (/^can you create/i.test(text)) return lastResult(view, "find_staff") ? { tool: "propose_form", input: base } : { tool: "find_staff", input: { name: "remy calder" } };
    if (text === answer) return { tool: "propose_form", input: { ...base, payroll_deduct: "yes", payroll_evidence: evidenceFrom(view, answer), ...(/\$\d/.test(answer) ? { payroll_amount: answer.replace(/[^\d.]/g, "") } : {}) } };
    return {
      tool: "propose_form",
      input: {
        ...base,
        what_happened: ACCOUNT,
        warning_level: "verbal",
        level_evidence: evidenceFrom(view, "given verbal warning"),
        ...(t4Payroll === "cites-t3" ? { payroll_deduct: "yes", payroll_evidence: evidenceFrom(view, answer, 1) } : {}),
      },
    };
  });
}

export const NOV16_PAYROLL_CARRY_CASES: ReplayCase[] = [
  ...([
    ["the-model-cites-t3", "cites-t3", "payroll is deductable"],
    ["the-model-gives-no-payroll", "none", "payroll is deductable"],
    ["with-the-amount", "none", "payroll is deductable, $20"],
  ] as const).map(([what, t4, answer]): ReplayCase => ({
    id: `nov16-payroll-carry-c022-${what}`,
    title: `c022 shape: Remy Calder's CA card, "${answer}" puts payroll on it, then "she was caught vaping, given verbal warning" rebuilds it with Verbal: the rebuilt card keeps the payroll answer${answer.includes("$") ? " and the $20" : ""} (${t4 === "cites-t3" ? "the model cites T3, which the evidence rule refuses" : "the model gives no payroll"})`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      t.loopModel!(c022Model(answer, t4));
      const thread = t.thread();
      await thread.say("can you create me a ca form for remy calder");
      expect(thread.proposal?.employeeName).toBe("Remy Calder");
      await thread.say(answer);
      expect(card(thread.proposal)?.payrollDeduct, "the payroll answer did not reach the card (the case proves nothing)").toBe("yes");
      await thread.say("she was caught vaping, given verbal warning");
      expect(card(thread.proposal)?.warningLevel).toBe("verbal");
      expect(card(thread.proposal)?.payrollDeduct, "the rebuilt card dropped the payroll stated for this request").toBe("yes");
      if (answer.includes("$")) expect(card(thread.proposal)?.payrollDeductAmount, "the rebuilt card dropped the amount").toBe("20");
    },
  })),
  {
    id: "nov16-payroll-carry-guard-new-request",
    title: "Guard (PR 1c): payroll answered for Remy Calder's card never reaches \"another ca for remy calder\" (new_form_evidence): the new card has no payroll",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const text = said(view);
        const base = { template_key: "dpoa", employee_id: "e-2" };
        if (lastResult(view, "propose_form")) return { text: "Here's the card." };
        if (/^can you create/i.test(text)) return lastResult(view, "find_staff") ? { tool: "propose_form", input: { ...base, what_happened: "She was late on 11/12.", incident_date: "2026-11-12" } } : { tool: "find_staff", input: { name: "remy calder" } };
        if (/^payroll/i.test(text)) return { tool: "propose_form", input: { ...base, what_happened: "She was late on 11/12.", incident_date: "2026-11-12", payroll_deduct: "yes", payroll_evidence: evidenceFrom(view) } };
        return { tool: "propose_form", input: { ...base, what_happened: ACCOUNT, incident_date: "2026-11-14", new_form_evidence: evidenceFrom(view, "another ca for remy calder") } };
      }));
      const thread = t.thread();
      await thread.say("can you create me a ca form for remy calder, she was late on 11/12");
      await thread.say("payroll is deductable");
      expect(card(thread.proposal)?.payrollDeduct).toBe("yes");
      await thread.say("another ca for remy calder, she was caught vaping on 11/14");
      expect(card(thread.proposal)?.payrollDeduct ?? null, "an earlier request's payroll answer reached a new request's card").toBeNull();
    },
  },
  {
    id: "nov16-payroll-carry-guard-another-person",
    title: "Guard: payroll answered for Remy Calder's card never reaches Juno Paxton's card in the same chat",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const text = said(view);
        if (lastResult(view, "propose_form")) return { text: "Here's the card." };
        if (/^can you create/i.test(text)) return lastResult(view, "find_staff") ? { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2" } } : { tool: "find_staff", input: { name: "remy calder" } };
        if (/^payroll/i.test(text)) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", payroll_deduct: "yes", payroll_evidence: evidenceFrom(view) } };
        return lastResult(view, "find_staff") ? { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-3", what_happened: ACCOUNT } } : { tool: "find_staff", input: { name: "juno paxton" } };
      }));
      const thread = t.thread();
      await thread.say("can you create me a ca form for remy calder");
      await thread.say("payroll is deductable");
      expect(card(thread.proposal)?.payrollDeduct).toBe("yes");
      await thread.say("now a ca for juno paxton, she was caught vaping");
      expect(thread.proposal?.employeeName).toBe("Juno Paxton");
      expect(card(thread.proposal)?.payrollDeduct ?? null, "Remy's payroll answer reached Juno's card").toBeNull();
    },
  },
  {
    id: "nov16-level-carry-guard-after-a-reply-with-no-card",
    title: "Guard (QA, with the payroll carry): Verbal on Remy Calder's card, then \"thanks\" (a reply with no card), then \"another ca for remy calder, she was rude to a guest on 11/14\" with no new_form_evidence and no level from the model: the new card does not inherit Verbal",
    report: "QA (16 Nov 2026): a level carries only while a card for this person is on screen",
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const text = said(view);
        if (/^thanks$/i.test(text)) return { text: "You're welcome." };
        if (lastResult(view, "propose_form")) return { text: "Here's the card." };
        if (/^verbal ca/i.test(text)) return lastResult(view, "find_staff") ? { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "She was late on 11/13.", incident_date: "2026-11-13", warning_level: "verbal", level_evidence: evidenceFrom(view, "verbal ca for remy calder") } } : { tool: "find_staff", input: { name: "remy calder" } };
        return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "She was rude to a guest on 11/14.", incident_date: "2026-11-14" } };
      }));
      const thread = t.thread();
      await thread.say("verbal ca for remy calder, she was late on 11/13");
      expect(card(thread.proposal)?.warningLevel).toBe("verbal");
      await thread.say("thanks");
      await thread.say("another ca for remy calder, she was rude to a guest on 11/14");
      expect(thread.proposal?.employeeName).toBe("Remy Calder");
      expect(card(thread.proposal)?.warningLevel ?? null, "a second CA after a reply with no card inherited the earlier card's level").toBeNull();
    },
  },
];
