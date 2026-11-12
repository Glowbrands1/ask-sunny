import { expect } from "vitest";

import { KEARNEY, STAFF, noClaimWithoutUpdate, replyMatchesDiff, savedForm, type ReplayCase } from "./cases";

/**
 * QA's backlog B3 (10 Nov 2026), "do I need to copy and paste it?" answered truthfully. A manager's chat in production
 * (relayed 5 Nov 2026, both apps; the person invented): the account typed on the open draft, then "i don't see the
 * details updated in the draft card.  Do i need to copy and paste it?  or should it be automatically updating?", and
 * the live answer "It should update automatically — no copy-and-paste needed. The details are on the draft card." went
 * out with nothing written. The rest of that chat ("make that update" writing her account) is
 * nov5-coding3-copy-paste-question-told-the-truth, which also needs the details-from-earlier fix.
 */
export const NOV10_COPY_PASTE_CLAIM_CASES: ReplayCase[] = [
  {
    id: "nov10-copy-paste-claim-not-sent",
    title: "\"Do i need to copy and paste it?\" with nothing written: the reply never says it updates by itself",
    report:
      'Manager, production (relayed 5 Nov 2026, both apps): "i don\'t see the details updated in the draft card.  Do i need to copy and paste it?  or should it be automatically updating?"',
    status: { open: "the live answer \"It should update automatically — no copy-and-paste needed\" is sent unchanged with nothing written" },
    fixFlags: ["COPY_PASTE_CLAIM_HONEST_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      for (const turn of ["Create a coaching form.", "Rowan", "yes"]) await thread.say(turn);
      expect(thread.proposal, "no Coaching Form card for Rowan Kestrel").toMatchObject({ templateKey: "coaching", employeeName: "Rowan Kestrel" });
      const id = await thread.create();
      await thread.say("rowan marked a session as complete but the guest hadn't been sprayed yet");
      t.modelSays("It should update automatically — no copy-and-paste needed. The details are on the draft card.");
      const text = "i don't see the details updated in the draft card.  Do i need to copy and paste it?  or should it be automatically updating?";
      const before = savedForm(t, id);
      const reply = await thread.say(text);
      t.modelSays(null);
      replyMatchesDiff(t, id, before, reply, text);
      if (savedForm(t, id) === before) {
        noClaimWithoutUpdate(reply);
        expect(reply.content, "the reply says it updates by itself though nothing was written").not.toMatch(
          /no copy[- ]?(?:and[- ])?paste needed|updates? automatically|details are on the draft/i,
        );
      }
    },
  },
];
