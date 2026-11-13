import { expect, vi } from "vitest";

import { KEARNEY, replyMatchesDiff, savedForm, type ReplayCase, type ReplayContext } from "./cases";
import { REFUSAL_ROSTER, STEP_B_READER_FLAGS, patch } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * THE EDIT SEES THE SAVED FORM (EDIT_SEES_SAVED_FORM_ENABLED; Pau's direction via QA, 13 Nov 2026)
 * ============================================================================
 *
 * The form edit read the turn once as a patch and never looked at what was saved: a reading that missed part of the
 * ask left it off the form, and nothing noticed. On, the patch model is handed the stored form after the write, with the
 * manager's ask ("SAVED AFTER YOUR LAST PATCH"), and confirms it or sends a correction (`forms/form-patch-turn.ts`,
 * `checkSavedForm`). EVERY CHECK ROUND IS SCRIPTED HERE (`t.patchChecks`); an unscripted round confirms.
 *
 * The person is invented (the refusal roster's).
 */

const FIX = [...STEP_B_READER_FLAGS, "EDIT_SEES_SAVED_FORM_ENABLED"];
const REPORT = "Pau's direction via QA, 13 Nov 2026: the form edit stops editing blind; it checks the saved form and corrects it";
const DRAFT = "Observed:\nOttoline Ormsworth missed the monthly meeting on 10/10/26.";
const ASK = "add that she must attend every monthly meeting, and the other topic is missed monthly meeting";

/** The first reading: the expectation only. The topic the manager also asked for is missed. */
const FIRST = patch("this_form", [{ field: "coaching_details", value: "She must attend every monthly meeting.", how: "add", evidence: "she must attend every monthly meeting" }]);
/** The check round's correction: the topic, from the manager's words. */
const TOPIC = patch("this_form", [
  { field: "other_topic", value: "Missed monthly meeting", how: "replace", evidence: "missed monthly meeting" },
  { field: "coaching_topics", options: ["other"], how: "replace", evidence: "the other topic is missed monthly meeting" },
]);

async function onDraft(t: ReplayContext, checks: readonly unknown[], handOff = false, ask = ASK) {
  vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
  t.directory(REFUSAL_ROSTER);
  t.as("salon_director", KEARNEY);
  // Handed off: the patch reader falls back, and the old path's revision writes the expectation only.
  t.patchReads!(handOff ? {} : { [ask]: FIRST });
  t.patchChecks?.(checks);
  const thread = t.thread();
  await thread.say("create a coaching form for Ottoline Ormsworth, she missed the monthly meeting on 10/10/26");
  t.draftWrites({ coaching_details: DRAFT });
  const id = await thread.create();
  if (handOff) t.revisionWrites({ coaching_details: `${DRAFT}\nShe must attend every monthly meeting.` });
  const before = savedForm(t, id);
  const reply = await thread.say(ask);
  replyMatchesDiff(t, id, before, reply, ask);
  return { id, reply };
}

export const NOV13_EDIT_SEES_SAVED_FORM_CASES: ReplayCase[] = [
  {
    id: "nov13-edit-sees-saved-form-corrects-missed-part",
    title: `a saved draft, "${ASK}": the reading misses the topic; checking the saved form, the model adds it, and the reply names both`,
    report: REPORT,
    // Changed on purpose (13 Nov 2026): fixed in production by EDIT_SEES_SAVED_FORM, QA round 38f. Was OPEN.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      // Check round 1: the topic is missing from the stored form, so the model corrects it. Round 2: it confirms.
      const { id, reply } = await onDraft(t, [TOPIC, patch("this_form", [])]);
      expect(t.values(id).coaching_details ?? "", "the expectation the first reading wrote").toMatch(/attend every monthly meeting/i);
      expect(t.values(id).other_topic ?? "", "the topic, written on the check round").toMatch(/missed monthly meeting/i);
      expect(reply.content, `the reply names the topic, from the saved form:\n${reply.content}`).toMatch(/Other/);
      // Changed on purpose (QA's speed change, 13 Nov 2026): the model corrects once, and code confirms the corrected form.
      expect(t.patchCheckCalls?.() ?? 0, "one model round: the correction; code confirms after it").toBe(1);
    },
  },
  {
    id: "nov13-edit-sees-saved-form-confirms",
    title: "the same turn, the saved form already right: the model confirms on the first check, and nothing else is written",
    report: REPORT,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const { id, reply } = await onDraft(t, [patch("this_form", [])]);
      expect(t.values(id).coaching_details ?? "").toMatch(/attend every monthly meeting/i);
      expect(t.values(id).other_topic ?? "", "no topic: the model confirmed and wrote nothing").toBe("");
      expect(reply.content).not.toMatch(/Other topic/i);
      // Off, no check round is made at all.
      expect(t.patchCheckCalls?.() ?? 0).toBeLessThanOrEqual(1);
    },
  },
  {
    id: "nov13-edit-sees-saved-form-refused-correction-stops",
    title: "a correction the writer refuses (words the manager never said): nothing more is written, the loop stops, and the reply is the saved diff",
    report: REPORT,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const invented = patch("this_form", [{ field: "other_topic", value: "Repeated insubordination", how: "replace", evidence: "repeated insubordination" }]);
      const { id, reply } = await onDraft(t, [invented]);
      expect(t.values(id).other_topic ?? "", "the refused correction is not saved").not.toMatch(/insubordination/i);
      expect(reply.content).not.toMatch(/insubordination/i);
      expect(t.patchCheckCalls?.() ?? 0, "one check round, then stop").toBeLessThanOrEqual(1);
    },
  },
  {
    id: "nov13-edit-sees-saved-form-hand-off-revision-corrects",
    title: "the same turn handed off (the patch reader falls back) to the old path's revision, which writes the expectation only: the check adds the missed topic, and the reply names what is stored",
    report: `${REPORT} (QA: half the patch-path turns hand off; the loop runs after the revision's write too)`,
    // Changed on purpose (13 Nov 2026): fixed in production by EDIT_SEES_SAVED_FORM, QA round 38f. Was OPEN.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      // Check round 1: the topic is missing from the stored form, so the model corrects it. Round 2: it confirms.
      const { id, reply } = await onDraft(t, [TOPIC, patch("this_form", [])], true);
      expect(t.values(id).coaching_details ?? "", "the expectation the revision wrote").toMatch(/attend every monthly meeting/i);
      expect(t.values(id).other_topic ?? "", "the topic, written on the check round").toMatch(/missed monthly meeting/i);
      expect(reply.content, `the reply names the topic, from the saved form:\n${reply.content}`).toMatch(/Other/);
    },
  },
  {
    id: "nov13-edit-sees-saved-form-settled-by-code",
    title: "a single-field edit, \"add that she must attend every monthly meeting\": the saved form plainly does what was asked, so the check is settled by code with no model call (QA's speed change)",
    report: `${REPORT} (QA, 13 Nov 2026: a confirm costs a model call of about 1.7 s; most single-field edits must add none)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      // No check round is scripted: the code settles it, and the model is never asked.
      const { id } = await onDraft(t, [], false, "add that she must attend every monthly meeting");
      expect(t.values(id).coaching_details ?? "").toMatch(/attend every monthly meeting/i);
      expect(t.patchCheckCalls?.() ?? 0, "settled by code: no model call").toBe(0);
    },
  },
];
