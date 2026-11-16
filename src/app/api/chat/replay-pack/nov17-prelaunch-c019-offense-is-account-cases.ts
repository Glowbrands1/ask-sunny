import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE OFFENSE THE MANAGER NAMED IS THE ACCOUNT, AND THE POLICY HINT (QA, 17 Nov 2026; the 266 re-run on train 3, c019)
 * ============================================================================
 *
 * c019 T2 (Runner 2's masked turns; names invented): "create corrective action for for <P> for Late Opening from the policy
 * manual. It is a verbal warning". The model proposed policy "Late Opening" and Verbal with no what_happened, and the
 * tool said policy_named_by_manager false and "ask what happened in one short question". The card never had an account,
 * so it was never ready (T2-T8), although the rules book says a short offense ("for late open") IS the account. Train 2
 * used "Late Opening." as the account.
 *
 * The general rule: when the card's policy is a manual heading the manager typed as the offense ("for Late Opening"), the
 * manager named that policy (policy_named_by_manager), and with no account from the model, the manager's own words for it
 * are the account. The heading is read from the manual, not from a word list. Covered too: a heading typed as the policy
 * only ("the Attendance policy") names the policy and is no account, and an account the model gave is never replaced.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's 266 re-run on launch train 3 (17 Nov 2026), c019: \"for Late Opening from the policy manual\" left the card with no account, never ready";
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
type Card = { policyLine?: string | null; awaitingIncident?: boolean; issue?: string | null } | null | undefined;
const card = (proposal: unknown) => proposal as Card;
type Facts = { facts?: { policy_named_by_manager?: boolean; account_from_named_offense?: unknown } } | undefined;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

export const NOV17_C019_CASES: ReplayCase[] = [
  {
    id: "nov17-c019-late-opening-named-is-the-account",
    title: "c019 T2: \"create corrective action for for Remy Calder for Late Opening from the policy manual. It is a verbal warning\" (the model gives policy Late Opening and Verbal, no account): the card's account is the manager's \"Late Opening\", the card is ready, and the manager named the policy",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const results: Facts[] = [];
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form");
        if (result) {
          results.push(result as Facts);
          return { text: "Here's the card." };
        }
        return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "create corrective action for for Remy Calder for Late Opening"), policy: "Late Opening", warning_level: "verbal", level_evidence: evidenceFrom(view, "It is a verbal warning") } };
      }));
      const thread = t.thread();
      await thread.say("create corrective action for for Remy Calder for Late Opening from the policy manual. It is a verbal warning");
      expect(thread.proposal?.employeeName).toBe("Remy Calder");
      expect(card(thread.proposal)?.policyLine ?? "").toMatch(/^Late Opening Policy/);
      expect(thread.proposal?.issue ?? "", "the offense the manager named is the account").toMatch(/Late Opening/);
      expect(card(thread.proposal)?.awaitingIncident ?? false, "the card still waits for an account").toBe(false);
      expect(results.at(-1)?.facts?.policy_named_by_manager ?? true, "the manager typed the cited heading").not.toBe(false);
      expect(results.at(-1)?.facts?.account_from_named_offense, "the reply is told where the account came from").toBeTruthy();
    },
  },
  {
    id: "nov17-c019-guard-policy-named-as-policy-is-no-account",
    title: "Guard: \"ca for Remy Calder, the Attendance policy\" with no account (the model gives policy Attendance): the policy is the manager's, but \"Attendance policy\" says nothing Remy did, so no account is made up and the card still waits for one",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const results: Facts[] = [];
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form");
        if (result) {
          results.push(result as Facts);
          return { text: "Here's the card. What happened?" };
        }
        return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "ca for Remy Calder"), policy: "Attendance" } };
      }));
      const thread = t.thread();
      await thread.say("ca for Remy Calder, the Attendance policy");
      expect(card(thread.proposal)?.policyLine ?? "").toMatch(/^Attendance Policy/);
      expect(thread.proposal?.issue ?? null, "an account was made up from the policy's name").toBeFalsy();
      expect(card(thread.proposal)?.awaitingIncident).toBe(true);
      expect(results.at(-1)?.facts?.policy_named_by_manager, "the manager named the Attendance policy").toBe(true);
    },
  },
  {
    id: "nov17-c019-guard-model-account-kept",
    title: "Guard: \"ca for Remy Calder for Late Opening, she opened at 10:20 on 11/14\" with the model's account: the account is the model's, never replaced by the policy's name",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) return { text: "Here's the card." };
        void said(view);
        return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "ca for Remy Calder"), policy: "Late Opening", what_happened: "She opened at 10:20 on 11/14.", incident_date: "2026-11-14" } };
      }));
      const thread = t.thread();
      await thread.say("ca for Remy Calder for Late Opening, she opened at 10:20 on 11/14");
      expect(thread.proposal?.issue ?? "").toMatch(/opened at 10:20 on 11\/14/);
      expect(thread.proposal?.issue ?? "").not.toMatch(/^Late Opening\.?$/);
    },
  },
];
