import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "FIX HER LAST NAME …" ON A CARD NOT YET CREATED (QA, round 5, 8 Nov 2026)
 * ============================================================================
 *
 * Ported from Ask Bubbles. Its 2 Nov 2026 chat (that app's chat_messages, read-only): the manager asked for a Corrective
 * Action for an employee whose surname they typed wrong, answered the card's questions, then on the card — before
 * Create — wrote "fix her last name <surname>". The reply was "**Nothing on the form has changed yet.**" and the card
 * kept the old name; later turns ("under the employee line the name is supposed to be …", "okay the correct way is
 * …") were answered as if the card had changed, with no card. The manager's words are kept; the people are invented
 * (Odessa Lark Penhallow: a two-word surname, typed with two letters swapped, as in the chat; not on
 * employee_access_directory in either app). PROPOSAL_NAME_CORRECTION_ENABLED: the card's employee becomes the
 * corrected roster person, and nothing else on the card changes.
 */
const FLAG = "PROPOSAL_NAME_CORRECTION_ENABLED";
const REPORT = "The 2 Nov 2026 chat (QA, round 5): \"fix her last name …\" on a card not yet created was not applied";

const ODESSA: DirectoryRow = {
  id: "e-odessa",
  firstName: "Odessa",
  lastName: "Lark Penhallow",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** The manager's first two turns, word for word, with the invented name typed as they typed theirs. */
const OPENING = [
  "i have an employee, Odessa Lark Penhallwo that needs a corrective action form with a customer complaint",
  // The sibling's job title swapped for this app's: "part-time team member".
  "verbal warning, no payroll deduct, part-time tanning consultant,",
];

type Card = NonNullable<ReplayAnswer["formProposal"]>;

async function cardAfter(t: ReplayContext, correction: string): Promise<{ before: Card; after: ReplayAnswer }> {
  vi.setSystemTime(new Date("2026-11-02T17:54:00Z"));
  t.directory([...STAFF, ODESSA]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(OPENING[0]!);
  const before = (await thread.say(OPENING[1]!)).formProposal!;
  expect(before?.employeeName, "the opening card does not carry the typed name").toBe("Odessa Lark Penhallwo");
  return { before, after: await thread.say(correction) };
}

/**
 * Everything on the card but the employee is as it was. The employee's own fields follow her: the roster's check of
 * her (`employeeVerification`) and where her store was read from (`locationSource`, now her Woven assignment — the
 * store itself, `locationId` / `locationName`, is compared and must not change).
 */
function restUnchanged(before: Card, after: Card): void {
  const EMPLOYEE_FIELDS = new Set(["employeeName", "employeeVerification", "closeMatchNote", "locationSource", "proposalId", "sourceMessageIds"]);
  const rest = (card: Card) => Object.fromEntries(Object.entries(card as Record<string, unknown>).filter(([key]) => !EMPLOYEE_FIELDS.has(key)));
  expect(rest(after), "something else on the card changed").toEqual(rest(before));
}

const CORRECTIONS: Record<string, string> = {
  // The chat's own words.
  "fix-her-last-name": "fix her last name penhallow",
  "supposed-to-be": "under the employee line the name is supposed to be odessa lark penhallow",
  "correct-way": "okay the correct way is Odessa Lark Penhallow",
  // The 3 Nov live re-checks of the same report (nov4-live-regressions).
  "comma-it-is": "fix her last name, it is Penhallow",
  // QA's other phrasings (round 5).
  "last-name-is": "her last name is Penhallow",
  "spelled": "it's spelled Penhallow",
};

// Here "the name is supposed to be …" also already holds with production's flags (the sibling's did not).
const ALREADY_HOLDS = new Set(["correct-way", "supposed-to-be"]);

export const NOV8_PROPOSAL_NAME_CORRECTION_CASES: ReplayCase[] = [
  ...Object.entries(CORRECTIONS).map(
    ([key, correction]): ReplayCase => ({
      id: `nov8-proposal-name-correction-${key}`,
      title: `on the card before Create, "${correction}": the card's employee is the roster's Odessa Lark Penhallow, and nothing else changes`,
      report: REPORT,
      // A whole name, capitalised, already re-proposes the card for her with production's flags: a guard there.
      status: ALREADY_HOLDS.has(key) ? "fixed" : { open: "with production's flags the card keeps \"Odessa Lark Penhallwo\"" },
      fixFlags: [FLAG],
      async run(t) {
        const { before, after } = await cardAfter(t, correction);
        expect(after.formProposal?.employeeName, `the card keeps the old name:\n${after.content}`).toBe("Odessa Lark Penhallow");
        restUnchanged(before, after.formProposal!);
        expect(after.content, "the reply says nothing changed").not.toMatch(/Nothing on the form has changed/i);
      },
    }),
  ),
  {
    id: "nov8-proposal-name-correction-off-roster",
    title: "an off-roster spelling (\"fix her last name penhalloe\") goes the way a typed off-roster name does: no roster person is seated without the manager",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      // Here "change her name to <an off-roster name>", typed or read from this turn, keeps the card's name and says
      // nothing of the spelling (the sibling asks which); reported to QA as its own finding, not changed here.
      const { after } = await cardAfter(t, "fix her last name penhalloe");
      expect(after.formProposal?.employeeName ?? null, `a roster person was seated for an off-roster spelling:\n${after.content}`).not.toBe("Odessa Lark Penhallow");
    },
  },
  {
    id: "nov8-proposal-name-correction-different-person",
    title: "negative: \"okay the correct way is Juno Paxton\" (another person, no name shared) is no correction of Odessa's card",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const { after } = await cardAfter(t, "okay the correct way is Juno Paxton");
      expect(after.formProposal?.employeeName ?? null, `the card's employee was replaced:\n${after.content}`).not.toBe("Odessa Lark Penhallow");
    },
  },
];

