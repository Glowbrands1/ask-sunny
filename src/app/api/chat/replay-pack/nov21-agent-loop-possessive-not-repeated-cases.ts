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
const SAID_TOLD = "coaching for Remy Calder. Her shift lead, Corin Vale, told her to go home and she refused";
const ACCOUNT_TOLD = "Her shift lead, Corin Vale, told her to go home and she refused.";

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
  {
    id: "nov21-told-listener-opening-possessive-plain",
    title: `QA2's R3 (#1168's case): "${SAID_TOLD}": the reply and the card read "The shift lead, Corin Vale, told Remy to go home and Remy refused", never "Remy's shift lead … told Remy … Remy refused"`,
    report: "QA2's live R3 on cdb2ddc2 (21 Nov 2026), #1168's case: \"Her shift lead told her to go home and she refused\" read \"Test's shift lead, <J>, told Test to go home and Test refused\"",
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => lastResult(view, "propose_form")
        ? { text: `Here's the Coaching Form for **Remy**. What happened: ${ACCOUNT_TOLD}` }
        : {
            tool: "propose_form",
            input: {
              template_key: "coaching",
              employee_name: "Remy Calder",
              person_evidence: evidenceFrom(view, "Remy Calder"),
              what_happened: ACCOUNT_TOLD,
              topic: "go home",
              topic_evidence: evidenceFrom(view, "go home"),
              incident_date: "2026-11-21",
            },
          }));
      const thread = t.thread();
      const reply = await thread.say(SAID_TOLD);
      const issue = String((thread.proposal as { issue?: string } | undefined)?.issue ?? "");
      expect(issue, "the card has no issue (the case proves nothing)").toMatch(/go home/);
      for (const [where, text] of [["reply", reply.content], ["card issue", issue]] as const) {
        expect(text, `${where} keeps a pronoun:\n${text}`).not.toMatch(/\b(?:her|she)\b/i);
        expect(text, `${where}:\n${text}`).toMatch(/The shift lead, Corin Vale, told Remy to go home and Remy refused/);
      }
    },
  },
];
