import { expect } from "vitest";

import { KEARNEY, noClaimWithoutUpdate, STAFF, type ReplayCase } from "./cases";

/** Reported in the sibling app, 30 Oct 2026: a Location Manager and an Assistant Manager at her store (two chats rated 2 stars). The same mechanism here. */
export const OCT30_CASES: readonly ReplayCase[] = [
  {
    id: "oct30-am-role",
    title: "an Assistant Manager asks for a coaching form",
    report: '"coaching form" → "Your role cannot create a **Coaching Form**" (twice that evening)',
    status: "fixed",
    async run(t) {
      t.directory(STAFF);
      t.as("assistant_salon_director", KEARNEY);
      for (const turn of ["coaching form", "can you create a weekly coaching form using the promotions from the most recent weekly newsletter, make it for a week, on days there is no sale use google review"]) {
        const reply = await t.thread().say(turn);
        expect(reply.content).not.toContain("Your role cannot create");
        expect(reply.formProposal?.templateKey).toBe("coaching");
      }
    },
  },
  {
    id: "oct30-do-the-same",
    title: '"Do the same coaching form for <another>" carries the Details',
    report: "\"I'd like it to copy and paste a coaching form but change the employee name and position\"",
    status: "fixed",
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("Create a coaching form for Marnie Holloway");
      t.draftWrites({ coaching_details: "Check the client's skin type and session log before every session, then wipe the bed and the rolling cart." });
      await thread.create();
      await thread.say("Do the same coaching form for remy calder");
      t.draftWrites({});
      const remy = await thread.create();
      expect(t.values(remy).coaching_details).toContain("rolling cart");
    },
  },
  ...["yes, do that", "the details we just discussed!!!"].map(
    (turn): ReplayCase => ({
      id: `oct30-refers-back-${turn.startsWith("yes") ? "do-that" : "discussed"}`,
      title: `"${turn}" with the draft open writes the offered Details`,
      report: '"it would never automatically put it in the coaching form, I had to copy and paste it myself"',
      // Fixed in production: FORM_EDIT_REFERS_BACK_ENABLED on (QA, 3 Nov 2026).
      status: "fixed",
      fixFlags: ["FORM_EDIT_REFERS_BACK_ENABLED"],
      async run(t) {
        t.directory(STAFF);
        t.as("salon_director", KEARNEY);
        const thread = t.thread();
        await thread.say("Create a coaching form for Remy Calder");
        t.draftWrites({ coaching_details: "" });
        await thread.create();
        t.modelSays(
          "A session is logged only once the client is in the bed.\n\n**Details of Coaching:** \"Remy logged a client's session before the client had arrived.\"\n\nWant me to put that on the card?",
        );
        await thread.say("when do we log a session in the system");
        t.modelSays(null);
        t.revisionWrites({ coaching_details: "Remy logged a client's session before the client had arrived." });
        const reply = await thread.say(turn);
        expect(reply.formUpdate?.updated ?? []).toContain("coaching_details");
      },
    }),
  ),
  {
    id: "oct30-claims",
    title: "the answer's \"Updating the draft now.\" / \"That's on the card.\" with nothing written",
    report: "\"Updating the draft now … That's on the card\" while the card was unchanged",
    // Fixed in production: FORM_EDIT_REFERS_BACK_ENABLED on (QA, 3 Nov 2026).
      status: "fixed",
    fixFlags: ["FORM_EDIT_REFERS_BACK_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("Create a coaching form for Remy Calder");
      t.draftWrites({ coaching_details: "" });
      await thread.create();
      t.modelSays("Updating the draft now.\n\n**Details of Coaching:** \"Remy logged a session early.\"\n\nThat's on the card.");
      noClaimWithoutUpdate(await thread.say("what else should go on it?"));
    },
  },
];
