import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * SOURCE_NOTE_GUARD_ENABLED / FINAL_REPLY_MARKER_GUARD_ENABLED (QA's live Sunny tester after round 4, 8 Nov 2026): "I need a corrective action for
 * under performance", then "must see behaviors" — the reply explained the Must See Behaviors and ended a sentence
 * "… and asking every client to see their eyewear [S4][S3].", shown to the manager. The model's answer is scripted
 * with that sentence; no person is named.
 */
const ANSWER =
  "The Must See Behaviors are actions used with every client, every time: a welcoming greeting, product strategies, membership/pricing discussions, and asking every client to see their eyewear [S4][S3].\n\nWho is this form for? Tell me the employee's full name.";

export const NOV8_FINAL_REPLY_MARKER_GUARD_CASES: ReplayCase[] = [
  {
    id: "nov8-source-markers-msb-live",
    title: "\"must see behaviors\" after a CA request: \"… see their eyewear [S4][S3].\" reaches the reply with no tag",
    report: "QA's live Sunny tester after round 4 (8 Nov 2026): \"[S4][S3]\" at the end of a sentence in the reply",
    // On this path SOURCE_NOTE_GUARD alone takes both tags off; the live reply kept both, so the guard was not on where
    // it was served (reported to QA). FINAL_REPLY_MARKER_GUARD covers a run where the bare-marker step is the only one
    // that runs (`ai/source-note.test.ts`).
    // Changed on purpose (8 Nov 2026): production-flags.json now lists SOURCE_NOTE_GUARD_ENABLED (round 4, #666), so this holds with production's flags.
    status: "fixed",
    fixFlags: ["SOURCE_NOTE_GUARD_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-08T01:06:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("I need a corrective action for under performance");
      t.modelSays(ANSWER);
      const reply = await thread.say("must see behaviors");
      t.modelSays(null);
      expect(reply.content, `a source tag reached the reply:\n${reply.content}`).not.toMatch(/\[\s*S\d+/);
      expect(reply.content, `the answer itself is gone:\n${reply.content}`).toMatch(/asking every client to see their eyewear\./);
    },
  },
];
