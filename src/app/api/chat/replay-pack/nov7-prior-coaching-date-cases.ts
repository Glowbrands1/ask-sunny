import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * A2 (QA, 6–7 Nov 2026; one of Pau's 7, ported from the sibling app, where the flip-3 tester run found it; the same code here): a CA card, then
 * "in the previously recieved coaching include that <name> signed the jba policy manual on 10-15-26". The date
 * appeared nowhere: no Prior actions line on the card. The sentence reader (PRIOR_STEP_SENTENCE, live) takes a
 * step only after "was / got / received / issued …", and "previously recieved coaching" (as typed) is none of
 * those; the labelled-list reader reads "previous coaching: …", not a sentence. The manager's words; the person
 * is the pack's invented Marnie Holloway.
 */
const SAID = "in the previously recieved coaching include that marnie holloway signed the jba policy manual on 10-15-26";

export const NOV7_PRIOR_COACHING_DATE_CASES: ReplayCase[] = [
  {
    id: "nov7-a2-previously-received-coaching-date",
    title: "A2: \"in the previously recieved coaching include that <name> signed the jba policy manual on 10-15-26\": the card lists the coaching with its date",
    report: "QA, 6 Nov 2026 (A2, one of Pau's 7): a prior-coaching line with a date dropped at the proposal card",
    // Changed on purpose (7 Nov 2026): QA's flip 7 (21:29 PHT) turned this case's flags on in production (production-flags.json); it now holds with production's flags.
    status: "fixed",
    fixFlags: ["PRIOR_STEP_PREVIOUSLY_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-06T15:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("corrective action");
      await thread.say("marnie holloway");
      await thread.say("marnie did not acknowledge woven policies by the due date 10/31");
      const reply = await thread.say(SAID);
      expect(reply.content, `the prior coaching's date is not on the card:\n${reply.content}`).toMatch(/\*\*Prior actions:\*\*[^\n]*Coaching[^\n]*10\/15\/2026/);
    },
  },
  {
    id: "nov7-a2-negative-previous-store",
    title: "A2 negative: \"she previously worked the front desk on 10-15-26\" names no step: no Prior actions line",
    report: "A2's condition: \"previously\" alone is no earlier step",
    status: "fixed",
    fixFlags: ["PRIOR_STEP_PREVIOUSLY_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-06T15:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("corrective action for marnie holloway, she was 40 minutes late on 11-2-26 and she previously worked the front desk on 10-15-26");
      const reply = await thread.say("verbal");
      expect(reply.content, `a Prior actions line with no step:\n${reply.content}`).not.toMatch(/\*\*Prior actions:\*\*/);
    },
  },
];
