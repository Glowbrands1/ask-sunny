import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";
import { personPronoun } from "./reply-checks";

/**
 * ============================================================================
 * THE PERSON BY NAME, EVERY TURN (QA, Runner 2's 266 re-run on the final code, 16 Nov 2026; Pau's first-name rule)
 * ============================================================================
 *
 * After #1071, 93 reply lines in 35 chats still called the card's person he/she/her/him; in 24 lines (14 chats) Sunny
 * introduced it although the manager never wrote a gendered pronoun. The shapes: a turn with no tool ("I'll start the
 * Corrective Action Form for her now", c019), the Observation line paraphrasing the account ("She was late on …"), and
 * possessives ("with her 146 tans", c208; "her figures … her own 146 tans", c210; "you've already talked to her",
 * c198; "walk through it with her", c231). Invented names only: Tamsin Orwell (roster), Juno Paxton (roster).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Runner 2's 266 re-run on the final code (16 Nov 2026): he/she/her/him for the card's person in 93 lines, 24 introduced by Sunny";
const TAMSIN: DirectoryRow = { id: "e-tamsin-orwell", firstName: "Tamsin", lastName: "Orwell", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-15T22:40:00Z"));
  t.directory([...STAFF, TAMSIN]);
  t.as("salon_director", KEARNEY);
}

/** T1's card: find_staff, then the CA; the reply paraphrases the account on the Observation line with a pronoun. */
const cardModel = () => loopStandIn((view): LoopDecision => {
  const staff = lastResult(view, "find_staff") as { matches?: { employee_id: string }[] } | null;
  if (!staff) return { tool: "find_staff", input: { name: "Tamsin Orwell", person_evidence: evidenceFrom(view, "Tamsin Orwell") } };
  if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: staff.matches?.[0]?.employee_id, what_happened: "Late to the shift on 11/14.", incident_date: "2026-11-14" } };
  return { text: "Here's the Corrective Action Form for **Tamsin**.\n**Observation of Offense:** She was late to her shift on 11/14, with her 146 tans this month." };
});
/** A later turn with no tool: the model answers in words only. */
const wordsOnly = (text: string) => loopStandIn((): LoopDecision => ({ text }));

