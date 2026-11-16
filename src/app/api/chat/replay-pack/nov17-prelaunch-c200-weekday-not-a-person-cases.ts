import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A WEEKDAY IS NOT A PERSON (QA, 17 Nov 2026; the 266 re-run on train 3, c200)
 * ============================================================================
 *
 * c200 T2 (Runner 2's masked turns; names invented): "<P> ast two Sunday shifts. Both Sundays, you were scheduled to arrive
 * at 9:30 AM but did not arrive until 9:40 AM". The coaching card's first propose_form came back with
 * account_names_other_person {name: "Both Sundays"}: the name reader took the capitalised pair for a person, and the
 * model proposed again (adding a policy). QA kept the Attendance citation (a manual section fits) and asked for this:
 * a name that holds a weekday, as the calendar names it, is no other person. Covered too: another person really named in
 * the account is still reported.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's 266 re-run on launch train 3 (17 Nov 2026), c200: \"Both Sundays\" was reported as another person named in the account";
const offline = process.env.AGENT_LOOP_LIVE !== "1";
type Facts = { facts?: { account_names_other_person?: { named?: { name?: { untrusted_text?: string } }[] } } } | undefined;
const namedOthers = (result: Facts) => (result?.facts?.account_names_other_person?.named ?? []).map((entry) => entry.name?.untrusted_text ?? "");
const userTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").length;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

/** c200: T1 asks who; T2 the account; the model's first propose_form has the account and no policy. */
function c200Model(account: string, results: Facts[]) {
  return loopStandIn((view): LoopDecision => {
    const result = lastResult(view, "propose_form");
    if (userTurns(view) === 1) return result ? { text: "Who is this Coaching Form for?" } : { tool: "propose_form", input: { template_key: "coaching" } };
    if (result) {
      results.push(result as Facts);
      return { text: "Here's the Coaching Form for **Remy**." };
    }
    return { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: account } };
  });
}

export const NOV17_C200_CASES: ReplayCase[] = [
  {
    id: "nov17-c200-both-sundays-is-not-a-person",
    title: "c200 T2: \"Remy Calder ast two Sunday shifts. Both Sundays, you were scheduled to arrive at 9:30 AM but did not arrive until 9:40 AM\": the coaching card's facts never name \"Both Sundays\" as another person",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const results: Facts[] = [];
      t.loopModel!(c200Model("The last two Sunday shifts, you were scheduled to arrive at 9:30 AM but did not arrive until 9:40 AM.", results));
      const thread = t.thread();
      await thread.say("Create a coaching form.");
      await thread.say("Remy Calder ast two Sunday shifts. Both Sundays, you were scheduled to arrive at 9:30 AM but did not arrive until 9:40 AM");
      expect(thread.proposal?.employeeName).toBe("Remy Calder");
      expect(results.length, "the card was never proposed").toBeGreaterThan(0);
      expect(namedOthers(results[0]), "a weekday was reported as another person").not.toContain("Both Sundays");
    },
  },
  {
    id: "nov17-c200-guard-another-person-still-named",
    title: "Guard: \"Remy Calder and Juno Paxton were late both Sundays …\": Juno Paxton is still reported as another person named in the account",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const results: Facts[] = [];
      t.loopModel!(c200Model("Remy Calder and Juno Paxton were late both Sundays. Both Sundays, they were scheduled to arrive at 9:30 AM but did not arrive until 9:40 AM.", results));
      const thread = t.thread();
      await thread.say("Create a coaching form.");
      await thread.say("Remy Calder and Juno Paxton were late both Sundays. Both Sundays, they were scheduled to arrive at 9:30 AM but did not arrive until 9:40 AM");
      expect(namedOthers(results[0])).toContain("Juno Paxton");
      expect(namedOthers(results[0])).not.toContain("Both Sundays");
    },
  },
];
