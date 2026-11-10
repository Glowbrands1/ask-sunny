import { expect, vi } from "vitest";

import { STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "DEAR <NAME>, YOUR EMPLOYMENT …" ON ONE LINE: NEVER THE EMPLOYEE "DEAR <NAME>" (ported from the sibling app: QA's live tester there, round 11, 9 Nov 2026)
 * ============================================================================
 *
 * The sibling app tester's letter, verbatim except the people and the company's name (invented: Orla Penhallow, the employee; Thessaly Wrenfield, the
 * signer): turn 1 the letter alone, turn 2 "I need an exit form with this information. " and the same letter, all on
 * one line, "Your" capitalised after the salutation's comma. With LETTER_GREETING_NOT_NAME on, the salutation was kept
 * (the letter's next word was read in lower case only), and the sibling app's card's Name was, intermittently, "Dear Orla
 * Penhallow". LETTER_GREETING_ANY_CASE_ENABLED.
 */
const LETTER =
  "Dear Orla Penhallow, Your employment with the company is terminated, effective 11/08/2026, because you did not show up for your scheduled shifts on 11/3, 11/5 and 11/7 and did not call. Please return your salon key. Sincerely, Thessaly Wrenfield, District Manager";

const ORLA: DirectoryRow = {
  id: "e-lg-orla-penhallow",
  firstName: "Orla",
  lastName: "Penhallow",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function letterGreetingAnyCasePeople(): readonly DirectoryRow[] {
  return [ORLA];
}

const EVERY_SALON = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

async function exitCard(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-09T22:08:00Z"));
  t.directory([...STAFF, ORLA]);
  t.as("district_manager", EVERY_SALON);
  const thread = t.thread();
  await thread.say(LETTER);
  const { content } = await thread.say(`I need an exit form with this information. ${LETTER}`);
  return { thread, content };
}

export const NOV10_LETTER_GREETING_ANY_CASE_CASES: ReplayCase[] = [
  {
    id: "nov10-letter-greeting-your-capitalised",
    title: "\"Dear <name>, Your employment … \" on one line: the exit card is for Orla Penhallow, never \"Dear Orla Penhallow\"",
    report: "QA, 10 Nov 2026 (the sibling app tester's round-11 handoff): a pasted letter's \"Dear <name>\" is intermittently part of the employee name, with LETTER_GREETING_NOT_NAME on",
    // A guard here (10 Nov 2026): this app's card already holds on production flags (another name reader drops the
    // salutation), but the greeting reader has the sibling app's gap and the salutation still reaches the reading model,
    // which is what made the sibling app's card intermittent live. The reader is proven in `letter-signer.test.ts`.
    status: "fixed",
    fixFlags: ["LETTER_GREETING_ANY_CASE_ENABLED"],
    async run(t) {
      const { thread, content } = await exitCard(t);
      expect(content, `the salutation is read as the name:\n${content}`).not.toMatch(/\bDear Orla/);
      expect(thread.proposal?.employeeName ?? null, `the card is not for Orla Penhallow:\n${content}`).toBe("Orla Penhallow");
    },
  },
];
