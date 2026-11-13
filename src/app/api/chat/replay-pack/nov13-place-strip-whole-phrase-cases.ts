import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A PLACE LEAVES THE OBSERVATION ONLY WHERE ITS WHOLE PHRASE ENDS (QA, Gate-Sunny's #933 probes, 13 Nov 2026)
 * ============================================================================
 *
 * Pre-existing on Sunny main 5d9f1767, found by Gate-Sunny's probes (QA: high — it changed an HR record's meaning):
 *   "she was late because she was at lincoln high" → Observation "she was late because she was high";
 *   "create a ca for <A> at omaha west, she was late" → Observation "<A> west, she was late".
 * The account reader took "at lincoln" / "at omaha" out of a longer name. With the flag a place is taken out only where
 * its whole phrase ends; otherwise every word is kept. Invented person.
 */
const FLAG = "PLACE_STRIP_WHOLE_PHRASE_ONLY_ENABLED";
const REPORT = "QA, Gate-Sunny's #933 probes (13 Nov 2026), pre-existing on main; invented person";
const EVERY_SALON = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

async function observationOf(t: ReplayContext, turn: string): Promise<{ said: string; reply: string }> {
  vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("admin", EVERY_SALON);
  const reply = (await t.thread().say(turn)).content;
  return { said: /\*\*Observation of Offense:\*\*\s*([^\n]*)/i.exec(reply)?.[1]?.trim() ?? "", reply };
}

export const NOV13_PLACE_STRIP_WHOLE_PHRASE_CASES: ReplayCase[] = [
  {
    id: "nov13-place-strip-lincoln-high-kept",
    title: `"… she was late because she was at lincoln high" — never "she was high"; the words are kept`,
    report: REPORT,
    status: { open: `the Observation reads "she was late because she was high"` },
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { said, reply } = await observationOf(t, "create a ca for marnie holloway, she was late because she was at lincoln high");
      expect(said, `the Observation's meaning changed:\n${reply}`).not.toMatch(/\bshe was high\b/i);
      expect(said, `the place was lost:\n${reply}`).toMatch(/\blincoln high\b/i);
    },
  },
  {
    id: "nov13-place-strip-omaha-west-kept",
    title: `"create a ca for <A> at omaha west, she was late" — never "<A> west"; "omaha west" is not cut`,
    report: REPORT,
    status: { open: `the Observation reads "marnie holloway west, she was late"` },
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { said, reply } = await observationOf(t, "create a ca for marnie holloway at omaha west, she was late");
      expect(said, `"at omaha" was cut out of "omaha west":\n${reply}`).not.toMatch(/\bholloway west\b/i);
      expect(said, `the account was lost:\n${reply}`).toMatch(/\bshe was late\b/i);
    },
  },
  {
    // Guard: a place whose phrase ends still leaves the Observation, with the flag or without.
    id: "nov13-place-strip-whole-place-still-stripped",
    title: `"create a ca for <A>, she was late at omaha today" — "at omaha" still leaves the Observation`,
    report: `${REPORT}; guard`,
    status: "fixed",
    async run(t: ReplayContext) {
      const { said, reply } = await observationOf(t, "create a ca for marnie holloway, she was late at omaha today");
      expect(said, `the place stayed in the Observation:\n${reply}`).not.toMatch(/\bomaha\b/i);
      expect(said, `the account was lost:\n${reply}`).toMatch(/\bshe was late\b/i);
    },
  },
];
