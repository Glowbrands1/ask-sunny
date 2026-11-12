import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "JUST MAKE IT" AFTER A POLICY QUESTION ASKS ONE SHORT QUESTION (QA's r37 live check, 12 Nov 2026; low;
 * GO_AHEAD_ASKS_WHO_AND_FORM_ENABLED)
 * ============================================================================
 *
 * QA's turns on main 7e8dcdb6: "cite the animals in the workplace policy", then "just make it", which replied "I need two
 * things first: which employee … and you'll need to ask for it by name" (the model's words). QA's ruling: one short
 * question, who and which form, assuming nothing.
 */
export const NOV12_R37_GO_AHEAD_ASK_CASES: ReplayCase[] = [
  {
    id: "nov12-r37-just-make-it-asks-who-and-which-form",
    title: "\"cite the animals in the workplace policy\", then \"just make it\": one short question, who and which form",
    report: "QA's r37 live check (12 Nov 2026): \"just make it\" replied \"I need two things first … ask for it by name\"",
    status: { open: "the reply is the model's, not the one short question" },
    fixFlags: ["GO_AHEAD_ASKS_WHO_AND_FORM_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("cite the animals in the workplace policy");
      const reply = await thread.say("just make it");
      expect(thread.proposal ?? null, reply.content).toBeNull();
      expect(reply.content, reply.content).toBe("Who is it for, and should it be a **Corrective Action** or a **Coaching Form**?");
      expect(reply.content, reply.content).not.toMatch(/two things|by name/i);
    },
  },
  {
    id: "nov12-r37-just-make-it-after-a-request-unchanged",
    title: "\"create a CA for <name> …\", then \"just make it\": never the one short question (the request is there)",
    report: "Guard for QA's r37 live check (12 Nov 2026)",
    status: "fixed",
    fixFlags: ["GO_AHEAD_ASKS_WHO_AND_FORM_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("create a corrective action, cite the animals in the workplace policy");
      const reply = await thread.say("just make it");
      expect(reply.content, reply.content).not.toMatch(/should it be a \*\*Corrective Action\*\* or a \*\*Coaching Form\*\*/);
    },
  },
];
