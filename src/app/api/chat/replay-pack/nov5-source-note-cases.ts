import { expect, vi } from "vitest";

import { STAFF, KEARNEY, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A NOTE ABOUT A SOURCE NEVER REACHES THE MANAGER (QA, 5 Nov 2026, item 9)
 * ============================================================================
 *
 * A reply leaked the answering model's note about a source: "[S1 doesn't
 * actually cover general tardiness — it only covers failing to open the
 * salon…]". The model's answer is scripted with QA's exact wording (reported
 * in the sibling app, its "store" read as this app's "salon"); the reply
 * the manager gets must not carry the note, and the sentence it followed stays.
 */

const LEAK = "[S1 doesn't actually cover general tardiness — it only covers failing to open the salon…]";
const ANSWER = `Being late to a shift is handled under the Attendance Policy [S2]. ${LEAK}\n\nTell me if you want to document it.`;
const REPORT = "QA, 5 Nov 2026 (item 9): a reply leaked a bracketed source note";

export const NOV5_SOURCE_NOTE_CASES: ReplayCase[] = [
  {
    id: "nov5-source-note-leak",
    title: "a bracketed note that starts with a source tag (\"[S1 doesn't actually cover general tardiness …]\") never reaches the reply",
    report: REPORT,
    // Changed on purpose (8 Nov 2026): fixed in production by SOURCE_NOTE_GUARD_ENABLED, QA round 4, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: ["SOURCE_NOTE_GUARD_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      t.modelSays(ANSWER);
      const reply = await thread.say("what policy covers being late to a shift?");
      expect(reply.content, `the note reached the reply:\n${reply.content}`).not.toMatch(/\[\s*S\d+\s+doesn'?t actually cover/i);
      expect(reply.content, `the note reached the reply:\n${reply.content}`).not.toContain("it only covers failing to open the salon");
      expect(reply.content, `the answer itself is gone:\n${reply.content}`).toMatch(/Being late to a shift is handled under the Attendance Policy/);
    },
  },
];
