import { expect, vi } from "vitest";

import { KEARNEY, replyMatchesDiff, savedForm, type ReplayCase, type ReplayContext } from "./cases";
import { REFUSAL_ROSTER, STEP_B_READER_FLAGS, patch } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * AN ADDED LINE WENT AFTER "GOING FORWARD", AND THE SECTIONS LOST THEIR BLANK LINES (QA, LIVE, 8 Nov 2026)
 * ============================================================================
 *
 * QA's live draft test in the sibling app's production (Coaching Form v1, 8 Nov 2026; the person is invented here): on a
 * draft whose Details of Coaching read "Observed: … / Expectation: … / Going Forward: …", "add to the details that
 * she was reminded about the meeting twice" was appended after "Going Forward", and the blank lines between the
 * sections became single newlines. The reader's two shapes are scripted: an "add" of the line, and the whole text
 * with the line on the end, sections joined by single newlines.
 * STEP_B_ADD_UNDER_OBSERVED_ENABLED, STEP_B_SECTION_SPACING_ENABLED (`forms/outline-sections.ts`).
 */

const SAID = "add to the details that she was reminded about the meeting twice";
const REQUEST = "create a coaching form for Ottoline Ormsworth, she missed the monthly meeting on 10/10/26";
const DETAILS =
  "Observed:\nOttoline Ormsworth missed the monthly meeting on 10/10/26.\n\nExpectation:\nOttoline is expected to attend every scheduled meeting.\n\nGoing Forward:\nOttoline will put every scheduled meeting on her calendar.";
const ADDED = "She was reminded about the meeting twice.";
const FIX = [...STEP_B_READER_FLAGS, "STEP_B_ADD_UNDER_OBSERVED_ENABLED", "STEP_B_SECTION_SPACING_ENABLED"];
const REPORT = "QA's live draft test, the sibling app's production, 8 Nov 2026: the added line went after \"Going Forward\"; blank lines collapsed";

/** `reading`: the reader's output, from the Details as the draft saved them. */
async function run(t: ReplayContext, reading: (saved: string) => unknown): Promise<string> {
  vi.setSystemTime(new Date("2026-11-07T19:40:00Z"));
  t.directory(REFUSAL_ROSTER);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(REQUEST);
  t.draftWrites({ coaching_details: DETAILS });
  const id = await thread.create();
  t.patchReads!({ [SAID]: reading(t.values(id).coaching_details ?? "") });
  const before = savedForm(t, id);
  const reply = await thread.say(SAID);
  replyMatchesDiff(t, id, before, reply, SAID);
  return t.values(id).coaching_details ?? "";
}

function underObserved(details: string): void {
  const observed = details.split(/\n\s*Expectation:/)[0] ?? "";
  expect(observed, `the added line is not under Observed:\n${details}`).toContain(ADDED);
  expect(details.split(/Going Forward:/)[1] ?? "", `the added line is under Going Forward:\n${details}`).not.toContain(ADDED);
}

function spaced(details: string): void {
  expect(details, `the sections lost their blank lines:\n${details}`).toMatch(/\n\nExpectation:/);
  expect(details, `the sections lost their blank lines:\n${details}`).toMatch(/\n\nGoing Forward:/);
}

