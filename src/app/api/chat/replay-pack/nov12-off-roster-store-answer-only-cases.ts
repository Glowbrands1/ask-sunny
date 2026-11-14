import { expect, vi } from "vitest";

import { STAFF, TWO_SALONS, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A SALON ANSWER TO THE OFF-ROSTER ASK IS ONLY THE SALON (OFF_ROSTER_STORE_ANSWER_ONLY_ENABLED; QA's ruling on Ask Bubbles' #735 gate, 12 Nov 2026)
 * ============================================================================
 *
 * A two-salon director, a person not in the directory (invented): "create a ca for kira dunmore, she was late today" is
 * met with the off-roster ask ("I can't find **Kira Dunmore** … reply **use Kira Dunmore**"). With production's flags,
 * "kearney, ne" made the card for Kira Dunmore at once: the confirmation was skipped. The salon answer only sets the
 * salon; the name still needs "use Kira Dunmore".
 */
const FLAG = "OFF_ROSTER_STORE_ANSWER_ONLY_ENABLED";
const KEARNEY_ID = "loc-0309";
const REPORT = "QA's ruling on Ask Bubbles' #735 gate (12 Nov 2026): Coding-2's check of this app, a two-salon director";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-10-25T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", TWO_SALONS);
  return t.thread();
}

const card = (thread: { proposal: unknown }) => thread.proposal as { employeeName?: string | null; salonId?: string | null; locationId?: string | null } | null;
const salonOf = (thread: { proposal: unknown }) => card(thread)?.salonId ?? card(thread)?.locationId ?? null;

export const NOV12_OFF_ROSTER_STORE_ANSWER_ONLY_CASES: ReplayCase[] = (
  [
    ["lower", "kearney, ne"],
    ["sentence", "Kearney, NE"],
  ] as const
).map(([key, salon]) => ({
  id: `nov12-off-roster-store-answer-only-${key}`,
  title: `"create a ca for kira dunmore, she was late today" → "${salon}" → "use Kira Dunmore": the salon answer sets only the salon`,
  report: REPORT,
  // Changed on purpose (13 Nov 2026): fixed in production by OFF_ROSTER_STORE_ANSWER_ONLY_ENABLED, QA round 37b. Was OPEN.
  status: "fixed",
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    const thread = start(t);
    const asked = await thread.say("create a ca for kira dunmore, she was late today");
    if (t.loopActive?.()) {
      // Changed on purpose (Pau 14 Nov: fewer questions / off-roster card + not-on-Woven line): with the loop on, the card comes at once with the line; every outcome check is kept.
      expect(card(thread)?.employeeName ?? null, `no card for the typed name:\n${asked.content}`).toBe("Kira Dunmore");
      expect(asked.content).toMatch(/\*\*Kira Dunmore\*\* isn't on (?:your salon's|the) Woven staff list/);
      const placed = await thread.say(salon);
      expect(card(thread)?.employeeName ?? null, `the salon answer changed the person:\n${placed.content}`).toBe("Kira Dunmore");
      expect(salonOf(thread), "the salon answer did not set the salon").toBe(KEARNEY_ID);
      return;
    }
    expect(asked.content, "no off-roster ask").toMatch(/reply \*\*use Kira Dunmore\*\*/);
    const answered = await thread.say(salon);
    expect(answered.content, `the salon answer skipped the confirmation:\n${answered.content}`).toMatch(/reply \*\*use Kira Dunmore\*\*/);
    expect(card(thread)?.employeeName ?? null, "the name was confirmed by a salon answer").toBeNull();
    expect(salonOf(thread), "the salon answer did not set the salon").toBe(KEARNEY_ID);
    const confirmed = await thread.say("use Kira Dunmore");
    expect(card(thread)?.employeeName ?? null, `"use Kira Dunmore" did not confirm:\n${confirmed.content}`).toBe("Kira Dunmore");
    expect(salonOf(thread), `the salon was lost:\n${confirmed.content}`).toBe(KEARNEY_ID);
  },
}));
