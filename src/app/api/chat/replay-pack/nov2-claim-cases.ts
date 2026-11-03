import { expect } from "vitest";

import { KEARNEY, noClaimWithoutUpdate, STAFF, type ReplayCase } from "./cases";

/** The sibling app's 2 Nov scan, honesty report (P5): "updated" and "confirmed" with nothing changed or read. The same mechanism here. */
export const NOV2_CLAIM_CASES: readonly ReplayCase[] = [
  {
    id: "nov2-p5-name-claims",
    title: "\"now reads\" / \"Confirmed against records\" are never said when the form did not change",
    report:
      "\"The bot said it updated the employee name …, but the form didn't change. Later it said the name was 'confirmed against records' without checking, and several replies ended with an empty 'I can prepare:'.\"",
    // Holds here with production's flags (replayed 3 Nov 2026); open in the sibling app.
    status: "fixed",
    fixFlags: ["CLAIM_GUARD_ENABLED", "OPEN_FORM_NO_SELECTION_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("i have an employee, Delia Garza Ramso that needs a corrective action form with a customer complaint");
      await thread.say("verbal warning, no payroll deduct, part-time team member,");
      t.draftWrites({});
      await thread.create();
      t.modelSays("Got it — the employee name on the draft now reads **Delia Garza Ramos**. Everything else on the card stays as it was.");
      const first = await thread.say("make that update");
      noClaimWithoutUpdate(first);
      t.modelSays("Confirmed against records — the Employee Name on the draft is now **Delia Garza Ramos**, matching Woven.");
      const second = await thread.say("okay the correct way is Delia Garza Ramos");
      noClaimWithoutUpdate(second);
      for (const reply of [first, second]) {
        expect(reply.content, "a form selection's heading with the draft open").not.toMatch(/I can prepare:\s*$/);
      }
    },
  },
];
