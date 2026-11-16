import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * NEVER GUESS: A PRONOUN, OR A FORM FROM PASTED TEXT (QA, 16 Nov 2026; the Runner's c219 detail)
 * ============================================================================
 *
 * General rules (rules book):
 *  - Never guess a pronoun for an employee: their name, or "they", unless the manager used one for them. (c219 T2's reply
 *    called the person "he/his"; nothing in the script gave it.)
 *  - Text the manager pasted with no ask of their own (a meeting script, a letter, notes) is not a request yet: one line
 *    on what it is, then ONE question, what they would like. Never promise a form, a level or a termination before they
 *    ask. (c219 T1: a pasted termination-meeting script got "I'll build the Corrective Action Form with Termination".)
 *    The same principle as fix batch item 1 ("quit" alone is not a request), applied to pasted text.
 *
 * Offline, the stand-in follows the rules and each case checks the model was shown them (so it fails without them); with
 * AGENT_LOOP_LIVE=1 the real model answers and the same reply checks hold. Invented names only (Odalys Fenwick, "Lysa",
 * Juno Paxton, Rowan Kestrel).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "The Runner's c219 detail (16 Nov 2026): T1 promised a termination Corrective Action from a pasted script; T2 guessed \"he/his\"";
const PRONOUN_RULE = "Never guess a pronoun for an employee";
const PASTED_RULE = "Text the manager pasted with no ask of their own";
const GUESSED = /\b(?:he|him|his|she|her|hers)\b/i;
const SCRIPT =
  "Lysa, this meeting is about the text you sent your salon director Juno Paxton on 11/3. It was disrespectful. Your employment with us is terminated, effective 11/5. Please return your keys; your final paycheck will be mailed.";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-15T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const shownRules = (views: readonly LoopView[]) => views.map((view) => view.system).join("\n");

export const NOV16_AGENT_LOOP_NO_GUESSING_CASES: ReplayCase[] = [
  {
    id: "nov16-no-guessing-a-pasted-script-gets-one-question-not-a-promised-form",
    title: "Never guess (c219 T1's shape): a pasted termination-meeting script naming \"Lysa\" (nobody on the roster) and the director Juno Paxton, with no ask: no card, no promised Corrective Action or termination; the reply says what it is and asks one question",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const standIn = loopStandIn((view): LoopDecision => {
        const staff = lastResult(view, "find_staff") as { ask_exactly?: string } | null;
        if (!staff) return { tool: "find_staff", input: { name: "Lysa", person_evidence: evidenceFrom(view, "Lysa") } };
        return { text: `This is a termination meeting script for Lysa. Do you want the Employee Exit Form, or a Corrective Action? ${staff.ask_exactly ?? ""}`.trim() };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      const reply = await thread.say(SCRIPT);
      expect(shownRules(standIn.views), "the model is not taught to ask about pasted text").toContain(PASTED_RULE);
      expect(thread.proposal ?? null, "a card was made from a pasted script with no ask").toBeNull();
      expect(reply.content, "the reply promised a form or a termination before the manager asked").not.toMatch(/\b(?:I'll|I will|I'm going to)\b[^.?!]*\b(?:Corrective Action|termination|exit form)\b/i);
      expect(reply.content).toMatch(/\?/);
    },
  },
  {
    id: "nov16-no-guessing-no-pronoun-the-manager-never-used",
    title: "Never guess a pronoun: \"exit form for rowan kestrel, last day 11/28\" (no pronoun anywhere): the reply names Rowan Kestrel and never says he/his/she/her",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const standIn = loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "rowan kestrel" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "stc-exit", employee_id: "e-4", exit_type: "resignation", effective_date: "11/28", exit_evidence: { ...evidenceFrom(view, "exit form for rowan kestrel"), kind: "asks_for_exit_form" } } };
        return { text: "Here's the Resignation/Exit Form for **Rowan Kestrel**. Their last day is 11/28; tell me if Rowan is eligible for rehire." };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      const reply = await thread.say("exit form for rowan kestrel, last day 11/28");
      expect(shownRules(standIn.views), "the model is not taught never to guess a pronoun").toContain(PRONOUN_RULE);
      expect(reply.content, `a pronoun the manager never used:\n${reply.content}`).not.toMatch(GUESSED);
      expect(reply.content).toContain("Rowan Kestrel");
    },
  },
];
