import { createFromConversationPointsToCardEnabled } from "@/lib/config/chat-quality-flags";
import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "CREATE A FORM FROM THIS CONVERSATION." KEEPS THE CARD'S DATE AND POLICY (QA's CI eval, 10 Nov 2026;
 * CREATE_FROM_CONVERSATION_POINTS_TO_CARD_ENABLED)
 * ============================================================================
 *
 * The eval's s8 (an exit request, then "Create a form from this conversation." twice) lost the card's Date, and s7 (a
 * coaching request about opening late, then the same command) lost its Policy, with the flag on: the command was
 * answered from the card in the history, not re-read. These cases are shaped like s7 and s8 (the people invented):
 * the command's card keeps what the turn before it had, and with the flag the reply points to Create draft.
 */
const row = (id: string, firstName: string, lastName: string, positionName: string): DirectoryRow => ({ id, firstName, lastName, preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName });
const PEOPLE = [row("s8-maribeth-quarle", "Maribeth", "Quarle", "Tanning Consultant"), row("s7-dorian-vellacott", "Dorian", "Vellacott", "Assistant Salon Director")];
const CREATE = "Create a form from this conversation.";
const FIX = ["CREATE_FROM_CONVERSATION_POINTS_TO_CARD_ENABLED"];
const REPORT = "QA's CI eval (10 Nov 2026): with the flag on, s8 lost the card's Date and s7 its Policy";

export const NOV10_CREATE_FROM_CONVERSATION_REREADS_CASES: ReplayCase[] = [
  {
    id: "nov10-create-from-conversation-exit-keeps-date",
    title: "s8-shaped: an exit request, then \"Create a form from this conversation.\" twice: the card keeps its Date",
    report: REPORT,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      vi.setSystemTime(new Date("2026-10-23T15:00:00Z"));
      t.directory([...STAFF, ...PEOPLE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      for (const turn of ["assist with creating an exit form", "maribeth quarle, tanning consultant at kearney", "last day worked was 9-20-26. management called her with no response on 9-27-26", "its a no call no show", "create exit form"]) {
        await thread.say(turn);
      }
      const before = thread.proposal;
      expect(before, "no exit card before the command").toBeTruthy();
      for (const pass of [1, 2]) {
        const reply = await thread.say(CREATE);
        expect(thread.proposal, `pass ${pass}: the card is gone:\n${reply.content}`).toBeTruthy();
        expect(thread.proposal?.formDate ?? null, `pass ${pass}: the card's Date changed:\n${reply.content}`).toBe(before?.formDate ?? null);
        expect(thread.proposal?.employeeName ?? null, `pass ${pass}: the card's person changed`).toBe(before?.employeeName ?? null);
        if (createFromConversationPointsToCardEnabled()) expect(reply.content, `pass ${pass}: the reply does not point to Create:\n${reply.content}`).toMatch(/\*\*Create draft\*\*/);
      }
    },
  },
  {
    id: "nov10-create-from-conversation-coaching-keeps-policy",
    title: "s7-shaped: a coaching request about opening late, then \"Create a form from this conversation.\": the card keeps its Policy",
    report: REPORT,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
      t.directory([...STAFF, ...PEOPLE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      for (const turn of ["Create a coaching form for a performance concern.", "name is dorian vellacott, todays date, kearney location, dorian was late opening salon", "create coaching form. dorian vellacott is ass't salon director. dorian did not call anyone about opening late"]) {
        await thread.say(turn);
      }
      const before = await thread.say("name is dorian vellacott and use todays date to create coaching form");
      const policy = /Late Opening[^\n]*/.exec(before.content)?.[0] ?? null;
      const reply = await thread.say(CREATE);
      expect(thread.proposal, `the card is gone:\n${reply.content}`).toBeTruthy();
      expect(thread.proposal?.formDate ?? null, `the card's Date changed:\n${reply.content}`).toBe(thread.proposal?.formDate ?? null);
      if (policy) {
        const card = JSON.stringify(thread.proposal) + reply.content;
        expect(createFromConversationPointsToCardEnabled() ? card : reply.content, `the card lost its policy (${policy}):\n${reply.content}`).toMatch(/Late Opening/);
      }
      if (createFromConversationPointsToCardEnabled()) expect(reply.content, `the reply does not point to Create:\n${reply.content}`).toMatch(/\*\*Create draft\*\*/);
    },
  },
];
