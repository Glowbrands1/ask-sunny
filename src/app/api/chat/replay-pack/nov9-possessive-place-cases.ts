import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "CREATE A CA FOR <WORD>'S <PLACE>, …": NO EMPLOYEE FROM A POSSESSIVE PLACE NAME (ported from the sibling app: QA's
 * round-6 live test there, 9 Nov 2026; pre-existing here too)
 * ============================================================================
 *
 * QA's wording with an invented place ("Hadley's Crossing Plaza"; no salon name here has a possessive). Today: a
 * Corrective Action card for Employee "Hadley". POSSESSIVE_PLACE_NOT_PERSON_ENABLED (`forms/possessive-place.ts`).
 */
const FIX = ["POSSESSIVE_PLACE_NOT_PERSON_ENABLED"];
const REPORT = "QA's round-6 live test in the sibling app (9 Nov 2026): \"create a CA for <Word>'s <Place>, she was late on 10-20-26\" made a card for Employee \"<Word>\"";
const REPORTED = "create a CA for Hadley's Crossing Plaza, she was late on 10-20-26";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-07T16:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV9_POSSESSIVE_PLACE_CASES: ReplayCase[] = [
  {
    id: "nov9-possessive-place",
    title: "\"create a CA for Hadley's Crossing Plaza, she was late on 10-20-26\": no Employee \"Hadley\"; it asks who the form is for",
    report: REPORT,
    status: { open: "a Corrective Action card for **Hadley**" },
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const { content } = await thread.say(REPORTED);
      expect(thread.proposal?.employeeName ?? null, `the place's possessive is the card's person:\n${content}`).toBeNull();
      expect(content, `the reply does not ask who:\n${content}`).toMatch(/Who is this \*\*[^*]+\*\* for\?/);
    },
  },
  {
    id: "nov9-possessive-place-person-keeps",
    title: "must not change: \"Remy Calder … at Hadley's Crossing Plaza\" keeps the card for him",
    report: REPORT,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const { content } = await thread.say("create a CA for Remy Calder, he was late on 10-20-26 for his shift at Hadley's Crossing Plaza");
      expect(thread.proposal?.employeeName ?? null, `the card is not for Remy Calder:\n${content}`).toBe("Remy Calder");
    },
  },
];
