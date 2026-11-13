import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * THE PLACE READER NEVER CHANGES WHAT THE OBSERVATION SAYS (Gate-Sunny probes on #933, 13 Nov 2026)
 * ============================================================================
 *
 * Found by the gate's probes for #933 (SHARED_CITY_ASKS_SALON), identical with every new flag off, so on main:
 *
 *   1. "create a ca for marnie holloway, she was late because she was at lincoln high" — the Observation of Offense
 *      reads "she was late because she was high": "at lincoln" is taken out as a place and the sentence now says
 *      something else on an HR record. HIGH PRIORITY (QA).
 *   2. "create a ca for marnie holloway at omaha west, she was late" — the Observation reads "marnie holloway west, she
 *      was late": "at omaha" is taken out and "west" and the employee's name are left behind.
 *
 * The person is invented. Cases written by Gate-Sunny; the fix flag (PLACE_STRIP_WHOLE_PHRASE_ONLY, coding 4) and the
 * guard below added with the fix.
 */
const FLAG = "PLACE_STRIP_WHOLE_PHRASE_ONLY_ENABLED";
const REPORT = "Gate-Sunny probes on #933 (13 Nov 2026), pre-existing on main; invented person";
const EVERY_SALON = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

async function observationOf(t: ReplayContext, turn: string): Promise<{ reply: string; said: string }> {
  vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("admin", EVERY_SALON);
  const thread = t.thread();
  const reply = (await thread.say(turn)).content;
  const said = /\*\*Observation of Offense:\*\*\s*([^\n]*)/i.exec(reply)?.[1]?.trim() ?? "";
  return { reply, said };
}

export const NOV13_OBSERVATION_PLACE_STRIP_MEANING_CASES: ReplayCase[] = [
  {
    id: "nov13-observation-at-lincoln-high-keeps-meaning",
    title: `Admin: "… she was late because she was at lincoln high" — the Observation never reads "because she was high"`,
    report: `${REPORT}; QA: high priority, it changes the meaning of an HR record`,
    status: { open: `the Observation reads "she was late because she was high": "at lincoln" is stripped as a place` },
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, said } = await observationOf(t, "create a ca for marnie holloway, she was late because she was at lincoln high");
      expect(said, `the place reader changed the account:\n${reply}`).not.toMatch(/\bshe was high\b/i);
      expect(said, `the account lost where she was:\n${reply}`).toMatch(/lincoln high/i);
    },
  },
  {
    id: "nov13-observation-at-omaha-west-no-leftover",
    title: `Admin: "create a ca for marnie holloway at omaha west, she was late" — no "marnie holloway west" left in the Observation`,
    report: REPORT,
    status: { open: `the Observation reads "marnie holloway west, she was late": "at omaha" is stripped and "west" left behind` },
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, said } = await observationOf(t, "create a ca for marnie holloway at omaha west, she was late");
      expect(said, `a fragment of the place was left in the Observation:\n${reply}`).not.toMatch(/holloway west/i);
      expect(said, `the employee's name leaked into the Observation:\n${reply}`).not.toMatch(/marnie|holloway/i);
    },
  },
  {
    // Guard (coding 4): a place whose phrase ends still leaves the Observation, with the flag or without.
    id: "nov13-observation-whole-place-still-stripped",
    title: `Admin: "create a ca for marnie holloway, she was late at omaha today" — "at omaha" still leaves the Observation`,
    report: `${REPORT}; guard`,
    status: "fixed",
    async run(t: ReplayContext) {
      const { reply, said } = await observationOf(t, "create a ca for marnie holloway, she was late at omaha today");
      expect(said, `the place stayed in the Observation:\n${reply}`).not.toMatch(/\bomaha\b/i);
      expect(said, `the account was lost:\n${reply}`).toMatch(/\bshe was late\b/i);
    },
  },
  {
    // Guard (QA's must-keep ruling on #933): a clause whose "at …" is not a read place keeps every word.
    id: "nov13-observation-front-desk-kept",
    title: `Admin: "create a ca for marnie holloway at the front desk, she was rude to a guest" — "at the front desk" is kept`,
    report: `${REPORT}; guard`,
    status: "fixed",
    async run(t: ReplayContext) {
      const { reply, said } = await observationOf(t, "create a ca for marnie holloway at the front desk, she was rude to a guest");
      expect(said, `"at the front desk" was lost:\n${reply}`).toContain("at the front desk");
    },
  },
  {
    // Gate-Sunny's #936 probe (13 Nov 2026): the place before "and" still leaves, and nothing else does.
    id: "nov13-observation-place-before-and-stripped",
    title: `Admin: "create a ca for marnie holloway, she was late at omaha and left early" — "at omaha" leaves, "and left early" stays`,
    report: `${REPORT}; Gate-Sunny's #936 probe`,
    status: {
      open: `off, "at omaha and" is stripped ("she was late left early"); with the flag, "omaha and" is tried first, "left" does not carry on, and "at omaha" is kept`,
    },
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, said } = await observationOf(t, "create a ca for marnie holloway, she was late at omaha and left early");
      expect(said, `the place stayed in the Observation:\n${reply}`).not.toMatch(/\bomaha\b/i);
      expect(said, `the account lost a word:\n${reply}`).toMatch(/\bshe was late and left early\b/i);
    },
  },
];
