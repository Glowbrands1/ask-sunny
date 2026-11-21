import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE REPLY AND THE CARD WRITE THE PERSON'S POSSESSIVE AS THE SAVED WRITE-UP DOES (QA2's live R3 on cdb2ddc2, 21 Nov 2026)
 * ============================================================================
 *
 * The manager typed "…came into the salon to show her team her new puppy". #1145's saved Observation read "… to show the
 * team the new puppy", but the reply and the card's issue text read "to show Test's team Test's new puppy". Both now read
 * "to show the team the new puppy". The tester's "Test" is STAFF's invented Remy Calder.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA2's live R3 on cdb2ddc2 (21 Nov 2026): the reply and the card repeated \"Test's team Test's new puppy\"";
const SAID = "coaching for Remy Calder, she came into the salon to show her team her new puppy";
const ACCOUNT = "Remy came into the salon to show her team her new puppy.";

export const NOV21_AGENT_LOOP_POSSESSIVE_NOT_REPEATED_CASES: ReplayCase[] = [
  {
    id: "nov21-possessive-not-repeated-reply-and-card",
    title: `QA2's R3: "${SAID}": the reply and the card's issue read "to show the team the new puppy", never "Remy's team Remy's new puppy"`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => lastResult(view, "propose_form")
        ? { text: `Here's the Coaching Form for **Remy**. What happened: ${ACCOUNT}` }
        : {
            tool: "propose_form",
            input: {
              template_key: "coaching",
              employee_name: "Remy Calder",
              person_evidence: evidenceFrom(view, "Remy Calder"),
              what_happened: ACCOUNT,
              topic: "new puppy",
              topic_evidence: evidenceFrom(view, "new puppy"),
              incident_date: "2026-11-21",
            },
          }));
      const thread = t.thread();
      const reply = await thread.say(SAID);
      const issue = String((thread.proposal as { issue?: string } | undefined)?.issue ?? "");
      expect(issue, "the card has no issue (the case proves nothing)").toMatch(/new puppy/);
      for (const [where, text] of [["reply", reply.content], ["card issue", issue]] as const) {
        expect(text, `${where} repeats the possessive:\n${text}`).not.toMatch(/Remy's team Remy's/);
        expect(text, `${where} keeps a pronoun:\n${text}`).not.toMatch(/\bher\b/);
        expect(text, `${where}:\n${text}`).toMatch(/to show the team the new puppy/);
      }
    },
  },
];
