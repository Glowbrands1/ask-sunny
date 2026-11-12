import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayAnswer, type ReplayCase } from "./cases";
import { at } from "./nov4-live-regressions-scenarios";

/**
 * ============================================================================
 * A NEAR-MISS NAME IS ASKED ONCE (ported from the sibling app: QA's gate there on 4d42c342, 7 Nov 2026)
 * ============================================================================
 *
 * With FORM_NAME_FROM_ROSTER on, a full name typed close to one roster person was asked "Is this for **<roster
 * name>**? Tell me if that should change.", and the manager's next turn, which gave the form's details without
 * turning the name down, got the SAME question again: the details were lost and no card was made. With FORM_NAME off
 * the card was made. QA: "a turn that answers with form details and doesn't reject the suggested name accepts it (or
 * keeps the details and asks once). Never the same question twice." NEAR_MISS_DETAILS_ACCEPT_ENABLED
 * (`forms/near-miss-answer.ts`). The manager's words, in this app's setting (a tanning consultant, lotion refills); the
 * people are invented and on neither directory (Corvina Vellacott; Delphine Marlowe Ostrander from nov4-scan-sf-b5).
 */
const NAME_SET = [
  "FORM_NAME_FROM_ROSTER_ENABLED",
  "ROSTER_NEAR_MISS_ENABLED",
  "ROSTER_NAME_IN_CANDIDATE_ENABLED",
  "ROSTER_COMPOUND_SURNAME_ENABLED",
  "ROSTER_NOT_FOUND_ANY_PHRASING_ENABLED",
  "OFF_ROSTER_CONFIRM_ENABLED",
];
const FLAG = "NEAR_MISS_DETAILS_ACCEPT_ENABLED";
const REPORT = "QA, the sibling app's gate on 4d42c342 (7 Nov 2026): with FORM_NAME on, a near-miss confirm question repeats and the next turn's details are dropped";
const CORVINA = at("nm-corvina", "Corvina", "Vellacott");
const DELPHINE = at("nm-delphine", "Delphine", "Marlowe Ostrander");
const ASKED = /Is this for \*\*[^*]+\*\*\? Tell me if that should change\./;

const CHATS: readonly { id: string; person: string; turns: readonly [string, string]; level: RegExp }[] = [
  {
    id: "corvina",
    person: "Corvina Vellacott",
    turns: ["i have an employee, Corvina Ashdown Vellacot that needs a corrective action form with a customer complaint", "verbal warning, no payroll deduct, part-time tanning consultant,"],
    level: /Verbal Warning/,
  },
  {
    id: "delphine",
    person: "Delphine Marlowe Ostrander",
    turns: [
      "create a ca form for Delphine Marlwoe Ostrander",
      "verbal warning The date she complained was Oct 31st . The customer said she was giving her an attitude when she brought up that the register was charging for scent in her lotion refills and it has never done that before. When Delphine spoke with District manager Tobias Wrenfield she said the customer had raised her voice first and she only explained the price.",
    ],
    level: /verbal/i,
  },
];

export const NOV7_NEAR_MISS_DETAILS_CASES: ReplayCase[] = CHATS.flatMap(({ id, person, turns, level }): ReplayCase[] => [
  {
    id: `nov7-near-miss-details-${id}`,
    title: `"${turns[0].slice(0, 60)}…" → "Is this for **${person}**?" → "${turns[1].slice(0, 40)}…": the question is never asked twice, and the card is for ${person} with the details kept`,
    report: REPORT,
    // Production (FORM_NAME off) makes the card; the loop is with the name flags on.
    status: "fixed",
    fixFlags: [...NAME_SET, FLAG],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-04T15:30:00Z"));
      t.directory([...STAFF, CORVINA, DELPHINE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const replies: ReplayAnswer[] = [];
      for (const turn of turns) replies.push(await thread.say(turn));
      const [first, second] = replies as [ReplayAnswer, ReplayAnswer];
      expect(thread.proposal?.employeeName ?? null, `no card:\n${second.content}`).toBeTruthy();
      // Asked "Is this for <person>?" and answered with the form's details: the card is for them, and never asked again.
      // Not asked (FORM_NAME off, production today): the card is for the name as typed, as before.
      if (ASKED.test(first.content)) {
        expect(second.content, `the same question is asked twice:\n${second.content}`).not.toMatch(ASKED);
        expect(thread.proposal?.employeeName ?? null, `the card is not for ${person}:\n${second.content}`).toBe(person);
        // One source of truth (QA's gate runner 2, 7 Nov 2026): Create's out-of-date check counts the accepted name, so
        // the card is created for them, never refused as "the conversation now says the form is for <typed name>".
        const id = await thread.create();
        expect(t.values(id).employee_name, "the created form is not for the accepted name").toBe(person);
      }
      expect(second.content, `the warning level said is lost:\n${second.content}`).toMatch(level);
    },
  },
  {
    id: `nov7-near-miss-details-${id}-turned-down`,
    title: `negative: the same chat, but "no, …" before the details: the asked name is not taken`,
    report: REPORT,
    status: "fixed",
    // Changed on purpose (QA's Sunny round-4 gate, 8 Nov 2026): the name read again from the first turn and seated as its
    // roster near-miss is taken off by NEAR_MISS_QUESTION_RULES_ENABLED (`forms/near-miss-question-rules.ts`), which
    // ships with the name set; the open mark goes.
    fixFlags: [...NAME_SET, FLAG, "NEAR_MISS_QUESTION_RULES_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-04T15:30:00Z"));
      t.directory([...STAFF, CORVINA, DELPHINE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const first = await thread.say(turns[0]);
      const reply = await thread.say(`no, ${turns[1]}`);
      // Only an answer to the question can turn it down; where the name was not asked about, this checks nothing.
      if (ASKED.test(first.content)) {
        expect(thread.proposal?.employeeName ?? null, `the turned-down name is on the card:\n${reply.content}`).not.toBe(person);
        expect(reply.content, `the reply drafts for the turned-down name:\n${reply.content}`).not.toContain(`**${person}**`);
        expect(reply.content, `the reply does not ask who:\n${reply.content}`).toMatch(/Who is this form for\?/);
      }
    },
  },
]);
