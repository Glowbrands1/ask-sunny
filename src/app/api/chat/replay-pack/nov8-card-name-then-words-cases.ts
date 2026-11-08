import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * sf-s38 (3): THE RIGHT CARD COULD NOT BE CREATED (QA's morning scan, 8 Nov 2026; Sunny production, conv f5e4e29a)
 * ============================================================================
 *
 * The manager's words (QA checked them against the DB), the employee swapped for an invented one (the pack's STAFF):
 *   T1 "make me an CA for <A> missing her saturday and sunday shifts due to wanting to go home for the weekend but
 *      failed to communicate proporley" → the card for <A>, then Create:
 *      "This proposal is out of date: the conversation now says the form is for <A> missing, not <A>. Use the newest
 *       proposal."  (what the manager saw; the name reader ran on into "missing")
 *   … and, at the end, the one that worked: "Make me a CA for <A> not showing up to her shifts on  11/7 and 11/8".
 * Width (main 0ae7b2e, production's flags + flip 9 + round 4): "for <A> failing …" is refused the same way; typed in
 * lower case, "for <a> missing her shift …" makes the card itself "<A> Missing", and Create makes the form so.
 * "not showing up" and "being late" were never refused (guards). CARD_NAME_THEN_WORDS_CURRENT_ENABLED.
 */
const FIX = ["CARD_NAME_THEN_WORDS_CURRENT_ENABLED"];
const REPORT = "QA's sf-s38 (3), 8 Nov 2026 (Sunny production, conv f5e4e29a): Create refused the right card";

async function createFor(t: ReplayContext, said: string) {
  vi.setSystemTime(new Date("2026-11-07T16:14:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(said);
  expect(thread.proposal, `no Corrective Action card:\n${said}`).toMatchObject({ templateKey: "dpoa", employeeName: "Rowan Kestrel" });
  t.draftWrites({ observation: "Observed:\nRowan Kestrel missed her scheduled shifts and did not communicate it." });
  const id = await thread.create();
  expect(t.values(id).employee_name ?? "", "the saved form's employee").toBe("Rowan Kestrel");
}

const SHAPES: { key: string; said: string; status: ReplayCase["status"] }[] = [
  {
    key: "t1-missing",
    said: "make me an CA for Rowan Kestrel missing her saturday and sunday shifts due to wanting to go home for the weekend but failed to communicate proporley",
    status: { open: "Create: \"This proposal is out of date: the conversation now says the form is for Rowan Kestrel missing, not Rowan Kestrel\"" },
  },
  {
    key: "failing",
    said: "make me a CA for Rowan Kestrel failing to show up for her saturday shift",
    status: { open: "Create: \"… the form is for Rowan Kestrel failing, not Rowan Kestrel\"" },
  },
  {
    key: "lower-case-missing",
    said: "make me a CA for rowan kestrel missing her shift on 11/7",
    status: { open: "the card, and the saved form, are for \"Rowan Kestrel Missing\"" },
  },
  {
    key: "not-showing-up",
    said: "Make me a CA for Rowan Kestrel not showing up to her shifts on  11/7 and 11/8",
    status: "fixed",
  },
  {
    key: "being-late",
    said: "make me a CA for Rowan Kestrel being late to her shift on 11/7",
    status: "fixed",
  },
];

export const NOV8_CARD_NAME_THEN_WORDS_CASES: ReplayCase[] = SHAPES.map(({ key, said, status }) => ({
  id: `nov8-card-name-then-words-${key}`,
  title: `sf-s38 (3) "${said.slice(0, 60)}…" → Create: the form is for Rowan Kestrel`,
  report: REPORT,
  status,
  fixFlags: FIX,
  run: (t) => createFor(t, said),
}));
