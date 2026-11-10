import { expect, vi } from "vitest";

import { STAFF, type ReplayAnswer, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * P12, PART 2 — THE TEAM CARD (QA's live finding on Sunny round 17, 10 Nov 2026)
 * ============================================================================
 *
 * "make me a coaching form for the team at Pine Lake on selling lotion bottles" → the team card's Observation read
 * "the whole team: make me a coaching form for the team on selling lotion bottles"; then "the employee needs to be left
 * blank" → "the team on selling lotion bottles the employee needs to be left blank". The request lead and the
 * instruction about the Employee field are no account. QA's turns are verbatim (no person is named).
 */

const PINE_LAKE = { level: "salon" as const, primaryAreaId: "loc-0312", alsoCoversAreaIds: [] };
const TURNS = ["make me a coaching form for the team at Pine Lake on selling lotion bottles", "the employee needs to be left blank"] as const;

function observationLine(reply: ReplayAnswer): string {
  return /\*\*Observation of Offense:?\*\*\s*([^\n]*)/i.exec(reply.content)?.[1]?.trim() ?? "";
}

export const NOV10_P12_TEAM_CARD_INSTRUCTIONS_CASES: ReplayCase[] = [
  {
    id: "nov10-p12-team-card-no-request-lead-or-blank-employee",
    title: `P12 part 2 (team card): "${TURNS[0]}" → "${TURNS[1]}": the Observation is the team's account, never the request lead or the instruction`,
    report: `QA, 10 Nov 2026 (Sunny round 17, live): "${TURNS[0]}" → Observation "the whole team: make me a coaching form for the team on selling lotion bottles"; "${TURNS[1]}" → "the team on selling lotion bottles the employee needs to be left blank"`,
    // Changed on purpose (10 Nov 2026): fixed in production by APP_INSTRUCTIONS_NOT_ACCOUNT_ENABLED, QA round 20; it now holds with production's flags.
    status: "fixed",
    fixFlags: ["APP_INSTRUCTIONS_NOT_ACCOUNT_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-10T06:30:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", PINE_LAKE);
      const thread = t.thread();
      for (const said of TURNS) {
        const reply = await thread.say(said);
        expect(thread.proposal, `no team Coaching card after "${said}":\n${reply.content}`).toMatchObject({ templateKey: "coaching", subject: "team" });
        const observation = observationLine(reply);
        expect(observation, `the Observation lost the account after "${said}":\n${reply.content}`).toMatch(/selling lotion bottles/i);
        expect(observation, `the request lead is the Observation after "${said}"`).not.toMatch(/\b(?:make|create)\s+me\b|coaching form|whole team:/i);
        expect(observation, `the Employee-field instruction is the Observation after "${said}"`).not.toMatch(/left blank|employee needs/i);
      }
    },
  },
];
