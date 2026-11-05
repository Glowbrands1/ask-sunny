import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A STREAMED ANSWER IS READ AS THE BROWSER READS IT (ported from the sibling app, 5 Nov 2026)
 * ============================================================================
 *
 * The sibling app's smaller-set gate recorded an EMPTY reply for
 * nov2-p1b-next-message-new-draft turn 3 with CA_SALES_POLICY_ENABLED on. The
 * app's reply was not empty: with CA_SALES on, "underperformance for the month
 * of october" said with the Corrective Action draft open is a redraft citing
 * the Standards of Conduct (`forms/chat-redraft.ts`), slower than
 * START_AFTER_MS, so the route streamed it (CHAT_RESPONSE_STREAM_ENABLED,
 * `api/streamed-response.ts`). The browser unwraps that envelope
 * (`ai/claude-provider.ts`); the pack read the envelope as the answer. The pack
 * now unwraps it. A guard on the same path here: the reply is never empty.
 */
export const NOV5_STREAMED_ANSWER_CASES: ReplayCase[] = [
  {
    id: "nov5-ca-sales-open-draft-reply-not-empty",
    title: "CA_SALES on: with the CA draft open, \"underperformance for the month of october\" gets the app's reply, never an empty one",
    report: "the sibling app's smaller-set gate records (5 Nov 2026): an empty reply recorded for a streamed redraft",
    status: "fixed",
    async run(t) {
      vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("I need to create a verbal corrective action form");
      await thread.say("Remy Calder");
      t.draftWrites({});
      const first = await thread.create();
      t.typeOnForm(first, { observation: "Remy was below the salon average in October on every metric we track." });
      t.revisionWrites({ observation: "Remy was below the salon average in October on every metric we track — underperformance for the month of October." });
      const reply = await thread.say("underperformance for the month of october");
      expect(reply.content.trim(), "the reply is empty").not.toBe("");
      expect(reply.content, `the reply is not about the open draft:\n${reply.content}`).toMatch(/\*\*Corrective Action Form\*\* for \*\*Remy Calder\*\*/);
    },
  },
];
