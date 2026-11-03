import { expect } from "vitest";

import { KEARNEY, noRepeatedReply, STAFF, TWO_SALONS, type ReplayAnswer, type ReplayCase } from "./cases";

/** The overnight scan of 2 Nov 2026 (QA, 3 Nov), as it applies to this app. */
export const NOV2_CASES: readonly ReplayCase[] = [
  {
    id: "nov2-whole-team",
    title: "a coaching form for all team members, six turns: never the same refusal again",
    report:
      '"earlier bubbles made a coaching form for all team members. Now it is struggling to do that, it says it cannot make a coaching form for all team members, but it just did it for me earlier" (the sibling app, 1 star)',
    // Fixed by WHOLE_TEAM_COACHING_ENABLED (#438): add it to fixFlags when that is merged.
    status: { open: "the staff picker refuses a whole-team coaching form; #438 not merged" },
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", TWO_SALONS);
      const thread = t.thread();
      const replies: ReplayAnswer[] = [];
      for (const turn of [
        "coaching form for all team members",
        "make a coaching form for all team members",
        "ne kearney",
        "make a coaching form for all team members at kearney",
        "earlier you made a caoching form for all team members for me",
        "ne kearney",
      ]) {
        replies.push(await thread.say(turn));
      }
      noRepeatedReply(replies);
      for (const reply of replies) expect(reply.content).not.toMatch(/won't make one card for the whole staff/);
      expect(replies.map((reply) => reply.content).join("\n")).not.toContain("Kearney Account");
    },
  },
  {
    id: "nov2-p4-question-to-card",
    title: "a question about the card gets an answer, not the same card again",
    report:
      '"When a manager asked the bot something, it sent the same card again without answering and pasted her question into the Observation field. A CA got the same card 4 times" ',
    status: { open: "QUESTION_NOT_FORM_ENABLED is off in production" },
    fixFlags: ["QUESTION_NOT_FORM_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("MAKE ME a CA for rowan. she was tardy this morning");
      if (!thread.proposal) await thread.say("yes");
      expect(thread.proposal?.templateKey).toBeTruthy();
      for (const turn of ["what policy was violayted", "what do i put in policy violated", "what exatly do i put in the policy tab", "what is direct policy from manual"]) {
        const before = t.calls().chat;
        const reply = await thread.say(turn);
        expect(reply.formProposal, `"${turn}" got the card back`).toBeUndefined();
        expect(t.calls().chat, `"${turn}" was not answered`).toBeGreaterThan(before);
      }
    },
  },
];
