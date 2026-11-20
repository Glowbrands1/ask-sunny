import { expect, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A COACHING CARD'S POLICY IS ITS OWN, NEVER COPIED FROM ANOTHER FORM (Runner 2's c014 T6 on d7042447; QA 16 Nov 2026)
 * ============================================================================
 *
 * c014: a second CA ("This would be a verbal due to not completing her woven courses by the deadline") got "Standards of
 * Conduct", chosen by the model. Then "Create a Coaching Form from this conversation." sent template coaching with the
 * same policy, and the coaching card showed "Policy: Standards of Conduct Policy, JBA Policy Manual p.12" (also c200,
 * "Attendance" on a coaching card, unasked). The rule: a card other than a Corrective Action cites a manual heading only
 * when the manager named it in this card's request, or today's topic reader fits it to this card's own account. Otherwise
 * it is left off (not_on_card: policy_not_for_this_card). Invented names only (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Runner 2's c014 T6 on d7042447 (QA, 16 Nov 2026): a coaching card \"from this conversation\" inherited the CA's Standards of Conduct, never named for it";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T21:55:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
const said = (view: LoopView) => managerTurns(view).at(-1)?.text ?? "";
const quoted = (view: LoopView, quote: string) => ({ message_id: [...managerTurns(view)].reverse().find((turn) => turn.text.toLowerCase().includes(quote.toLowerCase()))?.messageIds?.at(-1) ?? "current", quote });
const policyOf = (proposal: unknown) => (proposal as ChatFormProposal | null)?.policyLine ?? null;
const ACCOUNT = "She did not complete her Woven courses by the deadline.";

export const NOV16_AGENT_LOOP_COACHING_POLICY_NOT_COPIED_CASES: ReplayCase[] = [
  {
    id: "nov16-coaching-policy-not-copied-c014",
    title: "c014 T6: a verbal CA for not completing Woven courses (the model picks Standards of Conduct), then \"Create a Coaching Form from this conversation.\" with the CA's policy copied: the copied heading is refused (policy_not_for_this_card, policy_copied) and the coaching card cites its own (Pau, 17 Nov: coaching always has a policy)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const results: Record<string, unknown>[] = [];
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const done = view.results.filter((result) => result.tool === "propose_form").map((result) => result.output);
        const coaching = /coaching form from this conversation/i.test(said(view));
        // Changed on purpose (QA item 7, 20 Nov 2026, the form lock): a different form for the card's person needs this turn's words asking for it (form_change_evidence).
        const base = { template_key: coaching ? "coaching" : "dpoa", employee_name: "Remy Calder", person_evidence: quoted(view, "Remy Calder"), what_happened: ACCOUNT, ...(coaching ? { form_change_evidence: quoted(view, "Create a Coaching Form from this conversation") } : { warning_level: "verbal", level_evidence: quoted(view, "This would be a verbal") }) };
        // Pau, 17 Nov: coaching always has policy and page. Told the copied heading is not this card's, the model picks its own.
        if (done.length === 1 && (done[0]!.facts as { policy_copied?: unknown } | undefined)?.policy_copied) return { tool: "propose_form", input: { ...base, policy: "Other — Woven courses not completed" } };
        if (done.length > 0) { results.push(...done); return { text: "Here's the card for **Remy Calder**." }; }
        return { tool: "propose_form", input: { ...base, policy: "Standards of Conduct" } };
      }));
      const thread = t.thread();
      const ca = await thread.say("Please create another corrective action for Remy Calder. This would be a verbal due to not completing her woven courses by the deadline");
      expect(policyOf(ca.formProposal), "the CA keeps the policy the model chose (CA cards always carry one)").toMatch(/Standards of Conduct/);
      const coaching = await thread.say("Create a Coaching Form from this conversation.");
      expect((coaching.formProposal as ChatFormProposal | undefined)?.templateKey).toBe("coaching");
      // Pau, 17 Nov: coaching always has policy and page (this case expected none before): never the copied CA heading.
      expect(JSON.stringify(results), "the copied heading was not refused").toContain("policy_not_for_this_card");
      expect(policyOf(coaching.formProposal) ?? "", `the coaching card has no policy: ${JSON.stringify(results.at(-1))}`).not.toBe("");
      expect(policyOf(coaching.formProposal), "the coaching card kept the copied CA heading").not.toMatch(/Standards of Conduct/);
    },
  },
  {
    id: "nov16-coaching-policy-not-copied-control-named",
    title: "Control: \"coaching for Remy Calder, she violated the attendance policy by being late on 11/14\" (the manager names it for this card) keeps Attendance on the coaching card",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
        ? { text: "Here's the Coaching Form for **Remy Calder**." }
        : { tool: "propose_form", input: { template_key: "coaching", employee_name: "Remy Calder", person_evidence: quoted(view, "Remy Calder"), what_happened: "She was late on 11/14.", incident_date: "2026-11-14", policy: "Attendance" } })));
      const reply = await t.thread().say("coaching for Remy Calder, she violated the attendance policy by being late on 11/14");
      expect(policyOf(reply.formProposal)).toMatch(/Attendance/);
    },
  },
  {
    id: "nov17-coaching-always-cites-a-policy-greeting-guests",
    title: "Pau, 17 Nov: \"coaching for Remy Calder on greeting guests\" with a model that leaves the policy out: propose_form says policy_not_given, and the card cites the fitting heading with its page",
    report: "Pau's ruling via QA, 17 Nov 2026: coaching cards always cite a policy and page, chosen like a CA's",
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const done = view.results.filter((result) => result.tool === "propose_form").map((result) => result.output);
        const base = { template_key: "coaching", employee_name: "Remy Calder", person_evidence: quoted(view, "Remy Calder"), what_happened: "Did not greet guests at the front desk." };
        if (done.length === 0) return { tool: "propose_form", input: base };
        if (done.length === 1 && (done[0]!.facts as { policy_not_given?: unknown } | undefined)?.policy_not_given) return { tool: "propose_form", input: { ...base, policy: "Standards of Conduct" } };
        return { text: "Here's the Coaching Form for **Remy Calder**." };
      }));
      const reply = await t.thread().say("coaching for Remy Calder on greeting guests");
      expect((reply.formProposal as ChatFormProposal | undefined)?.templateKey).toBe("coaching");
      expect(policyOf(reply.formProposal), "the coaching card has no policy and page").toMatch(/^Standards of Conduct Policy, JBA Policy Manual p\.\d+/);
    },
  },
];
