import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * AN EXIT CARD'S REASON IS THE MANAGER'S OWN WORDS (QA's live L6 on prod 14fed8c, 22 Nov 2026)
 * ============================================================================
 *
 * "exit form for Test Testy, terminated for job abandonment, not eligible for rehire": the model wrote what_happened "job
 * abandonment", so the card's What happened and the saved resignation_reason read "job abandonment", not the manager's
 * "terminated for job abandonment". The account the model gives, when it is part of one clause the manager typed, is that
 * whole clause. Invented name: Rowan Kestrel (the tester's "Test Testy").
 */

const FLAG = "AGENT_LOOP_ENABLED";
const SAID = "exit form for Rowan Kestrel, terminated for job abandonment, not eligible for rehire";

export const NOV22_AGENT_LOOP_EXIT_REASON_MANAGER_WORDS_CASES: ReplayCase[] = [
  {
    id: "nov22-l6-exit-reason-manager-words",
    title: `L6: "${SAID}" with the model's what_happened "job abandonment": the card and the saved reason read "terminated for job abandonment"`,
    report: "QA's live L6 on prod 14fed8c (22 Nov 2026): the exit card and saved resignation_reason read \"job abandonment\"",
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) return { text: "Here's the Resignation/Exit Form for **Rowan Kestrel**." };
        return {
          tool: "propose_form",
          input: {
            template_key: "stc-exit", employee_id: "e-4", exit_type: "termination",
            exit_evidence: { ...evidenceFrom(view, "exit form for Rowan Kestrel"), kind: "asks_for_exit_form" },
            what_happened: "job abandonment",
          },
        };
      }));
      const thread = t.thread();
      await thread.say(SAID);
      const issue = String((thread.proposal as { issue?: string } | undefined)?.issue ?? "");
      expect(issue, "the card's What happened").toMatch(/terminated for job abandonment/i);
      const id = await thread.create();
      const values = t.values(id);
      const checked = t.checked(id);
      const saved = JSON.stringify({ values, checked });
      expect(checked.resignation_type ?? [], `not a termination (the case proves nothing):\n${saved}`).toContain("immediate_involuntary_separation");
      expect(values.resignation_reason ?? "", saved).toMatch(/^terminated for job abandonment\.?$/i);
      expect(checked.eligible_for_rehire ?? [], saved).toEqual(["no"]);
    },
  },
];
