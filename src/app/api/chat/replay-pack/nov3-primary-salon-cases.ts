import { expect } from "vitest";

import type { ReplayCase } from "./cases";

/**
 * Replay set s21 (Ask Sunny feedback, Oct 2026; the employee's name was
 * already invented in the replay fixture): the manager names the employee's
 * PRIMARY salon, then the salon the incident happened at. The card took the
 * primary salon, because "primary salon is …" read as an edit of the salon.
 */
const OMAHA_CENTER = "loc-0314";
const OMAHA_PACIFIC = "loc-0410";

export const NOV3_PRIMARY_SALON_CASES: readonly ReplayCase[] = [
  {
    id: "nov3-s21-incident-salon",
    title: "\"primary salon is X … working a shift at Y\": the card's salon is Y, where it happened",
    report:
      "Replay set s21: \"Put together a written CA for <name>, primary salon is Omaha Center. But on Monday 10/05/2026 <name> was working a shift at Omaha Pacific and did not complete the 10 minute disenfect\"",
    status: "fixed",
    fixFlags: ["PRIMARY_SALON_NOT_EDIT_ENABLED"],
    async run(t) {
      t.directory([
        { id: "e-s21", firstName: "Sloane", lastName: "Wexford", preferredFirstName: null, employmentStatus: "active", salonIds: [OMAHA_CENTER, OMAHA_PACIFIC], positionName: "Tanning Consultant" },
      ]);
      t.as("salon_director", { level: "salon", primaryAreaId: OMAHA_CENTER, alsoCoversAreaIds: [OMAHA_PACIFIC] });
      const thread = t.thread();
      await thread.say(
        "Put together a written CA for Sloane Wexford, primary salon is Omaha Center. But on Monday 10/05/2026 Sloane was working a shift at Omaha Pacific and did not complete the 10 minute disenfect",
      );
      await thread.say("Sloane Wexford");
      expect(thread.proposal?.employeeName).toBe("Sloane Wexford");
      expect(thread.proposal?.locationId, "the card took the primary salon, not where it happened").toBe(OMAHA_PACIFIC);
    },
  },
];