export const NOV8_STEP_B_OUTLINE_CASES: ReplayCase[] = [
  {
    id: "nov8-step-b-add-under-observed",
    title: "\"add to the details that she was reminded about the meeting twice\" (the reader adds the line): it goes under Observed, never after Going Forward",
    report: REPORT,
    status: { open: "the added line is written after \"Going Forward\"" },
    fixFlags: FIX,
    async run(t) {
      const details = await run(t, () => patch("this_form", [{ field: "coaching_details", value: ADDED, how: "add", evidence: "she was reminded about the meeting twice" }]));
      underObserved(details);
      spaced(details);
      expect(details, "the account lost its words").toMatch(/missed the monthly meeting on 10\/10\/26/);
    },
  },
  {
    id: "nov8-step-b-whole-text-tail",
    title: "…the reader writes the whole text, sections joined by single newlines, the line on the end: under Observed, blank lines kept",
    report: REPORT,
    status: { open: "the saved Details have the line after \"Going Forward\" and single newlines between the sections" },
    fixFlags: FIX,
    async run(t) {
      const details = await run(t, (saved) =>
        patch("this_form", [{ field: "coaching_details", value: `${saved.replace(/\n\n/g, "\n")}\n${ADDED}`, how: "replace", evidence: "she was reminded about the meeting twice" }]),
      );
      underObserved(details);
      spaced(details);
    },
  },
  {
    id: "nov8-step-b-reply-keeps-lines",
    title: "…and the reply quotes Details of Coaching line by line, never joined with \"; \"",
    report: "QA's live draft test, the sibling app's production, 8 Nov 2026: the reply quoted the field as \"Observed:; …; Expectation:; …\"",
    status: { open: "the reply quotes the field on one line, joined with \"; \"" },
    fixFlags: [...FIX, "STEP_B_REPLY_KEEPS_LINES_ENABLED"],
    async run(t) {
      let reply = "";
      vi.setSystemTime(new Date("2026-11-07T19:40:00Z"));
      t.directory(REFUSAL_ROSTER);
      t.as("salon_director", KEARNEY);
      t.patchReads!({ [SAID]: patch("this_form", [{ field: "coaching_details", value: ADDED, how: "add", evidence: "she was reminded about the meeting twice" }]) });
      const thread = t.thread();
      await thread.say(REQUEST);
      t.draftWrites({ coaching_details: DETAILS });
      await thread.create();
      reply = (await thread.say(SAID)).content;
      expect(reply, `the reply joins the field's lines with "; ":\n${reply}`).not.toMatch(/Observed:;/);
      expect(reply, `the reply does not quote the added line:\n${reply}`).toContain(ADDED);
    },
  },
];

/*
 * Ported from the sibling app (QA, 12 Nov 2026, from Gate-Bubbles-2 on its #814): with no Expectation section in the field, an instruction ("add that she
 * must …") still landed under Observed. Ruling (b): an instruction goes into the Expectation — so one is started, on its
 * own line after the Observed block. STEP_B_ADD_UNDER_OBSERVED_ENABLED (`forms/outline-sections.ts`). The person invented.
 */
const OBSERVED_ONLY = "Observed:\nOttoline Ormsworth missed the monthly meeting on 10/10/26.";
const INSTRUCTION_SAID = "add that she must put every scheduled meeting on her calendar";
const INSTRUCTION = "She must put every scheduled meeting on her calendar.";

export const NOV12_STEP_B_INSTRUCTION_STARTS_EXPECTATION_CASES: ReplayCase[] = [
  {
    id: "nov12-step-b-instruction-starts-expectation",
    title: "Details with only an Observed section, then \"add that she must …\": an Expectation section is started for it, never the line under Observed",
    report: "QA, 12 Nov 2026 (from Gate-Bubbles-2 on the sibling's #814): an instruction landed under Observed when there was no Expectation section",
    status: { open: "the instruction is appended under Observed" },
    fixFlags: FIX,
    async run(t) {
      vi.setSystemTime(new Date("2026-11-07T19:40:00Z"));
      t.directory(REFUSAL_ROSTER);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(REQUEST);
      t.draftWrites({ coaching_details: OBSERVED_ONLY });
      const id = await thread.create();
      t.patchReads!({ [INSTRUCTION_SAID]: patch("this_form", [{ field: "coaching_details", value: INSTRUCTION, how: "add", evidence: "she must put every scheduled meeting on her calendar" }]) });
      const before = savedForm(t, id);
      const reply = await thread.say(INSTRUCTION_SAID);
      replyMatchesDiff(t, id, before, reply, INSTRUCTION_SAID);
      const details = t.values(id).coaching_details ?? "";
      expect(details, `no Expectation section was started for the instruction:\n${details}`).toContain(`\n\nExpectation:\n${INSTRUCTION}`);
      expect(details.split(/\n\s*Expectation:/)[0] ?? "", `the instruction is under Observed:\n${details}`).not.toContain(INSTRUCTION);
      expect(details, "the account lost its words").toMatch(/missed the monthly meeting on 10\/10\/26/);
    },
  },
];
