import { expect } from "vitest";

import { KEARNEY, STAFF, replyMatchesDiff, savedForm, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "INCLUDE OUR WOVEN POLICY ON <TOPIC>" WRITES THE POLICY, NOT A POINTER TO IT (ported from the sibling app: QA, a
 * manager's 1★ rating there, 10 Nov 2026;
 * POLICY_TOPIC_INTO_FIELD_ENABLED)
 * ============================================================================
 *
 * The manager: "I asked it to write a coaching form on our policy for finding a cover and the sentence it gave me was to
 * refer to the woven policy manual for finding a cover." Live chat: "Create a coaching form." → "For all team members at
 * <their store>" (a whole-team Coaching card; here, the salon), the draft created, then on the saved draft "In details of coaching
 * inlude our woven policy on finding a cover for your shift" (their typo kept). The reply said "Updated the **Coaching
 * Form** for the team: Details of Coaching." and the Details became a sentence telling them to refer to the Woven policy
 * manual. The manual has the section: "Shift Replacement", printed page 37. The pointer sentence is scripted, as the
 * manager saw it: the patch model offers it and the writer refuses it, and the revision model then writes it.
 */
const EDIT = "In details of coaching inlude our woven policy on finding a cover for your shift";
const POINTER = "Refer to the Woven policy manual for finding a cover for your shift.";

export const NOV10_POLICY_TOPIC_IN_FIELD_CASES: ReplayCase[] = [
  {
    id: "nov10-policy-topic-in-field-finding-a-cover",
    title: "a saved whole-team Coaching draft, \"In details of coaching inlude our woven policy on finding a cover for your shift\": the Details hold the Shift Replacement section and its citation, never a pointer",
    report:
      "QA, a manager's 1★ rating (10 Nov 2026): \"I asked it to write a coaching form on our policy for finding a cover and the sentence it gave me was to refer to the woven policy manual for finding a cover.\"",
    status: { open: "Details of Coaching: \"Refer to the Woven policy manual for finding a cover for your shift.\"" },
    fixFlags: ["POLICY_TOPIC_INTO_FIELD_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      t.patchWrites([{ turn: "this_form", set: [{ field: "coaching_details", value: POINTER, how: "add", evidence: "our woven policy on finding a cover for your shift" }], clear: [] }]);
      const thread = t.thread();
      await thread.say("Create a coaching form.");
      await thread.say("For all team members at kearney");
      expect(thread.proposal, "no whole-team Coaching card").toMatchObject({ templateKey: "coaching", subject: "team" });
      const id = await thread.create();
      // The pointer sentence the manager saw: the patch writer refuses it (not their words), and the revision writes it.
      t.revisionWrites({ coaching_details: POINTER });
      const before = savedForm(t, id);
      const reply = await thread.say(EDIT);
      replyMatchesDiff(t, id, before, reply, EDIT);
      const details = t.values(id).coaching_details ?? "";
      expect(details, `the Details point at the manual instead of holding the policy:\n${details}`).not.toMatch(/\brefer to\b|\bsee the\b.*\bmanual\b/i);
      expect(details, `the Details do not hold the Shift Replacement section:\n${details}`).toMatch(/finds their own replacement/i);
      expect(details, `the Details do not cite the section and page:\n${details}`).toMatch(/Shift Replacement[^\n]*JBA Policy Manual p\.37/);
      expect(reply.content, `the reply does not say which policy was written:\n${reply.content}`).toMatch(/Shift Replacement/);
    },
  },
  {
    id: "nov10-policy-topic-in-field-no-section",
    title: "the same draft, a policy the manual has no section on: nothing is written, never a pointer, and the reply asks which policy",
    report:
      "QA, a manager's 1★ rating (10 Nov 2026): the policy asked for is never a sentence telling the manager to refer to the manual; with no section, say so and ask",
    status: { open: "Details of Coaching: \"Refer to the Woven policy manual for pet insurance.\"" },
    fixFlags: ["POLICY_TOPIC_INTO_FIELD_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const edit = "In details of coaching include our woven policy on pet insurance";
      const pointer = "Refer to the Woven policy manual for pet insurance.";
      t.patchWrites([{ turn: "this_form", set: [{ field: "coaching_details", value: pointer, how: "add", evidence: "our woven policy on pet insurance" }], clear: [] }]);
      const thread = t.thread();
      await thread.say("Create a coaching form.");
      await thread.say("For all team members at kearney");
      expect(thread.proposal, "no whole-team Coaching card").toMatchObject({ templateKey: "coaching", subject: "team" });
      const id = await thread.create();
      t.revisionWrites({ coaching_details: pointer });
      const before = savedForm(t, id);
      const reply = await thread.say(edit);
      replyMatchesDiff(t, id, before, reply, edit);
      const details = t.values(id).coaching_details ?? "";
      expect(details, `the Details point at the manual:\n${details}`).not.toMatch(/\brefer to\b|\bsee the\b.*\bmanual\b/i);
      expect(reply.content, `the reply does not say no section was found and ask:\n${reply.content}`).toMatch(/couldn't find a section[^]*\?/i);
    },
  },
  {
    id: "nov10-policy-topic-in-field-salon-cell-phones",
    title: "the same draft, a salon policy topic: \"In details of coaching include our policy on cell phone use on the salon floor\" holds the Cell Phone/Smart Watch Policy and its citation, never a pointer",
    report:
      "QA (10 Nov 2026): check the sibling app's report here with a salon policy topic — the policy asked for is the manual's section, never a pointer to the manual",
    status: { open: "Details of Coaching: \"Refer to the policy manual for cell phone use on the salon floor.\"" },
    fixFlags: ["POLICY_TOPIC_INTO_FIELD_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const edit = "In details of coaching include our policy on cell phone use on the salon floor";
      const pointer = "Refer to the policy manual for cell phone use on the salon floor.";
      t.patchWrites([{ turn: "this_form", set: [{ field: "coaching_details", value: pointer, how: "add", evidence: "our policy on cell phone use on the salon floor" }], clear: [] }]);
      const thread = t.thread();
      await thread.say("Create a coaching form.");
      await thread.say("For all team members at kearney");
      expect(thread.proposal, "no whole-team Coaching card").toMatchObject({ templateKey: "coaching", subject: "team" });
      const id = await thread.create();
      t.revisionWrites({ coaching_details: pointer });
      const before = savedForm(t, id);
      const reply = await thread.say(edit);
      replyMatchesDiff(t, id, before, reply, edit);
      const details = t.values(id).coaching_details ?? "";
      expect(details, `the Details point at the manual:\n${details}`).not.toMatch(/\brefer to\b|\bsee the\b.*\bmanual\b/i);
      expect(details, `the Details do not hold the cell phone section:\n${details}`).toMatch(/Phones stay on silent/i);
      expect(details, `the Details do not cite the section and page:\n${details}`).toMatch(/Cell Phone\/Smart Watch Policy, JBA Policy Manual p\.19/);
      expect(reply.content, `the reply says "Policy policy":\n${reply.content}`).not.toMatch(/\bPolicy policy\b/i);
      expect(reply.content, `the reply does not name the section:\n${reply.content}`).toMatch(/Added our Cell Phone\/Smart Watch Policy to Details of Coaching/);
    },
  },
];
