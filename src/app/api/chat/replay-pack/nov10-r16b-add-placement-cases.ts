import { expect, vi } from "vitest";

import { KEARNEY, replyMatchesDiff, savedForm, type ReplayCase, type ReplayContext } from "./cases";
import { REFUSAL_ROSTER, STEP_B_READER_FLAGS, patch } from "./nov7-step-b-refusals-scenarios";

/**
 * QA's round-16b live test in Ask Bubbles (10 Nov 2026; checked here; the person invented): on a saved coaching draft whose Details read
 * "Observed: … / Expectation: … / Going Forward: …", "can you add that she was reminded of the policy" put the new
 * sentence INSIDE the Expectation paragraph ("…unable to attend. Ottoline was reminded of the policy.") instead of
 * as its own line under Observed (or at the end of Details). Two reader shapes are scripted: an "add" of the sentence,
 * and the whole text with the sentence glued onto the Expectation paragraph.
 */
const SAID = "can you add that she was reminded of the policy";
const REQUEST = "create a coaching form for Ottoline Ormsworth, she missed the monthly meeting on 10/10/26";
const EXPECTATION = "Ottoline is expected to attend every scheduled meeting or tell the manager in advance if unable to attend.";
const DETAILS = `Observed:\nOttoline Ormsworth missed the monthly meeting on 10/10/26.\n\nExpectation:\n${EXPECTATION}\n\nGoing Forward:\nOttoline will put every scheduled meeting on the calendar.`;
const ADDED = "Ottoline was reminded of the policy.";
const REPORT = "QA's round-16b live test (Ask Bubbles), 10 Nov 2026: the added sentence went inside the Expectation paragraph";

async function run(t: ReplayContext, reading: (saved: string) => unknown): Promise<string> {
  vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
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

function placed(details: string): void {
  const sections = details.split(/\n\s*(?=Expectation:|Going Forward:)/);
  const observed = sections[0] ?? "";
  expect(observed, `the added sentence is not under Observed:\n${details}`).toContain(ADDED);
  expect(details, `the added sentence is glued into another section:\n${details}`).not.toMatch(/unable to attend\.\s*Ottoline was reminded/);
  expect(details, "the Expectation lost its words").toContain(EXPECTATION);
  expect(details, "the account lost its words").toMatch(/missed the monthly meeting on 10\/10\/26/);
}

export const NOV10_R16B_ADD_PLACEMENT_CASES: ReplayCase[] = [
  {
    id: "nov10-r16b-add-reminded-under-observed",
    title: "\"can you add that she was reminded of the policy\" (the reader adds the sentence): it goes under Observed, never into Expectation",
    report: REPORT,
    status: { open: "the added sentence is appended to the end of the Details, after the last section" },
    fixFlags: [...STEP_B_READER_FLAGS, "STEP_B_ADD_UNDER_OBSERVED_ENABLED"],
    async run(t) {
      placed(await run(t, () => patch("this_form", [{ field: "coaching_details", value: ADDED, how: "add", evidence: "she was reminded of the policy" }])));
    },
  },
  {
    id: "nov10-r16b-add-reminded-glued-into-expectation",
    title: "…the reader writes the whole text with the sentence glued onto the Expectation paragraph: it is moved under Observed",
    report: REPORT,
    status: { open: "the saved Details have the sentence inside the Expectation paragraph" },
    fixFlags: [...STEP_B_READER_FLAGS, "STEP_B_ADD_UNDER_OBSERVED_ENABLED", "ADD_OUT_OF_OTHER_SECTIONS_ENABLED"],
    async run(t) {
      placed(
        await run(t, (saved) =>
          patch("this_form", [
            { field: "coaching_details", value: saved.replace(EXPECTATION, `${EXPECTATION} ${ADDED}`), how: "replace", evidence: "she was reminded of the policy" },
          ]),
        ),
      );
    },
  },
];
