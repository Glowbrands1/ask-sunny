import { expect, vi } from "vitest";

import { STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A TERMINATION LETTER SENT TO THE EMPLOYEE: THE CARD HAS THE SIGNER'S TITLE AND AN INCIDENT'S DATE (QA, the live Sunny
 * test, 9 Nov 2026; rounds 7c and 8 alike, so older than EXIT_LETTER_SIGNER; EXIT_LETTER_ADDRESSEE_ENABLED)
 * ============================================================================
 *
 * Turn 1, the letter alone; turn 2, "I need an exit form with this information. " and the same letter (gate runner 2's
 * exact text, the people invented: Marcus Tellefsen, Dolores Whitcombe). The exit card's Job Title was "District
 * Manager" (the signer's) and its Resignation Date November 3, 2026 (the first no-show; the letter says "terminated,
 * effective 11/08/2026"). With Marcus off the roster, the replay also offered the signer as the form's person.
 */
const LETTER = [
  "Marcus Tellefsen,",
  "",
  "This letter confirms that your employment with Sun Tan City is terminated, effective 11/08/2026, due to repeated no-call no-shows on 11/3, 11/5 and 11/7.",
  "",
  "Please return your salon keys and any other company property by 11/09/2026. Your final paycheck will be issued on the next regular payday.",
  "",
  "Sincerely,",
  "Dolores Whitcombe",
  "District Manager",
].join("\n");
export const TURNS = [LETTER, `I need an exit form with this information. ${LETTER}`] as const;
const MARCUS: DirectoryRow = {
  id: "e-marcus-tellefsen",
  firstName: "Marcus",
  lastName: "Tellefsen",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};
const EVERY_SALON = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const FIX = ["EXIT_LETTER_ADDRESSEE_ENABLED"];
const REPORT = "QA, the live Sunny test (9 Nov 2026; rounds 7c and 8): a termination letter's exit card took the signer's \"District Manager\" as Job Title and the first no-show (11/3) as Resignation Date";

async function card(t: ReplayContext, onRoster: boolean) {
  vi.setSystemTime(new Date("2026-11-08T18:00:00Z"));
  t.directory(onRoster ? [...STAFF, MARCUS] : STAFF);
  t.as("district_manager", EVERY_SALON);
  const thread = t.thread();
  await thread.say(TURNS[0]);
  const { content } = await thread.say(TURNS[1]);
  return { thread, content };
}

export const NOV9_LETTER_TITLE_DATE_CASES: ReplayCase[] = [
  {
    id: "nov9-letter-title-date-on-roster",
    title: "the letter, then \"I need an exit form with this information.\" + the letter (Marcus on the roster): no Job Title \"District Manager\", Resignation Date November 8, 2026",
    report: REPORT,
    status: { open: "Job Title: District Manager; Resignation Date: November 3, 2026" },
    fixFlags: FIX,
    async run(t) {
      const { thread, content } = await card(t, true);
      expect(thread.proposal?.employeeName ?? null, `the card is not for Marcus:\n${content}`).toBe("Marcus Tellefsen");
      expect(content, `the signer's title is the Job Title:\n${content}`).not.toMatch(/\*\*Job Title:\*\*\s*District Manager/i);
      expect(thread.proposal?.employeeRole ?? null, `the card's Position is the signer's:\n${content}`).not.toBe("District Manager");
      expect(content, `the Resignation Date is not the termination's:\n${content}`).toMatch(/\*\*Resignation Date:\*\*\s*November 8, 2026/);
    },
  },
  {
    id: "nov9-letter-title-date-off-roster",
    title: "the same, Marcus off the roster (the live chat): the signer is never offered, no Job Title \"District Manager\", Resignation Date November 8, 2026",
    report: REPORT,
    status: { open: "\"Which of them is this Resignation/Exit Form for — Marcus Tellefsen or Dolores Whitcombe District Manager?\"" },
    fixFlags: FIX,
    async run(t) {
      const { thread, content } = await card(t, false);
      expect(content, `the signer is offered:\n${content}`).not.toMatch(/\*\*Dolores Whitcombe/);
      expect(thread.proposal?.employeeName ?? null, `the card is not for Marcus:\n${content}`).toBe("Marcus Tellefsen");
      expect(content, `the signer's title is the Job Title:\n${content}`).not.toMatch(/\*\*Job Title:\*\*\s*District Manager/i);
      expect(content, `the Resignation Date is not the termination's:\n${content}`).toMatch(/\*\*Resignation Date:\*\*\s*November 8, 2026/);
    },
  },
];
