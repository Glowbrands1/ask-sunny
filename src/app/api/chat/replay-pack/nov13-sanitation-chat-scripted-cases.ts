import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { patch } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * THE SANITATION CHAT, WITH THE LIVE CARE AND CLEANING PICK SCRIPTED (Pau's proof chat; QA, 13 Nov 2026)
 * ============================================================================
 *
 * Coding-6's nov13-sanitation-chat-card-and-draft-agree (ask-sunny#929), copied with the live pick scripted: QA's live
 * conversation, the manager's words with the typos kept. Turn 1, "please make a ca for <A> for not doing th e10 minute
 * sanitaion": live, the card cited Care and Cleaning of Equipment and Facilities p.21 while the saved draft had policy
 * Other. Turn 2, "the 10 minute sanitaion in the morning".
 *
 * Coding-6's replay stand-ins cite nothing for "sanitaion", so main's card names no policy there. Here retrieval has the
 * Care and Cleaning passage and the slot stand-in reads its heading, as the live model did, so main reproduces the live
 * disagreement (card Care and Cleaning, draft Other) — OPEN on main — and OTHER_POLICY_AGREES_ENABLED holds it: both
 * Other, no Care and Cleaning line. After turn 2 the Observation keeps "in the morning" and the reply says truthfully
 * that it changed. The person is invented (on no directory); a distinct id from Coding-6's case, so both can live.
 */
const ODESSA: DirectoryRow = { id: "e-odessa", firstName: "Odessa", lastName: "Quillfeather", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const T1 = "please make a ca for Odessa Quillfeather for not doing th e10 minute sanitaion";
const T2 = "the 10 minute sanitaion in the morning";
const REPORT = "QA, 13 Nov 2026 (Pau's proof chat): live card Care and Cleaning p.21, saved draft Other; the live pick scripted here";
const CARE = {
  chunkIndex: 21.5,
  chunkId: "jba-21-5",
  locator: "Page 21 — Care and Cleaning of Equipment and Facilities",
  page: 22,
  content: "Care and Cleaning of Equipment and Facilities\nEmployees keep the salon, its beds and its equipment clean and sanitized as directed.",
  section: "Care and Cleaning of Equipment and Facilities",
  printedPage: 21,
  sections: [],
};
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
  // As live: retrieval has Care and Cleaning, and the slot model reads its heading for "sanitaion".
  t.manualAlsoHas?.([CARE]);
  t.slotsRead({ employee: "Odessa Quillfeather", formType: "Corrective Action Form", formTurn: true, policyHeading: "Care and Cleaning of Equipment and Facilities" });
  t.patchReads!({ [T2]: MORNING });
  const thread = t.thread();
  const card = await thread.say(T1);
  const id = await thread.create();
  const saved = { ...t.values(id) };
  const reply = await thread.say(T2);
  return { card, id, saved, reply };
}

export const NOV13_SANITATION_CHAT_SCRIPTED_CASES: ReplayCase[] = [
  {
    id: "nov13-sanitation-chat-scripted-card-and-draft-agree",
    title: `"${T1}" (Care and Cleaning scripted, as live) then "${T2}": card and saved draft both Other, never Care and Cleaning; the Observation keeps "in the morning", and the reply says what changed`,
    report: REPORT,
    status: { open: "the card cites Care and Cleaning p.21 while the saved draft is Other" },
    fixFlags: ["OTHER_POLICY_AGREES_ENABLED"],
    async run(t) {
      const { card, id, saved, reply } = await play(t);
      const cardPolicy = policyOf(card.content);
      expect(cardPolicy, `the card cites Care and Cleaning for a described duty:\n${card.content}`).not.toMatch(/care and cleaning|p\.21/i);
      expect(card.content, `the card's policy is not Other:\n${card.content}`).toMatch(/\*\*Policy:\*\* Other\b/);
      expect(saved.policy_violated ?? "", `the draft is not Other: ${JSON.stringify(saved)}`).toBe("Other");
      expect(t.values(id).observation ?? "", `the Observation lost "in the morning":\n${reply.content}`).toMatch(/in the morning/i);
      expect(reply.content, `the reply does not say the Observation changed:\n${reply.content}`).toMatch(/Observation of Offense/);
      expect(reply.content, `"I haven't changed" after a saved change:\n${reply.content}`).not.toMatch(/I haven'?t changed/);
    },
  },
];
