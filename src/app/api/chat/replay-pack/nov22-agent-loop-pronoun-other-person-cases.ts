import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * ANOTHER PERSON'S "THEY" IS NEVER THE CARD'S PERSON (QA's round 2, 22 Nov 2026, U23; port of Ask Bubbles #1014)
 * ============================================================================
 *
 * Found in Ask Bubbles, the same module in Sunny. The manager's turns (the person invented, the pack's roster): T1 "i need to create a corrective action for <P-pref> <P-last>", T5
 * "Multiple times she has talked about her boyfriend or ex boyfriend with customers, … Today, while checking out a
 * customer, she asked another employee what they would do if they had 8 arms and 8 legs. I could tell the customer was
 * very uncomfortable." The card's account read "<P> asked another employee what <P> would do if <P> had 8 arms and 8
 * legs": the name-for-pronoun rewrite took the other employee's "they". A pronoun of another kind than its reporter's
 * ("they" in a clause "she" reports) is someone else and stays (`reply-pronouns.ts`).
 */

const REPORT = "QA's round 2 (22 Nov 2026, U23; found in Ask Bubbles): \"she asked another employee what they would do\" became \"<P> asked another employee what <P> would do\"";
const T1 = "i need to create a corrective action for Juno Paxton";
const T5 = "Multiple times she has talked about her boyfriend or ex boyfriend with customers, she has stated that she takes medication for different things to customers, even stating that she was sick. Today, while checking out a customer, she asked another employee what they would do if they had 8 arms and 8 legs. I could tell the customer was very uncomfortable.";

export const NOV22_AGENT_LOOP_PRONOUN_OTHER_PERSON_CASES: ReplayCase[] = [
  {
    id: "nov22-r2-u23-other-employees-they-kept",
    title: "U23: \"… she asked another employee what they would do if they had 8 arms and 8 legs …\": the card's account names the card's person for \"she\" and keeps the other employee's \"they\"",
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) return { text: "Here's the Corrective Action Form for **Juno**." };
        return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-3", what_happened: "Today, while checking out a customer, she asked another employee what they would do if they had 8 arms and 8 legs.", incident_date: "2026-11-21", policy: headingWith(view, /standards of conduct/i), person_evidence: evidenceFrom(view, "Juno Paxton", 1) } };
      }));
      const thread = t.thread();
      await thread.say(T1);
      await thread.say(T5);
      const issue = (thread.proposal as { issue?: string } | null)?.issue ?? "";
      expect(issue, "the card has no account (the case proves nothing)").toMatch(/8 arms/);
      expect(issue, `the other employee's "they" became the card's person:\n${issue}`).toMatch(/another employee what they would do if they had 8 arms/);
    },
  },
];
