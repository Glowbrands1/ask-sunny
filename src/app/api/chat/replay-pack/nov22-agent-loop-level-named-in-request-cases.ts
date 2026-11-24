import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A REQUEST THAT NAMES THE LEVEL IS THE LEVEL'S EVIDENCE (port from Ask Bubbles #1028, U16; its QA's round 2, 22 Nov 2026)
 * ============================================================================
 *
 * The manager's turns (the person Sunny's invented Remy Calder): T1 "put up the verbal CA for <P6>", T2 "create a verbal
 * CA for <P6> with all the same information given". T2's card said "Warning level isn't set" (the model passed no level
 * evidence: level_not_stated) while the saved draft had Verbal. QA: guide the loop. The rules book and the level_evidence
 * description now say a request naming the level ("a verbal CA") states it, and the model quotes it.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Port from Ask Bubbles (#1028; its QA's round 2, U16): \"create a verbal CA for <P6> with all the same information given\" got \"Warning level isn't set\"";
const T1 = "put up the verbal CA for Remy Calder";
const T2 = "create a verbal CA for Remy Calder with all the same information given";
const RULE = /A request that names the level itself is that level's evidence/;
const LIVE = process.env.AGENT_LOOP_LIVE === "1";
/** A reply sentence that says the LEVEL is not set (a payroll question is not one). */
const levelNotSet = (reply: string) => reply.split(/(?<=[.!?;])\s+|\n+/).filter((sentence) => /\blevel\b/i.test(sentence) && /\b(?:isn't|aren't|is not|are not|not)\s+set\b/i.test(sentence));

export const NOV22_AGENT_LOOP_LEVEL_NAMED_IN_REQUEST_CASES: ReplayCase[] = [
  {
    id: "nov22-r2-u16-verbal-ca-request-states-the-level",
    title: "U16: T2 \"create a verbal CA for <P6> with all the same information given\": the rules book says the request names the level; the card keeps Verbal (quoted from \"a verbal CA\") and never says the level isn't set",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form") as { card?: { warning_level?: string | null } } | null;
        if (result) return { text: result.card?.warning_level ? `Here's the Corrective Action Form for **Remy**. **Type of Warning:** ${result.card.warning_level === "verbal" ? "Verbal" : "Written"} Warning, as you said.` : "Here's the Corrective Action Form for **Remy**. Warning level isn't set; tell me if it applies." };
        // The live model's level on T2 quoted words that do not state it (level_not_stated); with the rule it quotes "verbal CA".
        const level = { warning_level: "verbal", level_evidence: evidenceFrom(view, RULE.test(view.system) ? "verbal CA" : "with all the same information given") };
        return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", ...level, person_evidence: evidenceFrom(view, "Remy Calder") } };
      }));
      const thread = t.thread();
      await thread.say(T1);
      const reply = await thread.say(T2);
      expect(thread.proposal?.warningLevel, `the card lost the level the request named:\n${reply.content}`).toBe("verbal");
      // QA's live run (22 Nov 2026): the card had Verbal and the reply's "isn't set" was payroll's ("Payroll deduct isn't
      // set; tell me if it applies."). The bug is the LEVEL said to be unset; the stand-in's whole-reply check stays on its run.
      expect(levelNotSet(reply.content), `the reply says the level isn't set:\n${reply.content}`).toEqual([]);
      if (!LIVE) expect(reply.content).not.toMatch(/isn't set/i);
    },
  },
];
