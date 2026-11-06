import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * THE SUNNY FLIP-3 GATE, DEFECTS 2 AND 3 (6 Nov 2026; FORM_NAME_FROM_ROSTER_ENABLED)
 * ============================================================================
 *
 * Bisected to FORM_NAME_FROM_ROSTER alone:
 * 2. "coaching form for 123 Main Street" lost ADDRESS_NOT_PERSON's explanation — "\"Main Street\" reads as a street
 *    address, not a person" — and asked only "Who is this form for?": the off-roster name was cleared before the
 *    address step saw it.
 * 3. "I need a CA for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %." lost "Under
 *    Performance on PPTA" from the Observation of Offense.
 * The wordings are QA's existing cases' (nov3-street-name-cases, nov5-request-slot-cases).
 */
const LIVE = ["CHAT_GLOSSARY_ENABLED", "CA_SALES_POLICY_ENABLED", "REPLY_MATCHES_CARD_ENABLED", "TITLE_OF_THE_EMPLOYEE_ENABLED", "METRIC_GUARD_ENABLED", "TITLE_ENDS_AT_LINE_ENABLED", "BARE_NOT_DENIAL_ENABLED", "PLACE_FROM_CUE_ENABLED"];
const NAME_SET = [
  "FORM_NAME_FROM_ROSTER_ENABLED",
  "ROSTER_NEAR_MISS_ENABLED",
  "ROSTER_NAME_IN_CANDIDATE_ENABLED",
  "ROSTER_COMPOUND_SURNAME_ENABLED",
  "ROSTER_NOT_FOUND_ANY_PHRASING_ENABLED",
  "OFF_ROSTER_CONFIRM_ENABLED",
];

export const NOV6_FORM_NAME_SUNNY_GATE_CASES: ReplayCase[] = [
  {
    id: "nov6-form-name-keeps-street-explanation",
    title: "gate defect 2: \"coaching form for 123 Main Street\" with the name set on still says \"Main Street\" reads as a street address, not a person",
    report: "The Sunny flip-3 gate (6 Nov 2026): FORM_NAME_FROM_ROSTER lost ADDRESS_NOT_PERSON's explanation",
    status: "fixed",
    fixFlags: [...LIVE, ...NAME_SET, "ADDRESS_NOT_PERSON_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const reply = await t.thread().say("coaching form for 123 Main Street");
      expect(reply.content, `the street-address explanation is lost:\n${reply.content}`).toMatch(/"Main Street" reads as a street address, not a person/);
      expect(reply.content, `the street is said back as a person not found:\n${reply.content}`).not.toMatch(/I couldn['’]t find \*\*Main Street\*\*/);
    },
  },
  {
    id: "nov6-form-name-keeps-under-performance",
    title: "gate defect 3: \"I need a CA for Under Performance on PPTA, …\" with the name set on: the Observation keeps \"Under Performance on PPTA\"",
    report: "The Sunny flip-3 gate (6 Nov 2026): FORM_NAME_FROM_ROSTER dropped the manager's words from the Observation",
    status: { open: "in production, as nov5-request-slot-ca-for-under-performance is: its fix flags (CA_SALES, the glossary) are not in the flags file yet" },
    fixFlags: [...LIVE, ...NAME_SET],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const reply = await t.thread().say("I need a CA for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.");
      const observation = /\*\*Observation of Offense:\*\*[^\n]*/.exec(reply.content)?.[0] ?? "";
      expect(observation, `no Observation:\n${reply.content}`).not.toBe("");
      expect(observation, `the Observation drops the manager's words:\n${reply.content}`).toMatch(/Under Performance on PPTA/);
    },
  },
];
