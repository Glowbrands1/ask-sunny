import { expect, vi } from "vitest";

import { STAFF, KEARNEY, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "FOR <FIRST NAME> FAILING TO COMPLETE SHIFTS" IS NO "<FIRST> FAILING" (QA round 5, sf-s38; production, 7 Nov 2026)
 * ============================================================================
 *
 * The manager's words (the employees invented, none on the directory): after "make me an CA for <name> missing her
 * saturday and sunday shifts …", "make me CA for <first name> failing to complete shifts" made the card for "<First>
 * Failing", and Create refused the first card as out of date ("… for <name> missing, not <name>"): the name reader
 * read the verb opening the account as part of the name. ACCOUNT_VERB_NOT_A_NAME_ENABLED cuts the name there (Pau's
 * lines in the protected `forms/proposal.ts`, `forms/not-a-name.ts` nameBeforeAccountVerb). Each case goes through
 * Create: the saved form is made out to the roster person. The must-not-change names hold either way.
 */
function person(id: string, firstName: string, lastName: string): DirectoryRow {
  return { id, firstName, lastName, preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
}
const PEOPLE = [
  person("e-rhea-calloway-s38", "Rhea", "Calloway"),
  person("e-ines-varga-lund-s38", "Ines", "Varga-Lund"),
  person("e-mary-jane-oneil-s38", "Mary-Jane", "O'Neil"),
  person("e-caoimhe-odallagher-s38", "Caoimhe", "O'Dallagher"),
];
const T1 =
  "make me an CA for Rhea Calloway missing her saturday and sunday shifts due to wanting to go home for the weekend but failed to communicate proporley";
const FIX = ["ACCOUNT_VERB_NOT_A_NAME_ENABLED"];
const REPORT = "QA round 5, sf-s38 (production chat f5e4e29a, 7 Nov 2026)";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-07T16:14:00Z"));
  t.directory([...STAFF, ...PEOPLE]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

/** The turn's card is for `name`, and Create saves the form made out to `name`. */
async function cardAndForm(t: ReplayContext, turns: readonly string[], name: string) {
  const thread = start(t);
  let content = "";
  for (const turn of turns) content = (await thread.say(turn)).content;
  expect(thread.proposal?.employeeName ?? null, `the card is not for ${name}:\n${content}`).toBe(name);
  const id = await thread.create();
  expect(t.values(id).employee_name, "the saved form's employee").toBe(name);
}

type Row = { id: string; title: string; turns: readonly string[]; name: string; open?: string };

const ROWS: Row[] = [
  // Fixed rows.
  { id: "failing-first-name-in-chat", title: "T1, T1, \"create it\", then \"make me CA for <first name> failing to complete shifts\"", turns: [T1, T1, "create it", "make me CA for rhea failing to complete shifts"], name: "Rhea Calloway", open: "the card is for \"Rhea Failing\"" },
  { id: "failing-full-name", title: "\"make me CA for <First Last> failing to complete shifts\"", turns: ["make me CA for Rhea Calloway failing to complete shifts"], name: "Rhea Calloway", open: "Create refuses: \"the form is for Rhea Calloway failing, not Rhea Calloway\"" },
  { id: "missing-t1", title: "T1 \"make me an CA for <First Last> missing her saturday and sunday shifts …\"", turns: [T1], name: "Rhea Calloway", open: "Create refuses: \"the form is for Rhea Calloway missing, not Rhea Calloway\"" },
  { id: "missing-hyphenated", title: "\"make me a CA for <First Last-Name> missing her shift\"", turns: ["make me a CA for Ines Varga-Lund missing her shift"], name: "Ines Varga-Lund", open: "Create refuses: \"the form is for Ines Varga-Lund missing, not Ines Varga-Lund\"" },
  // Must not change.
  { id: "keep-lowercase-two-words", title: "must not change: \"make me a CA for <first last>\" (lower case)", turns: ["make me a CA for rhea calloway"], name: "Rhea Calloway" },
  { id: "keep-being-late", title: "must not change: \"ca for <first last> being late on 11/2\"", turns: ["ca for rhea calloway being late on 11/2"], name: "Rhea Calloway" },
  { id: "keep-hyphen-apostrophe", title: "must not change: \"make me a CA for <Mary-Jane O'Neil>, she was late\"", turns: ["make me a CA for Mary-Jane O'Neil, she was late"], name: "Mary-Jane O'Neil" },
  { id: "keep-apostrophe", title: "must not change: \"create a ca form for <Caoimhe O'Dallagher>, they were late opening the salon on 11/2\"", turns: ["create a ca form for Caoimhe O'Dallagher, they were late opening the salon on 11/2"], name: "Caoimhe O'Dallagher" },
  { id: "keep-not-showing-up", title: "must not change: \"Make me a CA for <First Last> not showing up to her shifts on  11/7 and 11/8\"", turns: ["Make me a CA for Rhea Calloway not showing up to her shifts on  11/7 and 11/8"], name: "Rhea Calloway" },
];

export const NOV8_ACCOUNT_VERB_NOT_A_NAME_CASES: ReplayCase[] = ROWS.map(
  (row): ReplayCase => ({
    id: `nov8-s38-${row.id}`,
    title: `${row.title}: the card and the saved form are for ${row.name}`,
    report: REPORT,
    status: row.open ? { open: row.open } : "fixed",
    fixFlags: FIX,
    async run(t) {
      await cardAndForm(t, row.turns, row.name);
    },
  }),
);
