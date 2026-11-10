import { expect } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "CREATE A FORM FROM THIS CONVERSATION." POINTS TO THE CARD'S CREATE (QA's P6, Sunny live on the 13b chat code,
 * 10 Nov 2026; CREATE_FROM_CONVERSATION_POINTS_TO_CARD_ENABLED)
 * ============================================================================
 *
 * "I need a corretive action form for not following cleaning procedures" → <name> → the Corrective Action card asks "Is
 * payroll deduct applicable? Yes or No?" → "Create a form from this conversation." got the same reply word for word;
 * the card was there, nothing moved forward. Also after answering "No" first. Expected: the reply points to the card's
 * Create draft, as "create it" does (CREATE_COMMAND_POINTS_TO_CARD). The person is invented.
 */
const BRISA: DirectoryRow = { id: "e-brisa-langtry", firstName: "Brisa", lastName: "Langtry", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const CREATE = "Create a form from this conversation.";
const REPORT = "QA's P6, Sunny live (10 Nov 2026): \"Create a form from this conversation.\" with the CA card open got the same reply word for word";

export const NOV10_CREATE_FROM_CONVERSATION_CASES: ReplayCase[] = ([["payroll-asked", []], ["after-no", ["No"]]] as const).map(
  ([key, before]): ReplayCase => ({
    id: `nov10-create-from-conversation-${key}`,
    title: `the CA card${before.length ? ", \"No\" to payroll," : ""} then "${CREATE}": points to Create draft, never the same reply again`,
    report: REPORT,
    status: { open: "the same reply word for word" },
    fixFlags: ["CREATE_FROM_CONVERSATION_POINTS_TO_CARD_ENABLED"],
    async run(t) {
      t.directory([...STAFF, BRISA]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("I need a corretive action form for not following cleaning procedures");
      let last = await thread.say("Brisa Langtry");
      expect(thread.proposal, "no Corrective Action card for Brisa Langtry").toMatchObject({ templateKey: "dpoa", employeeName: "Brisa Langtry" });
      for (const turn of before) last = await thread.say(turn);
      const reply = await thread.say(CREATE);
      expect(reply.content, `the same reply word for word:\n${reply.content}`).not.toBe(last.content);
      expect(reply.content, `the reply does not point to Create draft:\n${reply.content}`).toMatch(/\*\*Create draft\*\*/);
      expect(thread.proposal, "the card is gone").toMatchObject({ templateKey: "dpoa", employeeName: "Brisa Langtry" });
    },
  }),
);
