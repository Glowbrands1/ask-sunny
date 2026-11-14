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
    // Changed on purpose (14 Nov 2026): fixed in production by PLACE_STRIP_WHOLE_PHRASE_ONLY_ENABLED, QA round 38h. Was OPEN.
    status: "fixed",
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
    // Changed on purpose (14 Nov 2026): fixed in production by PLACE_STRIP_WHOLE_PHRASE_ONLY_ENABLED, QA round 38h. Was OPEN.
    status: "fixed",
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
    fixFlags: [FLAG],
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
    fixFlags: [FLAG],
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
    // Changed on purpose (14 Nov 2026): fixed in production by PLACE_STRIP_WHOLE_PHRASE_ONLY_ENABLED, QA round 38h. Was OPEN.
    status: "fixed",
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, said } = await observationOf(t, "create a ca for marnie holloway, she was late at omaha and left early");
      expect(said, `the place stayed in the Observation:\n${reply}`).not.toMatch(/\bomaha\b/i);
      expect(said, `the account lost a word:\n${reply}`).toMatch(/\bshe was late and left early\b/i);
    },
  },
];

/*
 * QA, after Gate-Bubbles-3's finding on the sibling app's #869 (13 Nov 2026): an allow-list of words that may follow a
 * place stopped real places being read. A place followed by a date, a dash, a weekday or a bracket must still be read
 * (it leaves the Observation; the account stays). Guards: they hold on production's flags and with the flag.
 */
const MUST_READ: readonly { key: string; turn: string; place: RegExp; account: RegExp }[] = [
  { key: "omaha-date", turn: "create a ca for marnie holloway, she was late at omaha 11/1/26", place: /\bomaha\b/i, account: /\bshe was late\b/i },
  { key: "kearney-dash", turn: "create a ca for marnie holloway, she was at kearney - no call no show", place: /\bkearney\b/i, account: /no call no show/i },
  { key: "lincoln-monday", turn: "create a ca for marnie holloway, she was late at lincoln monday", place: /\blincoln\b/i, account: /\bshe was late\b/i },
  { key: "omaha-paren", turn: "create a ca for marnie holloway, she was at omaha (late)", place: /\bomaha\b/i, account: /\blate\b/i },
  // Mirrored from Gate-Bubbles-3's #869 follow-up: a block-list word before "of" is a direction, not a longer name.
  { key: "omaha-west-of", turn: "create a ca for marnie holloway, she was late at omaha west of the beds", place: /\bomaha\b/i, account: /west of the beds/i },
];

export const NOV13_OBSERVATION_PLACE_MUST_READ_CASES: ReplayCase[] = MUST_READ.map((wording) => ({
  id: `nov13-observation-place-must-read-${wording.key}`,
  title: `Admin: "${wording.turn}" — the place is still read and leaves the Observation`,
  report: "QA (13 Nov 2026), after Gate-Bubbles-3's #869 finding: a real place mention is never lost; invented person",
  status: "fixed",
  // Run with the flag too (Gate-Sunny): a guard the flag could break must be checked with it on.
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    const { reply, said } = await observationOf(t, wording.turn);
    expect(said, `the place was not read:\n${reply}`).not.toMatch(wording.place);
    expect(said, `the account was lost:\n${reply}`).toMatch(wording.account);
  },
}));

/*
 * Gate-Sunny's #936 probes (13 Nov 2026): a capitalised word after a place ("Today", "Again", "NCNS", "Nov 1", "Sat", a
 * first name) does not make it a longer name; QA's ruling: only the block-list continues a place name. Run with the flag.
 */
