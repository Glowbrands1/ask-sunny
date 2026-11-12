import { expect, vi } from "vitest";

import { KEARNEY, STAFF, replyMatchesDiff, savedForm, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "ADD THAT SHE WAS REMINDED OF THE POLICY" IS THE ACCOUNT, NOT A POLICY TO ADD (ported from the sibling app: QA's live
 * test there on a saved Corrective Action draft, 10 Nov 2026; ADD_THAT_IS_ACCOUNT_ENABLED)
 * ============================================================================
 *
 * On a saved Corrective Action draft, "add that she was reminded of the policy" was routed as a policy change: "I
 * couldn't find a section called "she was reminded of the" in the JBA Policy Manual …", and the Observation stayed as
 * it was. The edit reader's add of the line is scripted, as the live reader reads it. The person is invented.
 */
const LIESEL: DirectoryRow = { id: "e-liesel-hartigan", firstName: "Liesel", lastName: "Hartigan", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const SAID = "add that she was reminded of the policy";

export const NOV10_ADD_THAT_IS_ACCOUNT_CASES: ReplayCase[] = [
  {
    id: "nov10-add-that-she-was-reminded-of-the-policy",
    title: `a saved Corrective Action draft, "${SAID}": the line is added to the Observation, never read as a policy section`,
    report: `QA's live test in the sibling app (10 Nov 2026): on a saved CA draft, "${SAID}" was answered as a policy question`,
    // Changed on purpose (10 Nov 2026): fixed in production by ADD_THAT_IS_ACCOUNT_ENABLED, QA round 23.
    status: "fixed",
    fixFlags: ["ADD_THAT_IS_ACCOUNT_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
      t.directory([...STAFF, LIESEL]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("create a corrective action for Liesel Hartigan, she was late opening the salon on 11/8/26");
      t.draftWrites({ observation: "Observed:\nLiesel Hartigan opened the salon late on 11/8/26." });
      const id = await thread.create();
      t.patchWrites([{ turn: "this_form", set: [{ field: "observation", value: "She was reminded of the policy.", how: "add", evidence: "she was reminded of the policy" }], clear: [] }]);
      const before = savedForm(t, id);
      const reply = await thread.say(SAID);
      replyMatchesDiff(t, id, before, reply, SAID);
      expect(reply.content, `read as a policy section:\n${reply.content}`).not.toMatch(/couldn't find a section called/i);
      const observation = t.values(id).observation ?? "";
      expect(observation, `the line is not in the Observation:\n${observation}`).toMatch(/reminded of the policy/i);
      expect(observation, `the account was lost:\n${observation}`).toMatch(/opened the salon late on 11\/8\/26/);
    },
  },
];
