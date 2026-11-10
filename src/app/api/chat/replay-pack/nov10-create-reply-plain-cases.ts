import { expect } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * QA's round-16b live test in the sibling app (10 Nov 2026; the same reply code here; the person invented): a Coaching card on screen, then "Create a
 * Coaching Form from this conversation." The reply repeated the card's text instead of saying plainly that the card
 * above is ready and to press Create draft. CREATE_REPLY_PLAIN_ENABLED (with CREATE_FROM_CONVERSATION_POINTS_TO_CARD,
 * `ai/card-meta-turn.ts`).
 */
const BRISA: DirectoryRow = { id: "e-brisa-langtry", firstName: "Brisa", lastName: "Langtry", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const REPORT = "QA's round-16b live test (the sibling app), 10 Nov 2026: \"Create a Coaching Form from this conversation.\" repeated the card's text";
const FLAGS = ["CREATE_COMMAND_POINTS_TO_CARD_ENABLED", "CREATE_FROM_CONVERSATION_POINTS_TO_CARD_ENABLED", "CREATE_REPLY_PLAIN_ENABLED"];

export const NOV10_CREATE_REPLY_PLAIN_CASES: ReplayCase[] = [
  {
    id: "nov10-create-coaching-form-from-conversation-plain",
    title: "a Coaching card, then \"Create a Coaching Form from this conversation.\": the reply says the card above is ready — press Create draft — and does not repeat the card",
    report: REPORT,
    status: { open: "the reply repeats the card's text (or makes the card again) instead of pointing to Create draft" },
    fixFlags: FLAGS,
    async run(t) {
      t.directory([...STAFF, BRISA]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const card = await thread.say("create a coaching form for Brisa Langtry, she did not finish her closing duties last night");
      expect(thread.proposal, `no Coaching card for Brisa Langtry:\n${card.content}`).toMatchObject({ templateKey: "coaching", employeeName: "Brisa Langtry" });
      const reply = await thread.say("Create a Coaching Form from this conversation.");
      expect(reply.content, `the reply does not say the card above is ready:\n${reply.content}`).toMatch(/card above is ready[^\n]*\*\*Create draft\*\*/);
      expect(reply.content, `the reply repeats the card:\n${reply.content}`).not.toMatch(/what I would put on|I'll draft a \*\*Coaching Form\*\*|\*\*Date:\*\*|Everything I need is here/);
      expect(thread.proposal, "the card is gone").toMatchObject({ templateKey: "coaching", employeeName: "Brisa Langtry" });
    },
  },
  {
    id: "nov10-create-other-form-from-conversation-stays-request",
    title: "control: a Coaching card, then \"Create a CA from this conversation.\" is a request for the other form, never \"the card above is ready\"",
    report: REPORT,
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      t.directory([...STAFF, BRISA]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("create a coaching form for Brisa Langtry, she did not finish her closing duties last night");
      const reply = await thread.say("Create a CA from this conversation.");
      expect(reply.content, `another form was pointed to the Coaching card:\n${reply.content}`).not.toMatch(/Coaching Form\*\* card above is ready/);
    },
  },
];
