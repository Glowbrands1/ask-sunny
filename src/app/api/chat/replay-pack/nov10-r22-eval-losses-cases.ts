import { expect } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * QA's round-22 eval check (10 Nov 2026): with the roster-name set on, two cards lost what the manager gave. The
 * wording is the eval's (evals/replay_set.json sf-s4 and s14; names invented there). Fixed in the set: sf-s4 under
 * FORM_NAME_FROM_ROSTER (`forms/request-slot.ts`), s14 under ROSTER_NEAR_MISS (`ai/first-name-suggest.ts`).
 */
const SET = [
  "FORM_NAME_FROM_ROSTER_ENABLED",
  "ROSTER_NEAR_MISS_ENABLED",
  "ROSTER_NAME_IN_CANDIDATE_ENABLED",
  "ROSTER_COMPOUND_SURNAME_ENABLED",
  "ROSTER_NOT_FOUND_ANY_PHRASING_ENABLED",
  "SLOT_NAME_ON_FORM_REQUEST_ENABLED",
  "NEAR_MISS_QUESTION_RULES_ENABLED",
  "NEAR_MISS_DETAILS_ACCEPT_ENABLED",
  "FORM_NAME_OFF_ROSTER_ASK_ENABLED",
];
const REPORT = "QA, 10 Nov 2026: round-22 eval check (sf-s4, s14), losses the roster-name set caused";
const GLOBAL = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

const ROZLYN: DirectoryRow = {
  id: "e-rozlyn-quellmar",
  firstName: "Rozlyn",
  lastName: "Quellmar",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0462"],
  positionName: "Tanning Consultant",
};

/** evals/replay_set.json s14, word for word. */
const S14_TURNS = [
  "help me create a coaching form",
  "1.  Can I keep this field blank to use this coaching form with multiple staff?\n2. October 1st\n3. it's for october promotions, can i upload the pdf to read off of?\n4. tanning consultant",
  "1. employee name is blank\n2. knowledge on october promotions",
  "Timeline: October 1 – October 31\nOffers: \n• $5 Red Light Visits\n• Eight Red Light Visits for $35\n• Wellness Product Bundle: KIT Restored Red Light for $79.99 ($64.98 Savings + $6 Bonus)\n➢ BOT Restored Prep Spray\n➢ BOT Restored Post Cream\n➢ BOT Restored Target Serum\n➢ Five Wellness Visits\nTimeline: October 1 – October 31\nOffers: \n• $5 Red Light Visits\n• Eight Red Light Visits for $35\n• Wellness Product Bundle: KIT Restored Red Light for $79.99 ($64.98 Savings + $6 Bonus)\n➢ BOT Restored Prep Spray\n➢ BOT Restored Post Cream\n➢ BOT Restored Target Serum\n➢ Five Wellness Visits\nTimeline: October 1 – October 31\nOffers: \n• $5 Red Light Visits\n• Eight Red Light Visits for $35\n• Wellness Product Bundle: KIT Restored Red Light for $79.99 ($64.98 Savings + $6 Bonus)\n➢ BOT Restored Prep Spray\n➢ BOT Restored Post Cream\n➢ BOT Restored Target Serum\n➢ Five Wellness Visits\nTimeline: October 1 – October 31\nOffers: \n• $5 Red Light Visits\n• Eight Red Light Visits for $35\n• Wellness Product Bundle: KIT Restored Red Light for $79.99 ($64.98 Savings + $6 Bonus)\n➢ BOT Restored Prep Spray\n➢ BOT Restored Post Cream\n➢ BOT Restored Target Serum\n➢ Five Wellness Visits\nTimeline: October 1 – October 31\nOffers: \n• ",
  "for rozlin quellmar.  all of it if possible",
  "oh lets create a follow-up coaching form instead then",
  "red light visits and mentioning them on every client check-in.",
  "ok, create a follow-up coaching form for rozline quellmar.  for a must see behavior.  i trained her on the promotions, specificslly the $5 red light therapy promo, and  i roleplayed a couple objections with her. the follow-up is that i'll listen in on her with client engagment, tie the mention of redlight into the reason the client is there in the first place",
  "Oops, it's Rozlyn quellmar",
  "create a follow-up coaching form for rozlyn quellmar",
  "can you clean up my grammar and capitalizing on proper nouns?",
  "ok, make the grammatical changes mentioned that CAN be made.  i will listen to at least 10 check-ins on the next shift we overlap.",
  "create a follow-up coaching form for Rozlyn Quellmar",
  "can you carry over the other details from the other draft into any missing fields  here?",
  "This draft is missing 'follow-up observation, 'progress level', and 'specific evidence' that was filled in the draft before that.",
];

const SF_S4 = "make me a CA for Odalys merriwether for being late to opening this morning";

export const NOV10_R22_EVAL_LOSSES_CASES: ReplayCase[] = [
  {
    id: "nov10-r22-sf-s4-off-roster-lowercase-surname",
    title: "sf-s4, off the roster: \"make me a CA for Odalys merriwether …\" — never the first name alone",
    report: `${REPORT} (sf-s4)`,
    status: "fixed",
    fixFlags: SET,
    async run(t) {
      // A salon manager naming somebody who is not on the roster: the off-roster rules decide whether the name goes on
      // the card (they leave it off, typed with a capital or not). The loss is the surname alone being dropped.
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say(SF_S4);
      expect(thread.proposal?.employeeName ?? null, "never the first name alone").not.toBe("Odalys");
      expect(reply.content, "never offered as the first name alone").not.toMatch(/\*\*Odalys\*\*/);
    },
  },
  {
    id: "nov10-r22-sf-s4-roster-read-empty",
    title: "sf-s4, the roster read returns nobody: the card keeps the surname",
    report: `${REPORT} (sf-s4, roster read failing)`,
    status: "fixed",
    fixFlags: SET,
    async run(t) {
      t.directory([]);
      t.as("salon_director", GLOBAL);
      const thread = t.thread();
      await thread.say(SF_S4);
      expect(thread.proposal?.employeeName ?? null).toBe("Odalys Merriwether");
    },
  },
  {
    id: "nov10-r22-sf-s4-negative-for-being-late",
    title: "negative: a lower-case word after \"for\" that is no name (\"for being late\", \"for tardiness\") never becomes one",
    report: `${REPORT} (sf-s4 negative)`,
    status: "fixed",
    fixFlags: SET,
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      for (const said of ["make me a CA for being late to opening this morning", "make me a CA for tardiness, she was late again"]) {
        const thread = t.thread();
        const reply = await thread.say(said);
        const card = thread.proposal?.employeeName ?? null;
        expect(card, `"${said}": no employee is read from the reason`).toBeNull();
        expect(reply.content).not.toMatch(/\*\*(?:Being|Being Late|Tardiness)\*\*/i);
      }
    },
  },
  {
    id: "nov10-r22-s14-date-kept-after-name-correction",
    title: "s14: after \"Oops, it's Rozlyn quellmar\", the follow-up coaching card keeps 2026-10-01 to the last turn",
    report: `${REPORT} (s14)`,
    status: "fixed",
    fixFlags: SET,
    async run(t) {
      t.directory([...STAFF, ROZLYN]);
      t.as("salon_director", GLOBAL);
      const thread = t.thread();
      for (const said of S14_TURNS) await thread.say(said);
      expect(thread.proposal?.employeeName ?? null).toBe("Rozlyn Quellmar");
      expect(thread.proposal?.formDate ?? null, "the date given on turn 2 is kept").toMatch(/-10-01$/);
    },
  },
];
