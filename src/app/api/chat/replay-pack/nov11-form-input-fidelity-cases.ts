import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * QA's stale-PR cleanup (11 Nov 2026), #166 (FORM_INPUT_FIDELITY_ENABLED, never merged). Live replays, 24 Oct 2026:
 * a manager typed the incident date ("yesterday", "last Tuesday") and the draft was dated today; a later bare
 * "verbal", "written", "yes" or "Monday" was saved as Job Title (the slot model copied it into the title slot).
 * Today is Saturday 24 Oct 2026. The person is invented; the roster has no title for her, so a title on the card
 * can only come from the chat.
 */
const WRENNA: DirectoryRow = {
  id: "e-fidelity-wrenna-haltby",
  firstName: "Wrenna",
  lastName: "Haltby",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: null,
};
const REPORT = "#166 (live replays, 24 Oct 2026): typed incident dates became today; a bare \"verbal\" / \"written\" / \"yes\" / \"Monday\" became Job Title";
const FIX = ["FORM_INPUT_FIDELITY_ENABLED"];
const OPEN = { open: "a bare follow-up the slot model copied into the title slot is saved as Job Title (#166)" };

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-10-24T15:00:00Z"));
  t.directory([...STAFF, WRENNA]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

async function inlineDate(t: ReplayContext, typed: string, iso: string) {
  const thread = start(t);
  const reply = await thread.say(`Create a Corrective Action form for Wrenna Haltby. She wore slippers ${typed}.`);
  expect(thread.proposal, `no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Wrenna Haltby" });
  expect(thread.proposal?.formDate ?? null, `"${typed}" is not the card's date:\n${reply.content}`).toBe(iso);
}

async function bareFollowUp(t: ReplayContext, said: string) {
  const thread = start(t);
  await thread.say("Create a Corrective Action Form for Wrenna Haltby. She was late.");
  t.slotsRead({ title: said, formTurn: true, formType: "Corrective Action Form", employee: "Wrenna Haltby" });
  const reply = await thread.say(said);
  expect(thread.proposal, `no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Wrenna Haltby" });
  const role = thread.proposal?.employeeRole ?? "";
  expect(role.toLowerCase(), `"${said}" was saved as Job Title:\n${reply.content}`).not.toContain(said.toLowerCase());
  expect(reply.content, `"${said}" is shown as Job Title`).not.toMatch(new RegExp(`\\*\\*Job title:\\*\\*\\s*${said}\\b`, "i"));
}

export const NOV11_FORM_INPUT_FIDELITY_CASES: ReplayCase[] = [
  ...([
    ["yesterday", "2026-10-23"],
    ["last Tuesday", "2026-10-20"],
    ["on Oct 20", "2026-10-20"],
    ["on 10/20", "2026-10-20"],
  ] as const).map(([typed, iso]): ReplayCase => ({
    id: `nov11-fidelity-date-${typed.replace(/\W+/g, "-").toLowerCase()}`,
    title: `"She wore slippers ${typed}.": the card is dated ${iso}`,
    report: REPORT,
    // Holds on main afd00c99 with production's flags (main's own date readers); kept so #166's date reader cannot undo it.
    status: "fixed",
    fixFlags: FIX,
    run: (t) => inlineDate(t, typed, iso),
  })),
  ...["verbal", "written", "yes", "Monday"].map((said): ReplayCase => ({
    id: `nov11-fidelity-title-${said.toLowerCase()}`,
    title: `a bare "${said}" after the card is not the Job Title`,
    report: REPORT,
    status: OPEN,
    fixFlags: FIX,
    run: (t) => bareFollowUp(t, said),
  })),
];
