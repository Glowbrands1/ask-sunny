import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A TERMINATION'S REASON NEVER HOLDS THE REHIRE ANSWER (QA2's live R3, 21 Nov 2026; #1174's case)
 * ============================================================================
 *
 * An exit form for a termination (job abandonment) saved the reason line "terminated for job abandonment; not eligible for
 * rehire." The rehire answer has its own question ("Is this employee eligible for rehire?"): the reason is only the
 * reason, and the rehire question is answered No. Invented name: Rowan Kestrel.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA2's live R3 (21 Nov 2026), #1174's case: a termination's reason line saved \"…; not eligible for rehire.\"";
const SAID = "exit form for Rowan Kestrel, terminated for job abandonment, not eligible for rehire";

export const NOV21_AGENT_LOOP_EXIT_REASON_NOT_REHIRE_CASES: ReplayCase[] = [
  {
    id: "nov21-exit-termination-reason-not-rehire",
    title: `QA2's R3: "${SAID}" (the card's account carries the rehire answer): the reason is the reason only, and "Is this employee eligible for rehire?" is No`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) return { text: "Here's the Resignation/Exit Form for **Rowan Kestrel**." };
        return {
          tool: "propose_form",
          input: {
            template_key: "stc-exit", employee_id: "e-4", exit_type: "termination",
            exit_evidence: { ...evidenceFrom(view, "exit form for Rowan Kestrel"), kind: "asks_for_exit_form" },
            what_happened: "Terminated for job abandonment; not eligible for rehire.",
          },
        };
      }));
      const thread = t.thread();
      await thread.say(SAID);
      const id = await thread.create();
      const values = t.values(id);
      const checked = t.checked(id);
      const saved = JSON.stringify({ values, checked });
      expect(checked.resignation_type ?? [], `not a termination (the case proves nothing):\n${saved}`).toContain("immediate_involuntary_separation");
      expect(values.resignation_reason ?? "", `the reason holds the rehire answer:\n${saved}`).not.toMatch(/rehire/i);
      expect(values.resignation_reason ?? "", `the reason was lost:\n${saved}`).toMatch(/job abandonment/i);
      expect(checked.eligible_for_rehire ?? [], `the rehire question is not answered No:\n${saved}`).toEqual(["no"]);
    },
  },
];
