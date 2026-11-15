import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * BATCH K: THE GATE, "READY" AND CA-ONLY FIELDS (QA's 266-chat shadow replay, 15 Nov 2026)
 * ============================================================================
 *
 * K7 the past-forms privacy gate under-read explicit asks ("look for exit form <A>", "the coaching form … that we just
 * created can you pull it back up"). K10 the reply said "ready" over a card that was not. K11 a Coaching card made from
 * a CA conversation carried payroll = no, a CA-only field. Their wording; every person is invented.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's 266-chat shadow replay (batch K, 15 Nov 2026)";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

const resultsOf = (views: readonly { results: readonly { tool: string; output: Record<string, unknown> }[] }[], tool: string) =>
  views.flatMap((view) => view.results.filter((result) => result.tool === tool)).map((result) => JSON.stringify(result.output));

export const NOV15_AGENT_LOOP_BATCH_K_CASES: ReplayCase[] = [
  {
    id: "nov15-agent-loop-k10-ready-is-a-fact",
    title: "K10: propose_form's card carries ready (true only when card.status is ready); the rules book says \"ready\" only then",
    report: `${REPORT}: "the Coaching Form is ready" over a card with ready=false`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const standIn = loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: "Remy Calder was late on 11/12.", incident_date: "2026-11-12" } };
        return { text: "Here's the coaching form." };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("coaching form for remy calder, late on 11/12");
      const card = JSON.parse(resultsOf(standIn.views, "propose_form")[0] ?? "{}") as { card?: { status?: string; ready?: boolean } };
      expect(typeof card.card?.ready, "the card has no ready fact").toBe("boolean");
      expect(card.card?.ready).toBe(card.card?.status === "ready");
      expect(standIn.views[0]?.system ?? "", "the rules book lacks the ready line").toMatch(/only when propose_form's card\.status is "ready"/);
    },
  },
  {
    id: "nov15-agent-loop-k11-ca-only-fields-are-not-carried",
    title: "K11: a Coaching card made from a CA conversation carries no payroll (a CA-only field)",
    report: `${REPORT}: a Coaching card made from a CA conversation carried payroll = no`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) {
          const coaching = view.turns.some((turn) => /coaching/i.test(turn.text) && turn.role === "user" && /make a coaching/i.test(turn.text));
          return coaching
            ? { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: "Remy Calder was late on 11/12.", incident_date: "2026-11-12", payroll_deduct: "no", warning_level: "verbal" } }
            : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was late on 11/12.", incident_date: "2026-11-12", payroll_deduct: "no", warning_level: "verbal" } };
        }
        return { text: "Here's the form." };
      }));
      const thread = t.thread();
      await thread.say("ca for remy calder, late on 11/12, verbal, no payroll deduct");
      await thread.say("now make a coaching form for remy calder, same incident");
      expect(thread.proposal?.templateKey).toBe("coaching");
      const card = thread.proposal as { payrollDeduct?: string | null; warningLevel?: string | null } | null;
      expect(card?.payrollDeduct ?? null, "payroll was carried onto the Coaching card").toBeNull();
      expect(card?.warningLevel ?? null, "a warning level was carried onto the Coaching card").toBeNull();
    },
  },
];
