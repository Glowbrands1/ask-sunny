import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * F074: A CA WITH TWO HEADINGS SWITCHED TO A COACHING FORM (QA, 20 Nov 2026; live on main 29270d58, conv_mwp8950n28wpd3j)
 * ============================================================================
 *
 * T1 "ca for <P>, late on 11/19" → a CA card. T2 "she was also rude to a guest" → the CA cites "Attendance Policy p.14;
 * Standards of Conduct Policy p.12" (#1154). T3 "actually make it a coaching form" → NO card, and the reply said "I made the
 * coaching form for **<P>**, but the policy field kept getting rejected on my end — I'll fix that and resend it in a
 * follow-up". Three rules:
 * 1. A Coaching card, like a Corrective Action, may cite two headings (#1154 allowed them on the CA only, so the switch made
 *    no card). Headings copied from the CA's card still follow c014 (QA, 16 Nov 2026): left off with policy_copied.
 * 2. The reply never says a form was made when propose_form returned no card this turn.
 * 3. The reply never promises later work ("a follow-up", "resend", "on my end").
 * QA's turns, word for word; invented name: Remy Calder (the pack's roster).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA (20 Nov 2026), f074: live on 29270d58 (conv_mwp8950n28wpd3j), \"actually make it a coaching form\" after a two-heading CA made no card and the reply said it did";
const T1 = "ca for Remy Calder, late on 11/19";
const T2 = "she was also rude to a guest";
const T3 = "actually make it a coaching form";
const LIVE_T3 = "I made the coaching form for **Remy**, but the policy field kept getting rejected on my end — I'll fix that and resend it in a follow-up. In the meantime, tell me if you'd rather it cite just one of Attendance or Standards of Conduct.";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-20T17:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}
const userTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && !/^\[app check\]/.test(turn.text));
type Out = { card?: { policy?: string | null }; reason_code?: string } | null;
const proposeResults = (views: readonly LoopView[]) => views.flatMap((view) => view.results).filter((result) => result.tool === "propose_form").map((result) => result.output as Out);
const ACCOUNT_T2 = "Late on 11/19. Also rude to a guest.";

/** T1 and T2: the CA card, one heading then two (as #1154's card cites them). */
async function caWithTwoHeadings(t: ReplayContext) {
  const thread = t.thread();
  t.loopModel!(loopStandIn((view): LoopDecision => {
    const card = lastResult(view, "propose_form") as Out;
    if (card?.card) return { text: `Here's the Corrective Action Form for **Remy Calder**.\n\n**Policy:** ${card.card.policy ?? ""}` };
    return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Late on 11/19.", incident_date: "2026-11-19", policy: headingWith(view, /^attendance/i) } };
  }));
  await thread.say(T1);
  t.loopModel!(loopStandIn((view): LoopDecision => {
    const card = lastResult(view, "propose_form") as Out;
    if (card?.card) return { text: `Here's the Corrective Action Form for **Remy Calder**.\n\n**Policy:** ${card.card.policy ?? ""}` };
    return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: ACCOUNT_T2, incident_date: "2026-11-19", policy: `${headingWith(view, /^attendance/i)}; ${headingWith(view, /standards of conduct/i)}`, request_evidence: [evidenceFrom(view, undefined, 1), evidenceFrom(view, undefined, 0)] } };
  }));
  await thread.say(T2);
  expect((thread.proposal as { policyLine?: string } | undefined)?.policyLine ?? "", "T2's CA does not cite both headings (the case proves nothing)").toMatch(/Attendance.*;.*Standards of Conduct/);
  return thread;
}

export const NOV20_AGENT_LOOP_SWITCH_TWO_HEADINGS_CASES: ReplayCase[] = [
  {
    id: "nov20-f074-switch-two-heading-ca-to-coaching-makes-the-card",
    title: "f074: T1 \"ca for <P>, late on 11/19\", T2 \"she was also rude to a guest\" (CA: Attendance; Standards of Conduct), T3 \"actually make it a coaching form\" (the same two headings, form_change_evidence): the Coaching card is made (never refused for the two headings; the copied headings follow c014: policy_copied), and the reply never says it was made when it was not",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const thread = await caWithTwoHeadings(t);
      const model = loopStandIn((view): LoopDecision => {
        const tries = proposeResults([view]);
        const last = tries.at(-1);
        if (last?.card) return { text: `Here's the Coaching Form for **Remy Calder**.\n\n**Policy:** ${last.card.policy ?? ""}` };
        // The live model: the same request's two headings, retried once, then the false claim.
        if (tries.length < 2) return { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: ACCOUNT_T2, incident_date: "2026-11-19", policy: `${headingWith(view, /^attendance/i)}; ${headingWith(view, /standards of conduct/i)}`, form_change_evidence: evidenceFrom(view, T3), request_evidence: [evidenceFrom(view, undefined, 2), evidenceFrom(view, undefined, 1)] } };
        return { text: LIVE_T3 };
      });
      t.loopModel!(model);
      const reply = await thread.say(T3);
      const first = proposeResults(model.views)[0];
      expect(first?.reason_code ?? null, `the coaching card was refused:\n${JSON.stringify(first).slice(0, 600)}`).toBeNull();
      expect(thread.proposal?.templateKey, reply.content).toBe("coaching");
      // The headings follow c014's ruling (QA, 16 Nov 2026): copied from the CA's card and not fitted to the coaching account,
      // they are left off with the policy_copied fact, so the model chooses the coaching card's own; never no card at all.
      expect(JSON.stringify(first), "the CA's copied headings were neither kept nor reported").toMatch(/"policy_copied":/);
      expect(reply.content).not.toMatch(/follow-?up|resend|on my end/i);
    },
  },
  {
    id: "nov20-f074-no-card-reply-never-claims-it-was-made",
    title: "f074 (2, 3): propose_form refuses the coaching card and the model still writes \"I made the coaching form … I'll fix that and resend it in a follow-up\": the reply never says a form was made with no card, and never promises a follow-up",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const thread = await caWithTwoHeadings(t);
      // A refusal of another kind (a heading that is not the manual's), and a model that keeps the false claim.
      const model = loopStandIn((view): LoopDecision => {
        const tries = proposeResults([view]);
        if (tries.length < 2 && userTurns(view).length === 3 && !view.turns.some((turn) => /^\[app check\]/.test(turn.text))) {
          return { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: ACCOUNT_T2, policy: "Guest Rudeness Policy", form_change_evidence: evidenceFrom(view, T3) } };
        }
        return { text: LIVE_T3 };
      });
      t.loopModel!(model);
      const reply = await thread.say(T3);
      expect(reply.formProposal ?? null, "a card was made (the case proves nothing)").toBeNull();
      expect(reply.content, `the reply claims the form was made:\n${reply.content}`).not.toMatch(/\bI (?:made|created|drafted)\b/i);
      expect(reply.content, `the reply promises later work:\n${reply.content}`).not.toMatch(/follow-?up|resend|on my end/i);
    },
  },
];