const MUST_READ_CAPITALISED: readonly { key: string; turn: string; place: RegExp; account: RegExp }[] = [
  { key: "kearney-today-capitalised", turn: "create a ca for marnie holloway, She was late at Kearney Today", place: /\bkearney\b/i, account: /\bShe was late Today\b/ },
  { key: "omaha-again-capitalised", turn: "create a ca for marnie holloway, She was late at Omaha Again", place: /\bomaha\b/i, account: /\bShe was late Again\b/ },
  { key: "omaha-last-week-capitalised", turn: "create a ca for marnie holloway, She was late at Omaha Last week", place: /\bomaha\b/i, account: /\bLast week\b/ },
  { key: "kearney-ncns-capitalised", turn: "create a ca for marnie holloway, she was late at Kearney NCNS", place: /\bkearney\b/i, account: /\bNCNS\b/ },
  { key: "kearney-nov-1", turn: "create a ca for marnie holloway, she was late at Kearney Nov 1", place: /\bkearney\b/i, account: /\bNov 1\b/ },
  { key: "kearney-sat", turn: "create a ca for marnie holloway, she was late at Kearney Sat", place: /\bkearney\b/i, account: /\bSat\b/ },
  { key: "omaha-tues", turn: "create a ca for marnie holloway, she was late at Omaha Tues", place: /\bomaha\b/i, account: /\bTues\b/ },
  { key: "kearney-first-name", turn: "create a ca for marnie holloway, she was late at kearney Marnie skipped the beds too", place: /\bkearney\b/i, account: /skipped the beds/i },
];

export const NOV13_OBSERVATION_PLACE_MUST_READ_CAPITALISED_CASES: ReplayCase[] = MUST_READ_CAPITALISED.map((wording) => ({
  id: `nov13-observation-place-must-read-${wording.key}`,
  title: `Admin: "${wording.turn}" — the place is still read and leaves the Observation`,
  report: "Gate-Sunny's #936 probes (13 Nov 2026); QA: block-list only, a capitalised word is not a longer name; invented person",
  status: "fixed",
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    const { reply, said } = await observationOf(t, wording.turn);
    expect(said, `the place was not read:\n${reply}`).not.toMatch(wording.place);
    expect(said, `the account was lost:\n${reply}`).toMatch(wording.account);
  },
}));

/*
 * QA, blocking (Gate-Sunny on aeb6aa20, 13 Nov 2026): the "… of" exception reached every block-list word, and "she was
 * late because she was at lincoln high of all places" became "… because she was high of all places". Only a compass
 * word before "of" is a direction; any other block-list word keeps the whole phrase. Must-keep guards, with the flag
 * and without.
 */
// `open`: main cuts the place out (the bug this flag fixes); the flag keeps the phrase. Without it: holds on main too.
const MUST_KEEP_OF: readonly { key: string; turn: string; kept: RegExp; never: RegExp; open?: true }[] = [
  { key: "lincoln-high-of-all-places", turn: "create a ca for marnie holloway, she was late because she was at lincoln high of all places", kept: /lincoln high of all places/i, never: /\bshe was high\b/i, open: true },
  { key: "kearney-high-of-all-places", turn: "create a ca for marnie holloway, she was late because she was at kearney high of all places", kept: /kearney high of all places/i, never: /\bshe was high\b/i, open: true },
  { key: "kansas-state-of-all-things", turn: "create a ca for marnie holloway, she was late because of a game at kansas state of all things", kept: /kansas state of all things/i, never: /\bgame state\b/i },
  { key: "kearney-mall-of-all-places", turn: "create a ca for marnie holloway, she was late because she was at the kearney mall of all places", kept: /kearney mall of all places/i, never: /\bthe mall of all places\b/i, open: true },
];

export const NOV13_OBSERVATION_PLACE_MUST_KEEP_OF_CASES: ReplayCase[] = MUST_KEEP_OF.map((wording) => ({
  id: `nov13-observation-place-must-keep-${wording.key}`,
  title: `Admin: "${wording.turn}" — the longer name is kept whole`,
  report: "QA, blocking (Gate-Sunny on #936 aeb6aa20, 13 Nov 2026): only a compass word before \"of\" is a direction; invented person",
  // Changed on purpose (14 Nov 2026): fixed in production by PLACE_STRIP_WHOLE_PHRASE_ONLY_ENABLED, QA round 38h. The
  // `open` ones were OPEN; every wording now holds in production.
  status: "fixed",
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    const { reply, said } = await observationOf(t, wording.turn);
    expect(said, `the longer name was cut:\n${reply}`).toMatch(wording.kept);
    expect(said, `the account's meaning changed:\n${reply}`).not.toMatch(wording.never);
  },
}));
