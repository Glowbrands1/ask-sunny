import { expect, vi } from "vitest";

import { STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "DEAR <NAME>," IS NOT THE EMPLOYEE "DEAR <NAME>" (QA, 9 Nov 2026; LETTER_GREETING_NOT_NAME_ENABLED)
 * ============================================================================
 *
 * QA: the greeting reader must drop salutations (Dear, Hi, Hello, To, Attn, "Good morning", and similar) before the
 * roster match. Turn 1, the letter alone; turn 2, "I need an exit form with this information. " and the same letter,
 * the letter opening "Dear Marcus Tellefsen," (the people invented: Marcus Tellefsen, Dolores Whitcombe). The exit
 * card's Name was "Dear Marcus Tellefsen", with no Job Title and no salon, on the roster or off it.
 */
const letter = (greeting: string) =>
  [
    `${greeting},`,
    "",
    "This letter confirms that your employment with Sun Tan City is terminated, effective 11/08/2026, due to repeated no-call no-shows on 11/3, 11/5 and 11/7.",
    "",
    "Please return your salon keys and any other company property by 11/09/2026. Your final paycheck will be issued on the next regular payday.",
    "",
    "Sincerely,",
    "Dolores Whitcombe",
    "District Manager",
  ].join("\n");
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
const FIX = ["LETTER_GREETING_NOT_NAME_ENABLED"];
const REPORT = "QA (9 Nov 2026): a termination letter opening \"Dear <name>,\" gave the exit card the employee \"Dear <name>\", no Job Title and no salon";

async function card(t: ReplayContext, greeting: string, onRoster: boolean) {
  vi.setSystemTime(new Date("2026-11-08T18:00:00Z"));
  t.directory(onRoster ? [...STAFF, MARCUS] : STAFF);
  t.as("district_manager", EVERY_SALON);
  const thread = t.thread();
  await thread.say(letter(greeting));
  const { content } = await thread.say(`I need an exit form with this information. ${letter(greeting)}`);
  return { thread, content };
}

export const NOV9_LETTER_GREETING_SALUTATION_CASES: ReplayCase[] = [
  {
    id: "nov9-letter-greeting-dear-on-roster",
    title: "\"Dear Marcus Tellefsen,\" (on the roster): the card is for Marcus Tellefsen, with his Job Title and salon from the roster",
    report: REPORT,
    // Already right with this app's production flags (the roster's name reader finds Marcus in "Dear Marcus Tellefsen");
    // kept so the salutation fix never breaks it. Off the roster (below) is the open case here.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const { thread, content } = await card(t, "Dear Marcus Tellefsen", true);
      expect(content, `the salutation is read as the name:\n${content}`).not.toMatch(/\bDear Marcus/);
      expect(thread.proposal?.employeeName ?? null, `the card is not for Marcus:\n${content}`).toBe("Marcus Tellefsen");
      expect(thread.proposal?.employeeRole ?? null, `the roster's Job Title is missing:\n${content}`).toBe("Tanning Consultant");
      expect(content, `the roster's Job Title is not said back:\n${content}`).toMatch(/\*\*Job Title:\*\*\s*Tanning Consultant/);
      expect(thread.proposal?.locationId ?? null, `the roster's salon is missing:\n${content}`).toBe("loc-0309");
    },
  },
  {
    id: "nov9-letter-greeting-dear-off-roster",
    title: "\"Dear Marcus Tellefsen,\" (off the roster): the card is for Marcus Tellefsen, never \"Dear Marcus Tellefsen\"",
    report: REPORT,
    status: { open: "Name: Dear Marcus Tellefsen" },
    fixFlags: FIX,
    async run(t) {
      const { thread, content } = await card(t, "Dear Marcus Tellefsen", false);
      expect(content, `the salutation is read as the name:\n${content}`).not.toMatch(/\bDear Marcus/);
      expect(thread.proposal?.employeeName ?? null, `the card is not for Marcus:\n${content}`).toBe("Marcus Tellefsen");
      expect(content, `the signer's title is the Job Title:\n${content}`).not.toMatch(/\*\*Job Title:\*\*\s*District Manager/i);
    },
  },
  {
    id: "nov9-letter-greeting-hi-first-name",
    title: "\"Hi Marcus,\" (on the roster): asked as Marcus Tellefsen, never \"Hi Marcus\"",
    report: REPORT,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const { thread, content } = await card(t, "Hi Marcus", true);
      expect(content, `the salutation is read as the name:\n${content}`).not.toMatch(/\bHi Marcus/);
      expect(thread.proposal?.employeeName ?? "", `the salutation is the card's name:\n${content}`).not.toMatch(/^Hi\b/);
      expect(content, `Marcus Tellefsen is not asked about:\n${content}`).toMatch(/\*\*Marcus Tellefsen\*\*/);
    },
  },
];
