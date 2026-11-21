import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * TWO HEADINGS STILL GET AN EXPECTATION, AND THE NAME STAYS THE FIRST NAME (QA's live test of #1154, 20 Nov 2026; f075)
 * ============================================================================
 *
 * Production main 29270d58, saved draft cc76856b (chat conv_mwp86jzp2pe5qsq). The manager typed "ca for Test Testy, not in
 * dress code, no name tag and no goal sheet"; the card cited two headings (Dress Code and Standards of Conduct, #1154).
 * Saved: "Observed: Test was not in dress code, was not wearing a name tag, and did not have a goal sheet. Expectation:
 * [EMPTY] Going Forward: Test should arrive … Test Testy is expected to comply with the current Sun Tan City
 * requirements…". The Expectation section was empty, the name switched from the first name to the full name, and the
 * expectation sentence sat under Going Forward. On the real Create path; the drafting model is a stand-in that writes a
 * three-section draft as the live one does. The tester's invented "Test Testy" is STAFF's invented Remy Calder here.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live test of #1154 (20 Nov 2026, f075): two headings saved an empty Expectation and switched to the full name";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

const SAID = "ca for Remy Calder, not in dress code, no name tag and no goal sheet";
const ACCOUNT = "Remy was not in dress code, was not wearing a name tag, and did not have a goal sheet.";
/** The production manual's Dress Code section, as its chunk lays it out (printed page 15; wording invented). */
const DRESS_CODE = {
  chunkIndex: 44,
  chunkId: "jba-44",
  locator: "Page 15 — Dress Code for The Company",
  page: 16,
  printedPage: 15,
  section: "Dress Code for The Company",
  sections: [{ heading: "Dress Code for The Company", page: 15 }, { heading: "All Locations Dress Code", page: 15 }],
  content: "Dress Code for The Company\nEmployees wear approved work attire and their name tag on every shift.\nAll Locations Dress Code:\nNo mini skirts or short shorts.",
};
/**
 * The draft as the live drafter wrote it, from the saved text (the person invented): the Expectation heading with nothing
 * under it, and the expectation sentence, with the full name, at the end of Going Forward.
 */
const LIVE_DRAFT =
  "Observed:\nRemy was not in dress code, was not wearing a name tag, and did not have a goal sheet.\n\nExpectation:\n\nGoing Forward:\nRemy should arrive in full dress code with a name tag and a goal sheet for every shift. Remy Calder is expected to comply with the current Sun Tan City requirements for dress code, name tags and goal sheets.";

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    vi.setSystemTime(new Date("2026-11-20T18:00:00Z"));
    t.directory([...STAFF]);
    t.as("salon_director", KEARNEY);
    t.manualAlsoHas!([DRESS_CODE]);
    await run(t);
  },
});

async function created(t: ReplayContext, policy: string) {
  t.loopModel!(loopStandIn((view): LoopDecision => lastResult(view, "propose_form")
    ? { text: "Here's the Corrective Action Form for **Remy**." }
    : { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "Remy Calder"), what_happened: ACCOUNT, policy, incident_date: "2026-11-20" } }));
  t.draftWrites({ observation: LIVE_DRAFT });
  const thread = t.thread();
  await thread.say(SAID);
  const id = await thread.create();
  return t.values(id).observation ?? "";
}

/** The text under one heading of the write-up ("" when the heading is there with nothing under it). */
const section = (text: string, label: string) => new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n\\s*(?:Observed|Expectation|Going Forward):|$)`, "i").exec(text)?.[1]?.trim() ?? null;

function expectFilledFirstName(observation: string) {
  expect(observation, "no Observation was saved (the case proves nothing)").toMatch(/goal sheet/);
  const expectation = section(observation, "Expectation");
  expect(expectation, `the Expectation section is missing or empty:\n${observation}`).toBeTruthy();
  expect(expectation, `the Expectation is not about Remy:\n${observation}`).toMatch(/^Remy is expected to\b/);
  expect(section(observation, "Going Forward") ?? "", `the expectation sentence drifted into Going Forward:\n${observation}`).not.toMatch(/is expected to/);
  expect(observation, `the write-up switches to the full name:\n${observation}`).not.toMatch(/Remy Calder/);
}

export const NOV20_WRITE_UP_EXPECTATION_TWO_HEADINGS_CASES: ReplayCase[] = [
  fixed("nov20-f075-two-headings-expectation-filled-first-name", `f075: "${SAID}", the card citing Dress Code and Standards of Conduct: the saved Expectation is filled, about Remy, and the write-up calls her Remy throughout`, async (t) => {
    expectFilledFirstName(await created(t, "Dress Code for The Company; Standards of Conduct"));
  }),
  fixed("nov20-f075-one-heading-control", `Control: "${SAID}", the card citing Dress Code alone: the same filled Expectation and first name`, async (t) => {
    expectFilledFirstName(await created(t, "Dress Code for The Company"));
  }),
];
