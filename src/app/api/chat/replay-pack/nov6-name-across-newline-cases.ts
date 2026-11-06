import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A NAME ENDS AT ITS LINE (tracked, OPEN; found porting the sibling app's
 * flip-3 gate fix, QA, 6 Nov 2026)
 * ============================================================================
 *
 * An exit form typed as lines, the name alone on the first: "<name>\nGave
 * notice - fulfilled notice\n…". The name reader runs across the newline and
 * reads "<name> Gave", so the card and the reply name "Thessaly Varrow Gave".
 * With a title line between them the name is read correctly. QA (6 Nov 2026):
 * tracked with this case, not fixed yet. The name is invented and on no
 * directory.
 */
export const NOV6_NAME_ACROSS_NEWLINE_CASES: ReplayCase[] = [
  {
    id: "nov6-name-across-newline-exit-lines",
    title: "an exit form typed as lines, \"Thessaly Varrow\\nGave notice - …\": the name is never read across the newline as \"Thessaly Varrow Gave\"",
    report: "Found 6 Nov 2026 porting the sibling app's flip-3 gate fix: the exit card read \"Thessaly Varrow Gave\"",
    status: { open: "the card and the reply name \"Thessaly Varrow Gave\": the name reader runs across the newline" },
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("Can you create an exit form for me?");
      const reply = await thread.say(
        "Thessaly Varrow\nGave notice - fulfilled notice\nGave notice 9/25/26 - date notice fulfilled 10/9/26\nResigning to pursue other career options\neligible for rehire",
      );
      expect(reply.content, `the name is read across the newline:\n${reply.content}`).not.toMatch(/Thessaly Varrow Gave/);
      expect(thread.proposal?.employeeName ?? "", "the card's name runs across the newline").not.toMatch(/Gave/);
    },
  },
];
