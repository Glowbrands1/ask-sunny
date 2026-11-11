import { expect } from "vitest";

import type { ReplayCase } from "./cases";

/**
 * Replay set b2, ported from Ask Bubbles (3 Nov 2026; the employee's name is
 * invented): the employee was named by first name in an account, the form was
 * asked for in a later turn, and "Yes" to "Is this for <full name>?" turned
 * the conversation back into the account alone in Bubbles — no card. Here the
 * card comes with production's flags; FIRST_NAME_YES_KEEPS_REQUEST_ENABLED
 * (same flag in both apps) keeps it so.
 */
const OMAHA_PACIFIC = "loc-0410";

export const NOV3_FIRST_NAME_YES_CASES: readonly ReplayCase[] = [
  {
    id: "nov3-b2-yes-keeps-request",
    title: "\"Yes\" to \"Is this for <name>?\" keeps the form the manager asked for in a later turn",
    report:
      "Replay set b2 (Ask Bubbles): \"I have an employee <first name> at our <location> who has been out of dress code three shifts …\" → \"Create a Coaching Form from this conversation.\" → \"Is this for <name>?\" → \"Yes\" → no card",
    status: "fixed",
    fixFlags: ["FIRST_NAME_YES_KEEPS_REQUEST_ENABLED"],
    async run(t) {
      t.directory([
        { id: "e-b2", firstName: "Marisol", lastName: "Quenby", preferredFirstName: null, employmentStatus: "active", salonIds: [OMAHA_PACIFIC], positionName: "Tanning Consultant" },
      ]);
      t.as("salon_director", { level: "salon", primaryAreaId: OMAHA_PACIFIC, alsoCoversAreaIds: [] });
      const thread = t.thread();
      await thread.say(
        "I have an employee Marisol at our Omaha Pacific location who has been out of dress code three shifts. I verbally coached her on the second offense and she still is out of dress code",
      );
      await thread.say("Create a Coaching Form from this conversation.");
      const reply = await thread.say("Yes");
      expect(reply.formProposal, `no card after "Yes": ${reply.content.slice(0, 200)}`).toMatchObject({
        templateKey: "coaching",
        employeeName: "Marisol Quenby",
        locationId: OMAHA_PACIFIC,
      });
    },
  },
];
