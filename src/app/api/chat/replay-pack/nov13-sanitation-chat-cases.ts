import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { patch } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * THE SANITATION CHAT (QA, 13 Nov 2026; live conversation, the manager's words with the typos kept)
 * ============================================================================
 *
 * Turn 1, "please make a ca for <A> for not doing th e10 minute sanitaion": live, the card cited Care and Cleaning of
 * Equipment and Facilities p.21 while the saved draft had policy Other. Turn 2, "the 10 minute sanitaion in the
 * morning": the reply said "Updated … Observation of Offense" with no refreshed card. The person is invented (on no
 * directory).
 *
 * The rulings on file (QA): a described cleaning duty stays Other (Pau, 13 Nov 05:31Z) and a named policy wins (04:30Z);
 * here no policy was named, so card and draft must name the SAME policy and never Care and Cleaning. After turn 2 the
 * Observation holds "in the morning", and the reply says truthfully what changed.
 *
 * WHAT THIS REPLAY SHOWS, AND DOES NOT: the live Care and Cleaning pick came from the live model and retrieval; the
 * stand-ins here cite nothing for "sanitaion", so main's card names no policy and the guard holds on main. The turn-2
 * reading is scripted (the edit's own words), so the stored Observation and the reply are checked on the real path.
 * The spelling ("not doing the 10-minute sanitation") is SPELLING_CLEANUP's (Coding-5): its case belongs in that PR, whose
 * flag this branch does not have (a fix arm here could not hold).
 */

const ODESSA: DirectoryRow = { id: "e-odessa", firstName: "Odessa", lastName: "Quillfeather", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const T1 = "please make a ca for Odessa Quillfeather for not doing th e10 minute sanitaion";
const T2 = "the 10 minute sanitaion in the morning";
const REPORT = "QA, 13 Nov 2026: a live sanitation chat (card Care and Cleaning p.21, draft Other; \"Updated\" with no refreshed card)";
const MORNING = patch("this_form", [
  { field: "observation", value: "Observed:\nNot doing th e10 minute sanitaion in the morning.", how: "replace", evidence: "the 10 minute sanitaion in the morning" },
]);

function policyOf(content: string): string {
  return content.split("\n").filter((line) => /\*\*Policy:?\*\*|Policy Manual p\./.test(line)).join("\n");
}

async function play(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
  t.directory([...STAFF, ODESSA]);
  t.as("salon_director", KEARNEY);
  t.patchReads!({ [T2]: MORNING });
  const thread = t.thread();
  const card = await thread.say(T1);
  const id = await thread.create();
  const saved = { ...t.values(id) };
  const reply = await thread.say(T2);
  return { card, id, saved, reply };
}

export const NOV13_SANITATION_CHAT_CASES: ReplayCase[] = [
  {
    id: "nov13-sanitation-chat-card-and-draft-agree",
    title: `"${T1}" then "${T2}": card and saved draft name the same policy (never Care and Cleaning), the Observation keeps "in the morning", and the reply says what changed`,
    report: REPORT,
    status: "fixed",
    fixFlags: ["EDIT_SEES_SAVED_FORM_ENABLED", "CARD_CHECKED_AGAINST_WORDS_ENABLED"],
    async run(t) {
      const { card, id, saved, reply } = await play(t);
      const cardPolicy = policyOf(card.content);
      expect(cardPolicy, `the card cites Care and Cleaning for a described duty:\n${card.content}`).not.toMatch(/care and cleaning/i);
      expect(saved.policy_violated ?? "", "the draft cites Care and Cleaning").not.toMatch(/care and cleaning/i);
      // The same policy on both: Other on the draft is Other (or no policy) on the card.
      if (/\bother\b/i.test(saved.policy_violated ?? "")) expect(cardPolicy, `the draft is Other, the card is not:\n${card.content}`).not.toMatch(/\*\*Policy:\*\*(?![^\n]*\bOther\b)/);
      expect(t.values(id).observation ?? "", `the Observation lost "in the morning":\n${reply.content}`).toMatch(/in the morning/i);
      expect(reply.content, `the reply does not say the Observation changed:\n${reply.content}`).toMatch(/Observation of Offense/);
      expect(reply.content, `"I haven't changed" after a saved change:\n${reply.content}`).not.toMatch(/I haven'?t changed/);
    },
  },
];
