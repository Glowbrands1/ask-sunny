import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * F077: A TERMINATION'S REASON IS ONLY THE REASON; ITS DETAILS NEVER SAY "GAVE NOTICE" (QA, 20 Nov 2026; #1139 live)
 * ============================================================================
 *
 * "exit form for <P>, terminated for job abandonment, last day 11/18, notice given 11/17, not eligible for rehire" (saved
 * draft cd69d389): (1) the reason line saved the whole card account, "job abandonment; last day 11/18, notice given
 * 11/17", though the dates have their own fields; (2) the AI-written Details said "<P> gave notice on 11/17 and the last day
 * worked was 11/18", which reads as a resignation on a termination. General rule: the reason line is the account without
 * the parts the form's own date fields hold; on a stated involuntary separation, a Details sentence that says the employee
 * gave notice or resigned becomes the form's own wording ("Notice date recorded: 11/17"). QA's wording; invented name.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA (20 Nov 2026), f077: #1139's live run (draft cd69d389, conv_mwpbqgce2chegin) saved the dates in the reason and \"gave notice\" in a termination's Details";
const SAID = "exit form for Rowan Kestrel, terminated for job abandonment, last day 11/18, notice given 11/17, not eligible for rehire";

export const NOV20_AGENT_LOOP_EXIT_REASON_ONLY_CASES: ReplayCase[] = [
  {
    id: "nov20-f077-termination-reason-only-and-no-gave-notice",
    title: "f077: \"exit form for <P>, terminated for job abandonment, last day 11/18, notice given 11/17, not eligible for rehire\": the reason is \"job abandonment\" only, and Details never says the employee gave notice",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-20T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) return { text: "Here's the Resignation/Exit Form for **Rowan Kestrel**." };
        return {
          tool: "propose_form",
          input: {
            template_key: "stc-exit", employee_id: "e-4", exit_type: "termination", effective_date: "11/18",
            exit_evidence: { ...evidenceFrom(view, "exit form for Rowan Kestrel"), kind: "asks_for_exit_form" },
            what_happened: "Job abandonment; last day 11/18, notice given 11/17.",
          },
        };
      }));
      // The live drafting model's Details (draft cd69d389).
      t.draftWrites({ details: "Rowan gave notice on 11/17 and the last day worked was 11/18. Rowan was terminated for job abandonment." });
      const thread = t.thread();
      await thread.say(SAID);
      const id = await thread.create();
      const values = t.values(id);
      const saved = JSON.stringify({ values, checked: t.checked(id) });
      expect(t.checked(id).resignation_type ?? [], `not a termination (the case proves nothing):\n${saved}`).toContain("immediate_involuntary_separation");
      expect((values.resignation_reason ?? "").trim(), `the reason holds more than the reason:\n${saved}`).toMatch(/^job abandonment\.?$/i);
      expect(values.details ?? "", `Details says the employee gave notice on a termination:\n${saved}`).not.toMatch(/gave (?:her |his |their )?notice|resigned/i);
      expect(values.details ?? "", `Details lost the notice date:\n${saved}`).toMatch(/11\/17/);
    },
  },
];
