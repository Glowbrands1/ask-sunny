import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * REASON_SUBJECT_ANY_NOUN_PHRASE — "BECAUSE HER KID WAS SICK IN LINCOLN" IS WHY, NOT THE SALON (QA, 14 Nov 2026)
 * ============================================================================
 *
 * Gate-Sunny's #975 follow-up, QA's ruling: with REASON_PLACE_NOT_SALON on, "she left early because her kid was sick in
 * lincoln" still read Lincoln as the salon (asked which Lincoln salon) and the Observation lost "in lincoln": the
 * reason's subject is not she/he. With REASON_SUBJECT_ANY_NOUN_PHRASE_ENABLED the place is neither. Invented person.
 */
const FLAGS = ["REASON_PLACE_NOT_SALON_ENABLED", "REASON_SUBJECT_ANY_NOUN_PHRASE_ENABLED"];
const REPORT = "Gate-Sunny's #975 follow-up, QA's ruling (14 Nov 2026); invented person";
const EVERY_SALON = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

async function cardFor(t: ReplayContext, turn: string) {
  vi.setSystemTime(new Date("2026-11-14T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("admin", EVERY_SALON);
  const thread = t.thread();
  const reply = (await thread.say(turn)).content;
  return {
    reply,
    locationId: (thread.proposal as { locationId?: string | null } | null)?.locationId ?? null,
    observation: /\*\*Observation of Offense:\*\*\s*([^\n]*)/.exec(reply)?.[1] ?? "",
  };
}

export const NOV14_REASON_SUBJECT_ANY_NOUN_PHRASE_CASES: ReplayCase[] = [
  {
    id: "nov14-reason-subject-any-noun-phrase-kid-sick-in-lincoln",
    title: `Admin: "create a ca for tavia quellan, she left early because her kid was sick in lincoln" — no salon read, "in lincoln" kept`,
    report: REPORT,
    status: { open: "Lincoln is read as the salon and \"in lincoln\" leaves the account" },
    fixFlags: FLAGS,
    async run(t: ReplayContext) {
      const { reply, locationId, observation } = await cardFor(t, "create a ca for tavia quellan, she left early because her kid was sick in lincoln");
      expect(locationId, `a salon was read from the reason:\n${reply}`).toBeNull();
      expect(reply, `a Lincoln salon was asked about:\n${reply}`).not.toMatch(/NE Lincoln/);
      expect(observation, `the account lost the words:\n${reply}`).toMatch(/because her kid was sick in lincoln/i);
    },
  },
  {
    id: "nov14-reason-subject-any-noun-phrase-car-broke-down",
    title: `Admin: "create a ca for tavia quellan, she was late because her car broke down in kearney" — not filed at NE Kearney`,
    report: REPORT,
    status: { open: "Kearney in the reason is filed as the salon" },
    fixFlags: FLAGS,
    async run(t: ReplayContext) {
      const { reply, locationId } = await cardFor(t, "create a ca for tavia quellan, she was late because her car broke down in kearney");
      expect(locationId, `a salon was read from the reason:\n${reply}`).not.toBe("loc-0309");
    },
  },
];

/** Guards, flags off and on: a salon said as the salon, or where she was late, is still filed. */
export const NOV14_REASON_SUBJECT_ANY_NOUN_PHRASE_GUARDS: ReplayCase[] = [
  "create a ca for tavia quellan at kearney, she left early because her kid was sick",
  "create a ca for tavia quellan, she was written up because she was late at kearney",
].map((turn, index) => ({
  id: `nov14-reason-subject-any-noun-phrase-guard-${index + 1}`,
  title: `Admin: "${turn}" — filed at NE Kearney`,
  report: REPORT,
  status: "fixed",
  fixFlags: FLAGS,
  async run(t: ReplayContext) {
    const { reply, locationId } = await cardFor(t, turn);
    expect(locationId, `the salon was not filed:\n${reply}`).toBe("loc-0309");
  },
}));
