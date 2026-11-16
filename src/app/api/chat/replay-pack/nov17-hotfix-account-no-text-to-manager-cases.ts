import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE ACCOUNT NEVER HOLDS TEXT TO THE MANAGER (QA hotfix, 17 Nov 2026; live on main d7042447)
 * ============================================================================
 *
 * After train 4's c019 change ("for Late Opening" is the account), the model wrote the reply's helper line INTO the
 * account, so it would be saved on the form:
 * - Runner 2's 266, c019: "Late Opening. — that's your words for the offense; add any details before you press Create."
 * - the live tester's r2: "Late Opening. (from the offense you named - add more detail before Create if you'd like)".
 * The general rules: (1) when the offense the manager named is the account, the account is exactly their words for it
 * and a period, whatever the model wrote; (2) no account holds a sentence that speaks to the manager: a sentence with
 * second-person words the manager never typed is taken out (read against the manager's own messages, not a phrase list).
 * Controls: a manager's account quoting "you" ("she told the guest 'you can wait'") and c200's "you were scheduled to
 * arrive" are kept. Names invented.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA hotfix (17 Nov 2026): the helper note was written into the Observation (Runner 2's c019; live tester r2)";
const offline = process.env.AGENT_LOOP_LIVE !== "1";
type Card = { issue?: string | null } | null | undefined;
const card = (proposal: unknown) => proposal as Card;
const userTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").length;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const C019 = "create corrective action for for Remy Calder for Late Opening from the policy manual. It is a verbal warning";

/** c019 T2: the first call has no account; the second (same turn) writes the helper line into what_happened. */
function c019Model(helperAccount: string) {
  return loopStandIn((view): LoopDecision => {
    const proposals = view.results.filter((result) => result.tool === "propose_form").length;
    const base = { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "create corrective action for for Remy Calder for Late Opening"), policy: "Late Opening", warning_level: "verbal", level_evidence: evidenceFrom(view, "It is a verbal warning") };
    if (proposals === 0) return { tool: "propose_form", input: base };
    if (proposals === 1) return { tool: "propose_form", input: { ...base, what_happened: helperAccount } };
    return { text: "Here's the card." };
  });
}

export const NOV17_HOTFIX_ACCOUNT_CASES: ReplayCase[] = [
  ...([
    ["c019-runner2", "Late Opening. — that's your words for the offense; add any details before you press Create."],
    ["r2-live", "Late Opening. (from the offense you named - add more detail before Create if you'd like)"],
  ] as const).map(([what, helper]): ReplayCase => ({
    id: `nov17-hotfix-account-${what}-helper-note-not-saved`,
    title: `${what}: "${C019}", then the model writes "${helper}" as the account: the card's account is exactly "Late Opening."`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      t.loopModel!(c019Model(helper));
      const thread = t.thread();
      await thread.say(C019);
      expect(card(thread.proposal)?.issue, "text to the manager was put in the account").toBe("Late Opening.");
    },
  })),
  {
    id: "nov17-hotfix-account-control-quoted-you-kept",
    title: "Control: \"ca for Remy Calder, she told the guest 'you can wait' and walked away from the front desk on 11/14\": the account quoting \"you\" is kept",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) return { text: "Here's the card." };
        return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "ca for Remy Calder"), what_happened: "She told the guest 'you can wait' and walked away from the front desk on 11/14.", incident_date: "2026-11-14" } };
      }));
      const thread = t.thread();
      await thread.say("ca for Remy Calder, she told the guest 'you can wait' and walked away from the front desk on 11/14");
      expect(card(thread.proposal)?.issue ?? "").toContain("you can wait");
    },
  },
  {
    id: "nov17-hotfix-account-control-c200-you-were-scheduled-kept",
    title: "Control (c200's account): \"Both Sundays, you were scheduled to arrive at 9:30 AM but did not arrive until 9:40 AM\" is the manager's own second person, and is kept",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form");
        if (userTurns(view) === 1) return result ? { text: "Who is this Coaching Form for?" } : { tool: "propose_form", input: { template_key: "coaching" } };
        if (result) return { text: "Here's the card." };
        return { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: "The last two Sunday shifts, you were scheduled to arrive at 9:30 AM but did not arrive until 9:40 AM." } };
      }));
      const thread = t.thread();
      await thread.say("Create a coaching form.");
      await thread.say("Remy Calder ast two Sunday shifts. Both Sundays, you were scheduled to arrive at 9:30 AM but did not arrive until 9:40 AM");
      expect(card(thread.proposal)?.issue ?? "").toContain("you were scheduled to arrive at 9:30 AM");
    },
  },
];
