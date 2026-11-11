import { expect, vi } from "vitest";

import { formNameFromRosterEnabled } from "@/lib/config/chat-quality-flags";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";
import { policyKeptPeople } from "./nov5-policy-kept-across-turns-cases";

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
  /*
   * Changed on purpose (10 Nov 2026, QA's roster-set gate): with the name set on (FORM_NAME_FROM_ROSTER and its
   * companions), the first turn asks "Is this for **Odessa Lark Penhallow**?" and the details turn seats the roster's
   * spelling (NEAR_MISS_DETAILS_ACCEPT), so the opening card is already hers; the correction must still keep it so.
   */
  const opening = formNameFromRosterEnabled() ? "Odessa Lark Penhallow" : "Odessa Lark Penhallwo";
  expect(before?.employeeName, "the opening card does not carry the typed name").toBe(opening);
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
/*
 * An off-roster correction (QA, round 6, 8 Nov 2026). This expectation changed on purpose: round 5 followed the
 * sibling app and asked "Which of them … — **Odessa Lark Penhallwo** or **Odessa Lark Penhalloe**?" with no one on the
 * card. QA's round-6 rule: the card stays, and a spelling on nobody's roster is never offered as a person. One
 * roster person is that close, so the card is for her, and the reply says the typed spelling is not on the roster.
 */
function offRosterKept(before: Card, after: ReplayAnswer): void {
  expect(after.formProposal, `the card was dropped:\n${after.content}`).toBeTruthy();
  expect(after.formProposal?.employeeName, `the card is not for the roster's Odessa:\n${after.content}`).toBe("Odessa Lark Penhallow");
  restUnchanged(before, after.formProposal!);
  expect(after.content, `the typo is offered as a person:\n${after.content}`).not.toMatch(/Which of them|\*\*Odessa Lark Penhalloe\*\*|\*\*Odessa Lark Penhallwo\*\*/);
  expect(after.content, `the reply does not say the spelling is not on the roster:\n${after.content}`).toContain('"Odessa Lark Penhalloe" isn\'t a name on the roster');
}

export const NOV8_PROPOSAL_NAME_CORRECTION_CASES: ReplayCase[] = [
  ...Object.entries(CORRECTIONS).map(
    ([key, correction]): ReplayCase => ({
      id: `nov8-proposal-name-correction-${key}`,
      title: `on the card before Create, "${correction}": the card's employee is the roster's Odessa Lark Penhallow, and nothing else changes`,
      report: REPORT,
      // A whole name, capitalised, already re-proposes the card for her with production's flags: a guard there.
      // Changed on purpose (8 Nov 2026): fixed in production by PROPOSAL_NAME_CORRECTION_ENABLED, QA round 6, 8 Nov 2026; it now holds with production's flags.
      status: "fixed",
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
    title: "an off-roster spelling (\"fix her last name penhalloe\") keeps the card, for the one roster person that close; the typo is never offered as a person",
    report: REPORT,
    // Changed on purpose (8 Nov 2026): fixed in production by PROPOSAL_NAME_CORRECTION_ENABLED, QA round 6, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const { before, after } = await cardAfter(t, "fix her last name penhalloe");
      offRosterKept(before, after);
    },
  },
  {
    id: "nov8-proposal-name-correction-typed-off-roster",
    title: "\"change her name to Odessa Lark Penhalloe\" (typed, off the roster) keeps the card, for the one roster person that close; never kept silently",
    report: "QA, round 5 (8 Nov 2026): here an off-roster \"change her name to …\" on the card kept the old name and said nothing",
    // Changed on purpose (8 Nov 2026): fixed in production by PROPOSAL_NAME_CORRECTION_ENABLED, QA round 6, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const { before, after } = await cardAfter(t, "change her name to Odessa Lark Penhalloe");
      offRosterKept(before, after);
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
  ...(
    [
      ["t5", "under the employee line the name is supposed to be marisol otrega valdez", "Marisol Otrega Valdez"],
      ["t7", "make that change to Marisol Prtega Valdez", "Marisol Prtega Valdez"],
    ] as const
  ).map(
    ([turn, said, typo]): ReplayCase => ({
      id: `nov8-proposal-name-correction-r6-${turn}`,
      title: `R6 ${turn}: "${said}" on the card for the roster's Marisol Ortega Valdez keeps the card for her; the typo is never offered or seated`,
      report: `QA, round 6 (8 Nov 2026): nov5-r6-policy-kept-across-turns ${turn} asked "Which of them … — **Marisol Ortega Valdez** or **${typo}**?" (or seated the typo)`,
      // Changed on purpose (8 Nov 2026): fixed in production by PROPOSAL_NAME_CORRECTION_ENABLED, QA round 6, 8 Nov 2026; it now holds with production's flags.
      status: "fixed",
      fixFlags: [FLAG],
      async run(t) {
        // nov5-r6-policy-kept-across-turns' turns, verbatim, up to this one; the person is that file's invented one.
        const turns = [
          "i have an employee, Marisol Ortega Valdze that needs a corrective action form with a customer complaint",
          "verbal warning, no payroll deduct, tanning consultant,",
          "fix her last name valdez",
          "make that update",
          "under the employee line the name is supposed to be marisol otrega valdez",
          "redo marisol ortega valdez",
          "make that change to Marisol Prtega Valdez",
        ];
        vi.setSystemTime(new Date("2026-11-02T18:00:00Z"));
        t.directory([...STAFF, ...policyKeptPeople()]);
        t.as("salon_director", KEARNEY);
        const thread = t.thread();
        let after: ReplayAnswer | null = null;
        for (const turn of turns.slice(0, turns.indexOf(said) + 1)) after = await thread.say(turn);
        expect(after!.formProposal, `the card was dropped:\n${after!.content}`).toBeTruthy();
        expect(after!.formProposal?.employeeName, `the card is not for the roster's Marisol:\n${after!.content}`).toBe("Marisol Ortega Valdez");
        expect(after!.content, `the typo is offered as a person:\n${after!.content}`).not.toMatch(new RegExp(`Which of them|\\*\\*${typo}\\*\\*`));
      },
    }),
  ),
];
