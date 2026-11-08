import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayAnswer, type ReplayCase } from "./cases";
import { at } from "./nov4-live-regressions-scenarios";

/**
 * ============================================================================
 * A CARD WITH NO EMPLOYEE ALWAYS ASKS WHO (QA, 7 Nov 2026, the Sunny check of the FORM_NAME gate)
 * ============================================================================
 *
 * With production's flags + FORM_NAME_FROM_ROSTER alone, "create a ca form for <near-miss name>" → "verbal warning
 * …" made a card with no employee; the reply asked "Who is this form for?" only at its very end, after "I'll draft a
 * Corrective Action Form from what you've described …", and never offered the close roster person. With the five
 * companions on too (ROSTER_NEAR_MISS, ROSTER_NAME_IN_CANDIDATE, ROSTER_COMPOUND_SURNAME,
 * ROSTER_NOT_FOUND_ANY_PHRASING, OFF_ROSTER_CONFIRM; NEAR_MISS_DETAILS_ACCEPT is the sixth) it asks "Is this for **<roster name>**?" and the next card is
 * for them. QA's ruling: FORM_NAME only ships with all six (`lib/config/form-name-companions.test.ts`). These cases
 * guard the invariant on every turn — a card with no employee asks who the form is for, or offers a person, and
 * never invites Create — in production (FORM_NAME off: the card takes the name as typed) and with FORM_NAME and its
 * companions. A request with no name at all is the control. The manager's words in this app's setting; the people
 * are invented and on neither directory.
 */
const FORM_NAME_SET = [
  "FORM_NAME_FROM_ROSTER_ENABLED",
  "ROSTER_NEAR_MISS_ENABLED",
  "ROSTER_NAME_IN_CANDIDATE_ENABLED",
  "ROSTER_COMPOUND_SURNAME_ENABLED",
  "ROSTER_NOT_FOUND_ANY_PHRASING_ENABLED",
  "OFF_ROSTER_CONFIRM_ENABLED",
  "NEAR_MISS_DETAILS_ACCEPT_ENABLED",
];
const REPORT = "QA, 7 Nov 2026 (the Sunny check of the FORM_NAME gate): with production flags + FORM_NAME, a near-miss name gave a card with no employee";
const CORVINA = at("ne-corvina", "Corvina", "Vellacott");
const DELPHINE = at("ne-delphine", "Delphine", "Marlowe Ostrander");
/** The reply asks who, or names a person to confirm. */
const ASKS_OR_OFFERS = /Who is this (?:\*\*[^*]+\*\* |form )?for\?|Is this for \*\*|Did you mean|Which of them|full name|reply \*\*use /i;

const CHATS: readonly { id: string; title: string; turns: readonly string[] }[] = [
  {
    id: "delphine-surname-typo",
    title: "\"create a ca form for Delphine Marlwoe Ostrander\" → \"verbal warning The date she complained was Oct 31st …\"",
    turns: [
      "create a ca form for Delphine Marlwoe Ostrander",
      "verbal warning The date she complained was Oct 31st . The customer said she was giving her an attitude when she brought up that the register was charging for scent in her lotion refills and it has never done that before. When Delphine spoke with District manager Tobias Wrenfield she said the customer had raised her voice first and she only explained the price.",
    ],
  },
  {
    id: "corvina-middle-name-typo",
    title: "\"i have an employee, Corvina Ashdown Vellacot that needs a corrective action form with a customer complaint\" → \"verbal warning, no payroll deduct, part-time tanning consultant,\"",
    turns: ["i have an employee, Corvina Ashdown Vellacot that needs a corrective action form with a customer complaint", "verbal warning, no payroll deduct, part-time tanning consultant,"],
  },
  {
    id: "no-name-control",
    title: "control: \"create a ca form\" → \"verbal warning, she was rude to a guest at the front desk on 11/2\" (no name at all)",
    turns: ["create a ca form", "verbal warning, she was rude to a guest at the front desk on 11/2"],
  },
];

export const NOV7_FORM_NAME_EMPTY_CARD_CASES: ReplayCase[] = CHATS.map(
  ({ id, title, turns }): ReplayCase => ({
    id: `nov7-form-name-empty-card-${id}`,
    title: `${title}: on every turn, a card with no employee asks who the form is for`,
    report: REPORT,
    status: "fixed",
    fixFlags: FORM_NAME_SET,
    async run(t) {
      vi.setSystemTime(new Date("2026-11-04T15:30:00Z"));
      t.directory([...STAFF, CORVINA, DELPHINE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      for (const [index, turn] of turns.entries()) {
        const reply: ReplayAnswer = await thread.say(turn);
        const card = thread.proposal;
        if (!card || card.subject === "team" || card.employeeName?.trim()) continue;
        expect(reply.content, `turn ${index + 1}: a card with no employee, and nobody is asked who:\n${reply.content}`).toMatch(ASKS_OR_OFFERS);
        expect(reply.content, `turn ${index + 1}: a card with no employee invites Create:\n${reply.content}`).not.toMatch(/Create the draft here when you're ready/);
      }
    },
  }),
);