export const NOV16_AGENT_LOOP_NO_PRONOUN_CASES: ReplayCase[] = [
  {
    id: "nov16-no-pronoun-observation-line-and-no-tool-turn-c019",
    title: "266 re-run shapes: the card reply's Observation line (\"She was late to her shift … with her 146 tans\") and a later turn with no tool (\"I'll start the Corrective Action Form for her now\", c019; \"you've already talked to her\", c198; \"walk through it with her\", c231) all call the person Tamsin",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(cardModel());
      const thread = t.thread();
      const card = await thread.say("ca for Tamsin Orwell, late to the shift on 11/14");
      expect(personPronoun(card.content), `a pronoun on the card reply:\n${card.content}`).toBeNull();
      expect(card.content).toContain("Tamsin was late to Tamsin's shift on 11/14, with Tamsin's 146 tans this month.");
      t.loopModel!(wordsOnly("I'll start the Corrective Action Form for her now. Since you've already talked to her, print it and walk through it with her."));
      const later = await thread.say("ok go ahead");
      expect(personPronoun(later.content), `a pronoun on a turn with no tool:\n${later.content}`).toBeNull();
      expect(later.content).toBe("I'll start the Corrective Action Form for Tamsin now. Since you've already talked to Tamsin, print it and walk through it with Tamsin.");
    },
  },
  {
    id: "nov16-no-pronoun-figures-possessives-c210",
    title: "266 re-run shape c210: \"her figures … her own 146 tans\" on a turn with no tool, the card on screen: Tamsin's figures, Tamsin's own 146 tans",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(cardModel());
      const thread = t.thread();
      await thread.say("ca for Tamsin Orwell, late to the shift on 11/14");
      t.loopModel!(wordsOnly("Compare her figures with her own 146 tans before you decide."));
      const later = await thread.say("how do her numbers look");
      expect(later.content).toBe("Compare Tamsin's figures with Tamsin's own 146 tans before you decide.");
    },
  },
  {
    id: "nov16-no-pronoun-controls-another-person-and-quotes",
    title: "Controls: a message naming someone else (\"Juno Paxton was there too\") leaves the reply's pronoun as written (it may be Juno's); the manager's own words quoted back (\"she was late to her shift\", typed by the manager) stay as typed",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(cardModel());
      const thread = t.thread();
      await thread.say("ca for Tamsin Orwell, she was late to her shift on 11/14");
      t.loopModel!(wordsOnly("Noted: she saw it happen."));
      const other = await thread.say("Juno Paxton was there too");
      expect(other.content, "a pronoun was replaced although someone else was named").toBe("Noted: she saw it happen.");
      t.loopModel!(wordsOnly('You wrote "she was late to her shift", so the Observation keeps that.'));
      const quoted = await thread.say("is the wording ok");
      expect(quoted.content).toBe('You wrote "she was late to her shift", so the Observation keeps that.');
    },
  },
  {
    id: "nov16-no-pronoun-forms-on-file-lookup-no-card-c019",
    title: "Runner 2's c019 T1: \"any corrective actions for Tamsin Orwell?\" finds none on file and the reply offers \"I'll start the Corrective Action Form for her now\" with no card yet: the lookup names the person (reply_name), so the reply says Tamsin",
    report: `${REPORT}; Runner 2's offline re-check of bd7705f: c019 T1 still had "for her now" (no card yet, no name)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_past_forms")) return { tool: "find_past_forms", input: { employee_name: "Tamsin Orwell", form: "CA", forms_on_file_evidence: evidenceFrom(view, "any corrective actions for Tamsin Orwell") } };
        return { text: "I don't have any corrective action on file for Tamsin Orwell — nothing was found. Tell me what happened and I'll start the Corrective Action Form for her now." };
      }));
      const thread = t.thread();
      const reply = await thread.say("any corrective actions for Tamsin Orwell?");
      expect(personPronoun(reply.content), `a pronoun with no card yet:\n${reply.content}`).toBeNull();
      expect(reply.content).toContain("I'll start the Corrective Action Form for Tamsin now.");
    },
  },
  {
    id: "nov16-no-pronoun-another-employees-figures-keep-her-c210",
    title: "Runner 2's c210 T2 pinned: the manager pastes feedback about another employee (Juno Paxton); \"those edits name **Juno Paxton** and her figures\" keeps \"her\" (Juno's figures), never Tamsin's",
    report: `${REPORT}; Runner 2's offline re-check: without the other-person rule the pass wrote the card person's name on another employee's figures`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(cardModel());
      const thread = t.thread();
      await thread.say("ca for Tamsin Orwell, late to the shift on 11/14");
      t.loopModel!(cardModel());
      const pasted = await thread.say("here are the edits for Juno Paxton: 24 tans in October 2026, below on PPTA");
      expect(pasted.content, `another employee's figures got the card person's name:\n${pasted.content}`).not.toMatch(/Tamsin's figures/);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const staff = lastResult(view, "find_staff") as { matches?: { employee_id: string }[] } | null;
        if (!staff) return { tool: "find_staff", input: { name: "Tamsin Orwell", person_evidence: evidenceFrom(view, "Tamsin Orwell", 2) } };
        return { text: "A couple of notes on what you pasted: those edits name **Juno Paxton** and her figures (24 tans, October 2026), so I haven't put any of that on this card." };
      }));
      const notes = await thread.say("so what did you do with Juno Paxton's edits");
      expect(notes.content, `another employee's figures got the card person's name:\n${notes.content}`).toContain("those edits name **Juno Paxton** and her figures");
    },
  },
];
