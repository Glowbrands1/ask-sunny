import { expect } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A COMPOUND SURNAME TYPED WITH A TYPO (the re-flip's rollback, 5 Nov 2026)
 * ============================================================================
 *
 * The flip's live testers (R3/R5/R7, real managers, real active employees):
 * the person's surname is TWO words, and the manager typed one of them with a
 * transposed or swapped letter. With FORM_NAME_FROM_ROSTER_ENABLED +
 * ROSTER_NEAR_MISS_ENABLED on, the card had no employee and the reply asked
 * "Who is this form for?" — never "Is this for <roster name>?". The matcher
 * (`forms/employee-match.ts`) compared only the typed LAST word with the whole
 * two-word surname, so a typo in either word was never close.
 * ROSTER_COMPOUND_SURNAME_ENABLED compares the surname word by word.
 *
 * Ported from the sibling app (Glowbrands1/Ask-bubbles#474). Every person is
 * invented (checked against both apps' directories). With
 * production's flags (FORM_NAME off) the card keeps the name as typed.
 */

const person = (id: string, firstName: string, lastName: string): DirectoryRow => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
});

const ODALYS = person("e-odalys-prewett-vansickle", "Odalys", "Prewett Vansickle");
const ODALYS_D = person("e-odalys-dunmore-vansickle", "Odalys", "Dunmore Vansickle");
const THORNE = person("e-thorne-ash-merrow", "Thorne", "Ash Merrow");

const FIX = ["FORM_NAME_FROM_ROSTER_ENABLED", "ROSTER_NEAR_MISS_ENABLED", "ROSTER_COMPOUND_SURNAME_ENABLED"];
const REPORT = "The re-flip's live testers, 5 Nov 2026 (R3/R5/R7, flags on): a two-word roster surname typed with one word mistyped; the card emptied and asked who";
const OFFERS = (name: string) => new RegExp(`Is this for \\*\\*${name}\\*\\*\\?`);

async function said(t: Parameters<ReplayCase["run"]>[0], roster: readonly DirectoryRow[], ...turns: string[]) {
  t.directory([...STAFF, ...roster]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  let reply: ReplayAnswer | undefined;
  for (const turn of turns) reply = await thread.say(turn);
  return { reply: reply!, employee: thread.proposal?.employeeName ?? null };
}

/** The roster person is on the card, or the reply asks for them by their roster name. */
function offered(reply: ReplayAnswer, employee: string | null, rosterName: string): void {
  expect(employee === rosterName || OFFERS(rosterName).test(reply.content), `neither the card (${employee}) nor "Is this for **${rosterName}**?":\n${reply.content}`).toBe(true);
}

const typo = (id: string, typed: string, what: string): ReplayCase => ({
  id,
  title: `${what}: "create a ca form for ${typed}" (roster: Odalys Prewett Vansickle): the card is hers, or the reply asks "Is this for **Odalys Prewett Vansickle**?"`,
  report: `${REPORT}; ${what}`,
  status: { open: "with production's flags (FORM_NAME off) the card keeps the typed spelling" },
  fixFlags: FIX,
  async run(t) {
    const { reply, employee } = await said(t, [ODALYS], `create a ca form for ${typed}`);
    offered(reply, employee, "Odalys Prewett Vansickle");
  },
});

export const NOV5_COMPOUND_SURNAME_CASES: ReplayCase[] = [
  typo("nov5-compound-surname-word1-typo", "Odalys Perwett Vansickle", "a typo in surname word 1"),
  typo("nov5-compound-surname-word2-typo", "Odalys Prewett Vansikcle", "a typo in surname word 2"),
  typo("nov5-compound-surname-one-word-typo", "Odalys Vansikcle", "one surname word only, with a typo"),
  {
    id: "nov5-compound-surname-word1-typo-yes",
    title: "\"create a ca form for Odalys Perwett Vansickle\", then \"yes\" to \"Is this for **Odalys Prewett Vansickle**?\": the card is hers, in the roster's spelling",
    report: `${REPORT}; the answer`,
    status: { open: "with production's flags (FORM_NAME off) the card keeps the typed spelling" },
    fixFlags: FIX,
    async run(t) {
      const { reply, employee } = await said(t, [ODALYS], "create a ca form for Odalys Perwett Vansickle, she was late opening the salon on 11/2", "yes");
      expect(employee, `"yes" did not put her on the card:\n${reply.content}`).toBe("Odalys Prewett Vansickle");
      expect(reply.content, "the account is lost").toMatch(/late opening the salon/i);
    },
  },
  {
    id: "nov5-compound-surname-exact",
    title: "negative control: the exact compound name \"Odalys Prewett Vansickle\" is her card",
    report: `${REPORT}; negative control`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const { reply, employee } = await said(t, [ODALYS], "create a ca form for Odalys Prewett Vansickle");
      expect(employee, `not her card:\n${reply.content}`).toBe("Odalys Prewett Vansickle");
    },
  },
  {
    id: "nov5-compound-surname-shared-word-asks",
    title: "negative: two roster people share the surname word (Odalys Prewett Vansickle, Odalys Dunmore Vansickle); \"Odalys Vansikcle\" is a question, never a fill",
    report: `${REPORT}; negative (QA)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const { reply, employee } = await said(t, [ODALYS, ODALYS_D], "create a ca form for Odalys Vansikcle");
      expect([ODALYS, ODALYS_D].map((p) => `${p.firstName} ${p.lastName}`), `filled with one of them:\n${reply.content}`).not.toContain(employee);
      expect(reply.content, `one of them is offered alone:\n${reply.content}`).not.toMatch(/Is this for \*\*Odalys (?:Prewett|Dunmore) Vansickle\*\*\?/);
    },
  },
  {
    id: "nov5-compound-surname-short-word-no-match",
    title: "negative: a 3-letter surname word typed with a typo (\"Thorne Ask\" for Thorne Ash Merrow) is not a match",
    report: `${REPORT}; negative (QA)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const { reply, employee } = await said(t, [THORNE], "create a ca form for Thorne Ask");
      expect(employee, `filled with Thorne Ash Merrow:\n${reply.content}`).not.toBe("Thorne Ash Merrow");
      expect(reply.content, `offered Thorne Ash Merrow:\n${reply.content}`).not.toMatch(OFFERS("Thorne Ash Merrow"));
    },
  },
];
