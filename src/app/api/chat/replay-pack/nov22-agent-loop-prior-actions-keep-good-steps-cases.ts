import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * ONE PRIOR STEP WITH A PROBLEM NEVER DROPS THE OTHERS (QA's round 2, 22 Nov 2026, U09; port of Ask Bubbles #1015)
 * ============================================================================
 *
 * Found in Ask Bubbles, the same code in Sunny. The manager's turns (the person invented, the pack's roster): T1 "create a written CA for <P6>." T2 "JBA Policy Manual 1-1-2026, Verbal CA
 * 11-1-2026. On 11-1-26 <P6> violated care and cleaning of facilities policy". The card kept NO prior action ("11-1-2026
 * is this incident's own date"), throwing away the manual acknowledgement of 1-1-2026 too. Each step is now checked on
 * its own: the good ones stay, and only the questioned one is left off, with its reason.
 */

const REPORT = "QA's round 2 (22 Nov 2026, U09; found in Ask Bubbles): prior_actions_not_kept threw away the whole line, including \"JBA Policy Manual 1-1-2026\"";
const T1 = "create a written CA for Remy Calder.";
const T2 = "JBA Policy Manual 1-1-2026, Verbal CA 11-1-2026. On 11-1-26 Remy Calder violated care and cleaning of facilities policy";

type Out = { card?: { prior_actions?: string | null }; facts?: { prior_steps_left_off?: { step: string; reason: string }[] } } | null;

export const NOV22_AGENT_LOOP_PRIOR_ACTIONS_KEEP_GOOD_STEPS_CASES: ReplayCase[] = [
  {
    id: "nov22-r2-u09-good-prior-step-kept",
    title: "U09: T2 \"JBA Policy Manual 1-1-2026, Verbal CA 11-1-2026. On 11-1-26 <P> violated …\": the manual step of 1-1-2026 stays on the card's Prior actions; only the Verbal CA dated the incident's day is left off, with its reason",
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) return { text: "Here's the Corrective Action Form for **Remy**." };
        const said = view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).at(-1)?.text ?? "";
        const level = { warning_level: "written", level_evidence: evidenceFrom(view, "written", said.startsWith("JBA") ? 1 : 0) };
        if (!said.startsWith("JBA")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", ...level, person_evidence: evidenceFrom(view, "Remy Calder") } };
        return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", ...level, what_happened: "On 11/1/26 Remy violated the care and cleaning of facilities policy.", incident_date: "2026-11-01", policy: headingWith(view, /care and cleaning/i), prior_actions: "JBA Policy Manual — 01/01/2026; Verbal CA — 11/01/2026", person_evidence: evidenceFrom(view, "Remy Calder") } };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say(T1);
      await thread.say(T2);
      const result = model.views.flatMap((view) => view.results.filter((entry) => entry.tool === "propose_form")).at(-1)?.output as Out;
      expect(result?.card?.prior_actions ?? "", `the good step was dropped:\n${JSON.stringify(result).slice(0, 600)}`).toMatch(/JBA Policy Manual — 01\/01\/2026/);
      expect(result?.card?.prior_actions ?? "", "the step dated the incident's day stayed").not.toMatch(/11\/01\/2026/);
      expect(result?.facts?.prior_steps_left_off?.[0]?.step ?? "", "the left-off step is not named").toMatch(/Verbal CA/);
    },
  },
];
