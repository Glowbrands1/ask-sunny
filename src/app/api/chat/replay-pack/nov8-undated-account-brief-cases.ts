import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * QA's live Create test of sf-s38 (8 Nov 2026): after
 *   "make me an CA for <name> missing her saturday and sunday shifts due to wanting to go home for the weekend but
 *    failed to communicate proporley"
 * and Create, the saved Observation said she "missed both the Saturday and Sunday scheduled shifts on November 8,
 * 2026", the day the form was created. The manager gave no date; the draft brief told the model "This is the date of
 * the incident and of this form". UNDATED_ACCOUNT_BRIEF_ENABLED tells the drafting model, when the manager gave no
 * date, that the form's date is not the incident's and that no date goes in the account. A stated "today" is a date
 * and keeps the brief as it was. The person is invented (as in nov8-account-verb-not-a-name-cases.ts).
 */
const FLAG = "UNDATED_ACCOUNT_BRIEF_ENABLED";
const REPORT = "QA's live Create test, sf-s38 (8 Nov 2026): the Observation dated the missed weekend shifts \"November 8, 2026\", the form's date";
const T1 =
  "make me an CA for Rhea Calloway missing her saturday and sunday shifts due to wanting to go home for the weekend but failed to communicate proporley";
const RHEA: DirectoryRow = {
  id: "e-rhea-calloway-undated",
  firstName: "Rhea",
  lastName: "Calloway",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};
const NO_DATE_LINE = /the manager gave no date for what happened\. Write no date in the account, and never "November 8, 2026"/;
const INCIDENT_LINE = /This is the date of the incident and of this form/;

/** Everything the drafting model was given on the one Create: its system prompt and its prompt. */
async function briefOnCreate(t: ReplayContext, said: string): Promise<string> {
  vi.setSystemTime(new Date("2026-11-08T16:14:00Z"));
  t.directory([...STAFF, RHEA]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  const reply = await thread.say(said);
  expect(thread.proposal?.employeeName ?? null, `no card for Rhea Calloway:\n${reply.content}`).toBe("Rhea Calloway");
  await thread.create();
  return [...(t.draftSystems?.() ?? []), ...t.draftPrompts()].join("\n");
}

export const NOV8_UNDATED_ACCOUNT_BRIEF_CASES: ReplayCase[] = [
  {
    id: "nov8-undated-weekend-shifts-no-form-date",
    title: "sf-s38 T1 (\"missing her saturday and sunday shifts\", no date) → Create: the drafting model is told no date goes in the account, never that the form's date is the incident's",
    report: REPORT,
    status: { open: "the draft brief says \"This is the date of the incident and of this form\" with no date given; the saved Observation dated the shifts November 8, 2026" },
    fixFlags: [FLAG],
    async run(t) {
      const brief = await briefOnCreate(t, T1);
      expect(brief, "the brief names the form's date as the incident's").not.toMatch(INCIDENT_LINE);
      expect(brief, "the brief does not say the manager gave no date").toMatch(NO_DATE_LINE);
    },
  },
  {
    id: "nov8-undated-today-keeps-form-date",
    title: "negative: \"… rude to a client at the front desk today\" → Create: a stated \"today\" is the form's date, the brief is unchanged",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const brief = await briefOnCreate(t, "make me an CA for Rhea Calloway for being rude to a client at the front desk today");
      expect(brief, "a stated today lost the form's date").toMatch(INCIDENT_LINE);
      expect(brief, "a stated today was read as no date").not.toMatch(NO_DATE_LINE);
    },
  },
];
