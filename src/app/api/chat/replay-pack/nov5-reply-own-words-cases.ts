import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * THE NAME TAKEN OFF THE CARD GOES; THE APP'S OWN WORDS STAY (QA, 5 Nov 2026)
 * ============================================================================
 *
 * Ported from the sibling app (Ask-bubbles#478). REPLY_MATCHES_CARD_ENABLED's rule 1 makes the removed name "the employee" in
 * every line, one word at a time. This app's METRIC_GUARD side-effect run
 * found QA's probe "QA Probe XZT One" turning the app's own "One more question"
 * into "The employee more question"; QA: a real roster person in the sibling app has a
 * preferred first name that is an ordinary word. Through the route with the
 * flip set, an off-roster common-word first name ("Will Drummet") and QA's
 * probe: the app's words are kept, the name is said nowhere but in the
 * not-found line. Guards here (the unit proof is
 * `ai/reply-matches-card-own-words.test.ts`); invented person, checked against
 * both apps' directories.
 */

const FLIP = [
  "CHAT_GLOSSARY_ENABLED",
  "FORM_NAME_FROM_ROSTER_ENABLED",
  "CA_SALES_POLICY_ENABLED",
  "ROSTER_NEAR_MISS_ENABLED",
  "ROSTER_NAME_IN_CANDIDATE_ENABLED",
  "TITLE_OF_THE_EMPLOYEE_ENABLED",
  "REPLY_MATCHES_CARD_ENABLED",
];

function start(t: ReplayContext) {
  for (const flag of FLIP) vi.stubEnv(flag, "true");
  vi.setSystemTime(new Date("2026-11-05T15:30:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

// Changed on purpose (10 Nov 2026, QA's roster-set ruling): with the name set on, a salon manager's not-found line is OFF_ROSTER_ASK's "I can't find **<name>** on your roster — …" (round 12's live wording), not "I couldn't find **<name>** in the Woven roster".
const outsideNotFound = (content: string) => content.split("\n").filter((line) => !/I couldn't find \*\*|I can't find \*\*[^*]+\*\* on your roster/.test(line)).join("\n");

export const NOV5_REPLY_OWN_WORDS_CASES: ReplayCase[] = [
  {
    id: "nov5-reply-own-words-common-first-name",
    title: "the flip set: \"create a ca form for Will Drummet, he was late opening the salon on 11/2\" (on no roster): \"Management will review\" stays; the name is said only in the not-found line",
    report: "QA, 5 Nov 2026: a common-word first name, REPLY_MATCHES_CARD's name scrub",
    status: "fixed",
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("create a ca form for Will Drummet, he was late opening the salon on 11/2");
      expect(thread.proposal?.employeeName ?? null, `a name on no roster is the employee:\n${reply.content}`).toBeNull();
      expect(reply.content, `the app's own "will" was scrubbed:\n${reply.content}`).not.toMatch(/Management the employee/);
      expect(outsideNotFound(reply.content), `the name is said outside the not-found line:\n${reply.content}`).not.toMatch(/Drummet/);
    },
  },
  {
    id: "nov5-reply-own-words-qa-probe",
    title: "the flip set: QA's probe \"QA Probe XZT One\" never rewrites the app's own \"One more question\"",
    report: "this app's METRIC_GUARD side-effect run (5 Nov 2026): \"The employee more question\"",
    status: "fixed",
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("I need a corrective action verbal for QA Probe XZT One. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.");
      expect(reply.content, `the app's own words were scrubbed:\n${reply.content}`).not.toMatch(/The employee more question|the employee more question/);
    },
  },
];
