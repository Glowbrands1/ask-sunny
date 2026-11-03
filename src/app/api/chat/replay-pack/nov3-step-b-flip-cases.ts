import { expect } from "vitest";

import { KEARNEY, STAFF, replyMatchesDiff, savedForm, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayThread } from "./cases";

/*
 * QA'S STEP B FLIP TEST (3 Nov 2026, ~19:20 and ~19:46 UTC, Ask Sunny), FORM_PATCH_REDUCER_ENABLED and
 * FORM_REPLY_FROM_DIFF_ENABLED on: it tested worse than the baseline run with them off. The testers' exact
 * wording; the people are invented. With both flags on, the turns below answered "I didn't change anything on the
 * form." where the baseline's revision had made the change, and the replies quoted the whole field with ";" for
 * line breaks, cut with "…".
 *
 * THE FORM-PATCH MODEL IS SCRIPTED (`t.patchWrites`) as a patch the reducer refuses: the model's new wording, not
 * the manager's own words. Any refused patch led to the same no-op live; the realized behaviour is what is
 * asserted. The revision model writes what the baseline's revision wrote (`t.revisionWrites`).
 */

const PEOPLE: DirectoryRow[] = [
  ...STAFF,
  { id: "qa-jane", firstName: "Jane", lastName: "Doe", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
  { id: "qa-dana", firstName: "Dana", lastName: "Lane", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
];

const STEP_B_FLAGS = ["FORM_PATCH_REDUCER_ENABLED", "FORM_REPLY_FROM_DIFF_ENABLED"];

/** A patch the reducer refuses: a replace whose evidence is the model's own new wording, not the manager's. */
function refusedRewrite(field: string, value: string) {
  return { turn: "this_form", set: [{ field, value, how: "replace", evidence: value }], clear: [] };
}

async function turnOnDraft(t: Parameters<ReplayCase["run"]>[0], thread: ReplayThread, id: string, text: string): Promise<ReplayAnswer> {
  const before = savedForm(t, id);
  const reply = await thread.say(text);
  replyMatchesDiff(t, id, before, reply, text);
  return reply;
}

const DANA_DETAILS = "Observed:\nDana Lane was late to open the location today.\nExpectation:\nDana is expected to arrive on time and be ready to open.";

export const NOV3_STEP_B_FLIP_CASES: readonly ReplayCase[] = [
  {
    id: "nov3-stepb-flip-redraft-also-late",
    title: "\"redraft it and say she was also late on Tuesday\" on a Corrective Action draft adds it, as the baseline did",
    report:
      'QA Step B flip test, 3 Nov 2026 (Ask Sunny): "Create a Corrective Action for Jane Doe, she was late to open on 10-20-26" → "fix her last name, it is Doe-Smith" → "redraft it and say she was also late on Tuesday" → "I didn\'t change anything on the form." (baseline: "and was also late on Tuesday" added to the Observation)',
    status: "fixed",
    fixFlags: STEP_B_FLAGS,
    async run(t) {
      t.directory(PEOPLE);
      t.as("salon_director", KEARNEY);
      const observation = "Jane Doe was late to open on 10-20-26.";
      t.draftWrites({ observation });
      const thread = t.thread();
      await thread.say("Create a Corrective Action for Jane Doe, she was late to open on 10-20-26");
      expect(thread.proposal).toMatchObject({ templateKey: "dpoa", employeeName: "Jane Doe" });
      const id = await thread.create();
      t.patchWrites([refusedRewrite("observation", "Jane Doe was late to open on 10-20-26 and was also late on Tuesday. She is expected to open on time.")]);
      t.revisionWrites({ observation: `${observation} She was also late on Tuesday.` });
      const reply = await turnOnDraft(t, thread, id, "redraft it and say she was also late on Tuesday");
      expect(t.values(id).observation ?? "", "Tuesday never reached the Observation").toMatch(/also late on Tuesday/i);
      expect(reply.content, "the reply says nothing changed").not.toMatch(/didn't change anything/i);
    },
  },
  {
    id: "nov3-stepb-flip-last-name-laine",
    title: "\"fix her last name, it is Laine\" on a Coaching Form changes the Details, as the baseline did",
    report:
      'QA Step B flip test, 3 Nov 2026 (Ask Sunny): "Create a coaching form for Dana Lane, she was late to open today" → "fix her last name, it is Laine" → "I didn\'t change anything on the form." (baseline: the Details of Coaching were changed)',
    status: "fixed",
    fixFlags: STEP_B_FLAGS,
    async run(t) {
      t.directory(PEOPLE);
      t.as("salon_director", KEARNEY);
      t.draftWrites({ coaching_details: DANA_DETAILS });
      const thread = t.thread();
      await thread.say("Create a coaching form for Dana Lane, she was late to open today");
      expect(thread.proposal).toMatchObject({ templateKey: "coaching", employeeName: "Dana Lane" });
      const id = await thread.create();
      const renamed = DANA_DETAILS.replace("Dana Lane", "Dana Laine");
      t.patchWrites([refusedRewrite("coaching_details", renamed)]);
      t.revisionWrites({ coaching_details: renamed });
      const reply = await turnOnDraft(t, thread, id, "fix her last name, it is Laine");
      expect(t.values(id).coaching_details ?? "", "the Details still say Lane").toContain("Dana Laine");
      expect(reply.content, "the reply says nothing changed").not.toMatch(/didn't change anything/i);
    },
  },
  ...(["make it sound more professional", "can you make it more professional"] as const).map(
    (wording): ReplayCase => ({
      id: `nov3-stepb-flip-professional-${wording.startsWith("can") ? "can-you" : "make-it"}`,
      title: `"${wording}" rewrites the Coaching draft when the patch model offers its own wording`,
      report: `QA Step B flip test, 3 Nov 2026 (Ask Sunny): "${wording}" → "I didn't change anything on the form." (baseline: the Details were rewritten). The wording-only case (a patch that sets nothing) already hands over; this is a patch that sets the model's own rewrite, which the reducer refuses`,
      status: "fixed",
      fixFlags: STEP_B_FLAGS,
      async run(t) {
        t.directory(PEOPLE);
        t.as("salon_director", KEARNEY);
        t.draftWrites({ coaching_details: DANA_DETAILS });
        const thread = t.thread();
        await thread.say("Create a coaching form for Dana Lane, she was late to open today");
        const id = await thread.create();
        const polished = "Observed:\nDana Lane did not arrive in time to open the location today.\nExpectation:\nDana will arrive on time and be prepared to open.";
        t.patchWrites([refusedRewrite("coaching_details", polished)]);
        t.revisionWrites({ coaching_details: polished });
        const reply = await turnOnDraft(t, thread, id, wording);
        expect(t.values(id).coaching_details ?? "", "the Details were not rewritten").toContain("Dana Lane did not arrive in time to open the location today.");
        expect(reply.content, "the reply says nothing changed").not.toMatch(/didn't change anything/i);
      },
    }),
  ),
  {
    id: "nov3-stepb-flip-reply-says-what-was-added",
    title: "\"set the daily stats to 3 of 4 shifts on time\": the reply names what was added, not the whole field \";\"-joined and cut",
    report:
      'QA Step B flip test, 3 Nov 2026 (Ask Sunny): "set the daily stats to 3 of 4 shifts on time" → \'Changed Details of Coaching to "Observed:; Dana Lane was late to open the location today.; Expectation:; Dana is expected to arrive on time and be…".\'',
    status: "fixed",
    fixFlags: STEP_B_FLAGS,
    async run(t) {
      t.directory(PEOPLE);
      t.as("salon_director", KEARNEY);
      t.draftWrites({ coaching_details: DANA_DETAILS });
      const thread = t.thread();
      await thread.say("Create a coaching form for Dana Lane, she was late to open today");
      const id = await thread.create();
      t.patchWrites([{ turn: "this_form", set: [{ field: "coaching_details", value: "Daily stats: 3 of 4 shifts on time.", how: "add", evidence: "set the daily stats to 3 of 4 shifts on time" }], clear: [] }]);
      const reply = await turnOnDraft(t, thread, id, "set the daily stats to 3 of 4 shifts on time");
      // The reply from the diff exists only with Step B on; off, the revision path answers (and writes nothing here).
      if (process.env.FORM_REPLY_FROM_DIFF_ENABLED !== "true") return;
      expect(t.values(id).coaching_details ?? "").toContain("3 of 4 shifts on time");
      expect(reply.content, "the reply quotes the whole field with ';' for line breaks or cut with '…'").not.toMatch(/;|…/);
      expect(reply.content, "the reply does not say what was added").toMatch(/3 of 4 shifts on time/);
    },
  },
];
