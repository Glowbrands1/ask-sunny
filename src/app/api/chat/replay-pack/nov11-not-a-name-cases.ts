import { expect, vi } from "vitest";

import { STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * QA's stale-PR cleanup (11 Nov 2026), #227 (NOT_A_NAME_GUARD_ENABLED, never merged). QA's B4 / B8 / G11 / G4 turns,
 * as typed and in lower case: the card said **Test** after "verbal", put "Ne" on the card for "…at Kearney, NE",
 * asked "Who is this for?" for "…at lincoln, ne", and dropped the employee when "Test Employee" opened a sentence.
 * QA's placeholder "Test Employee" is nobody; it is off the roster, as in QA's runs.
 */
const EVERY_SALON = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const REPORT = "#227 (QA B4/B8/G11/G4, 25 Oct 2026; Pau, 26 Oct: \"lowercase or first letter capitalized, should be like human\")";

const TURNS: Record<string, readonly string[]> = {
  b4: [
    "create ca form for Test Employee for violating attendance policy on 10-20-26. verbal. no payroll deduct. jba manual 1-1-26 for previous coaching",
    "verbal",
  ],
  b8: [
    "write a verbal CA for Tanning Consultant, Test Employee at Kearney, NE. On 10-20-26 Test Employee was late for shift and did not call supervisor as outlined in attendance policy. payroll deduct is not applicable. previous coaching is JBA Manual 1-1-25",
  ],
  g11: [
    "create a written corrective action for tanning consultant Test Employee at lincoln, ne. location. previous coaching jba manual 1-1-95, verbal ca 10-5-26. payroll deduct is applicable and $25 will be payroll deducted for late open on 10-21-26",
  ],
};
const G4 = [
  "Help me prepare a coaching form for not completing daily cleaning duties and signing off on daily cleaning checklists when the tasks are not completed",
  "Okay let's restart. Test Employee, Tanning Consultant, KS Manhattan. Not completing closing duties and signing off that they were complete when they weren't. Not completing proper sanitation procedures on the equipment.",
];

/** QA's placeholder on the roster, for the G4 twin (the off-roster G4 meets FORM_NAME_FROM_ROSTER's request-slot rule). */
const TEST_EMPLOYEE: DirectoryRow = {
  id: "e-notaname-te",
  firstName: "Test",
  lastName: "Employee",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0462"],
  positionName: "Tanning Consultant",
};

function start(t: ReplayContext, onRoster = false) {
  vi.setSystemTime(new Date("2026-10-24T15:00:00Z"));
  t.directory(onRoster ? [...STAFF, TEST_EMPLOYEE] : STAFF);
  t.as("district_manager", EVERY_SALON);
  return t.thread();
}

async function caCard(t: ReplayContext, turns: readonly string[]) {
  const thread = start(t);
  for (const turn of turns) {
    const reply = await thread.say(turn);
    expect(thread.proposal, `turn "${turn.slice(0, 40)}": no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Test Employee" });
    expect(reply.content, `turn "${turn.slice(0, 40)}" asks who the form is for`).not.toMatch(/who is this \*\*/i);
  }
}

async function g4(t: ReplayContext, turns: readonly string[], onRoster = false) {
  const thread = start(t, onRoster);
  t.slotsRead({ formType: "coaching" });
  await thread.say(turns[0]!);
  t.slotsRead({ formType: "coaching", title: "Tanning Consultant" });
  const reply = await thread.say(turns[1]!);
  expect(thread.proposal?.employeeName ?? null, `the employee was dropped:\n${reply.content}`).toBe("Test Employee");
  expect(reply.content).not.toMatch(/who is this|full name/i);
}

const lower = (text: string) => text.toLowerCase();
/*
 * NOT_A_NAME_GUARD_ENABLED is already on in production, so #227's code (merged with this case) changes production
 * directly: before the merge every case below failed with production's flags (main afd00c99); after it they hold.
 */

export const NOV11_NOT_A_NAME_CASES: ReplayCase[] = [
  ...Object.entries(TURNS).flatMap(([id, turns]): ReplayCase[] => [
    { id: `nov11-not-a-name-${id}`, title: `QA ${id.toUpperCase()}: the card is for Test Employee`, report: REPORT, status: "fixed", run: (t) => caCard(t, turns) },
    { id: `nov11-not-a-name-${id}-lower`, title: `QA ${id.toUpperCase()}, all lower case: the card is for Test Employee`, report: REPORT, status: "fixed", run: (t) => caCard(t, turns.map(lower)) },
  ]),
  {
    id: "nov11-not-a-name-g4",
    title: "QA G4: \"Okay let's restart. Test Employee, …\" keeps the employee (off the roster)",
    report: REPORT,
    // Not #227's reader: the name is read, then FORM_NAME_FROM_ROSTER_ENABLED (live, `person-guard.notAPerson` →
    // `outsideRequestSlot`) drops an off-roster name that is not in the request slot ("…for <name>").
    status: { open: "FORM_NAME_FROM_ROSTER drops an off-roster name that opens a sentence (\"Test Employee\" isn't a person on your team)" },
    run: (t) => g4(t, G4),
  },
  { id: "nov11-not-a-name-g4-on-roster", title: "QA G4, Test Employee on the roster: keeps the employee", report: REPORT, status: "fixed", run: (t) => g4(t, G4, true) },
  { id: "nov11-not-a-name-g4-lower", title: "QA G4, all lower case: keeps the employee", report: REPORT, status: "fixed", run: (t) => g4(t, G4.map(lower)) },
];
