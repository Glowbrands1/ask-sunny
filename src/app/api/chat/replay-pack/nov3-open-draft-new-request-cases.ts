import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/** QA's live check with OPEN_DRAFT_KEEPS_TURNS on, 3 Nov 2026 (fresh chat). */
export const NOV3_OPEN_DRAFT_NEW_REQUEST_CASES: readonly ReplayCase[] = [
  {
    id: "nov3-open-draft-new-request",
    title: "with her draft open, a new request for the same person with a new incident is its own card, and the open draft is untouched",
    report:
      '"a CA" → "<name> failed to take trash out and put rugs out untl 12;30pm" → Create → "make me a CA for <name> for being late to opening this morning" → "Redrafted the Corrective Action Form …", the open draft rewritten with both incidents (QA live check)',
    // Fixed in production: NEW_REQUEST_OPEN_DRAFT_ENABLED on (QA, 3 Nov 2026, 07:46 UTC).
    status: "fixed",
    fixFlags: ["NEW_REQUEST_OPEN_DRAFT_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("a CA");
      await thread.say("Remy Calder failed to take trash out and put rugs out untl 12;30pm");
      expect(thread.proposal).toMatchObject({ templateKey: "dpoa", employeeName: "Remy Calder" });
      t.draftWrites({ observation: "Remy did not take the trash out or put the rugs out until 12:30pm." });
      const first = await thread.create();
      // Production, 04:25:06–04:25:16 UTC: the next message came before the first draft was saved.
      t.draftNotYetSaved(first);
      const before = JSON.stringify(t.values(first));
      const reply = await thread.say("make me a CA for Remy Calder for being late to opening this morning");
      expect(JSON.stringify(t.values(first)), "the open draft was rewritten").toBe(before);
      expect(reply.formUpdate, "the open draft was changed").toBeUndefined();
      expect(reply.formProposal, "no card of its own for the new incident").toMatchObject({ templateKey: "dpoa", employeeName: "Remy Calder" });
      t.draftWrites({});
      await thread.create();
      expect(t.forms().filter((row) => row.employee_name === "Remy Calder")).toHaveLength(2);
      const second = t.draftPrompts().at(-1) ?? "";
      expect(second).toContain("late to opening");
      expect(second, "the new draft was given the trash-and-rugs incident").not.toMatch(/trash|rugs/i);
    },
  },
];
