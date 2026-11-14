import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * RELATIVE_DAY_PART_WORDS — "TONIGHT" DATES THE CARD AS TODAY DOES (QA's Sunny live check, 13 Nov 2026)
 * ============================================================================
 *
 * QA, live at 6:20 PM Central on 13 Nov 2026: "verbal ca for <B>, she no-call no-showed tonight" gave a card with
 * no Date (formDate null); "today" gave 11/13. With RELATIVE_DAY_PART_WORDS_ENABLED "tonight", "this morning", "this
 * afternoon" and "this evening" are the business today and "last night" the day before. The clock is QA's (00:20Z on
 * the 14th is 6:20 PM Central on the 13th). The person is invented.
 */
const FLAG = "RELATIVE_DAY_PART_WORDS_ENABLED";
const REPORT = "QA's Sunny live check (13 Nov 2026, 6:20 PM Central), tester's wording; invented person";

async function formDateOf(t: ReplayContext, turn: string): Promise<{ reply: string; formDate: string | null }> {
  vi.setSystemTime(new Date("2026-11-14T00:20:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] });
  const thread = t.thread();
  const reply = (await thread.say(turn)).content;
  return { reply, formDate: (thread.proposal as { formDate?: string | null } | null)?.formDate ?? null };
}

const OPEN: readonly { key: string; turn: string; day: "today" | "yesterday" }[] = [
  { key: "tonight", turn: "verbal ca for marnie holloway, she no-call no-showed tonight", day: "today" },
  { key: "this-evening", turn: "verbal ca for marnie holloway, she no-call no-showed this evening", day: "today" },
  { key: "this-morning", turn: "verbal ca for marnie holloway, she was late this morning", day: "today" },
  { key: "last-night", turn: "verbal ca for marnie holloway, she no-call no-showed last night", day: "yesterday" },
];

export const NOV14_RELATIVE_DAY_PART_WORDS_CASES: ReplayCase[] = OPEN.map((wording) => ({
  id: `nov14-relative-day-part-words-${wording.key}`,
  title: `"${wording.turn}" — the card is dated the business ${wording.day}`,
  report: REPORT,
  status: { open: "a part of the day is no date: the card has no Date" },
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    // "today", said the same way at the same moment, is the business today (it already works).
    const { formDate: today } = await formDateOf(t, "verbal ca for marnie holloway, she no-call no-showed today");
    expect(today, "the control: \"today\" dates the card").toBe("2026-11-13");
    const { reply, formDate } = await formDateOf(t, wording.turn);
    expect(formDate, `the card's Date:\n${reply}`).toBe(wording.day === "today" ? "2026-11-13" : "2026-11-12");
  },
}));
