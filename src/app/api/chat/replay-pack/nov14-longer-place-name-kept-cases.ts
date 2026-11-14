import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * LONGER_PLACE_NAME_KEPT — A CITY IS NEVER CUT OUT OF A LONGER PLACE NAME (Gate-Sunny's #936 follow-ups, QA 14 Nov 2026)
 * ============================================================================
 *
 * Gate-Sunny's probes on #936 (OFF = ON, non-blocking) and QA's ruling: the Observation of Offense took the city out of a
 * longer place name, or a place out of the sentence it was the point of. On Sunny main fd01dae8 (production's flags,
 * PLACE_STRIP_WHOLE_PHRASE_ONLY on), as an Admin:
 *   "… she was at lincoln street fair instead of her shift"      → "she was street fair instead of her shift"
 *   "… because she was at the lincoln zoo"                       → "… because she was zoo"
 *   "… because she was at the grand island fair"                 → "… because she was fair"
 *   "… because she was at lincoln southeast high"                → "… because she was southeast high"
 *   "… she was at omaha of all places"                           → "… she was of all places"
 *   "… she was at omaha and left early" / "at lincoln and was late" → "she was and left early" / "she was and was late"
 * With LONGER_PLACE_NAME_KEPT_ENABLED every word is kept. A place that is only where it happened ("she was late at omaha
 * today") still leaves the account. Invented person.
 */
const FLAG = "LONGER_PLACE_NAME_KEPT_ENABLED";
const REPORT = "Gate-Sunny's #936 probes and QA's ruling (14 Nov 2026); invented person";

async function observationOf(t: ReplayContext, turn: string): Promise<{ said: string; reply: string }> {
  vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("admin", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
  const reply = (await t.thread().say(turn)).content;
  return { reply, said: /\*\*Observation of Offense:\*\*\s*([^\n]*)/.exec(reply)?.[1]?.trim() ?? "" };
}

const OPEN: readonly { key: string; turn: string; kept: RegExp }[] = [
  { key: "lincoln-street-fair", turn: "create a ca for marnie holloway, she was at lincoln street fair instead of her shift", kept: /\bat lincoln street fair instead of her shift\b/i },
  { key: "lincoln-zoo", turn: "create a ca for marnie holloway, she was late because she was at the lincoln zoo", kept: /\bat the lincoln zoo\b/i },
  { key: "grand-island-fair", turn: "create a ca for marnie holloway, she was late because she was at the grand island fair", kept: /\bat the grand island fair\b/i },
  { key: "lincoln-southeast-high", turn: "create a ca for marnie holloway, she was late because she was at lincoln southeast high", kept: /\bat lincoln southeast high\b/i },
  { key: "omaha-of-all-places", turn: "create a ca for marnie holloway, she was late, she was at omaha of all places", kept: /\bshe was at omaha of all places\b/i },
  { key: "omaha-and-left-early", turn: "create a ca for marnie holloway, she was at omaha and left early", kept: /\bshe was at omaha and left early\b/i },
  { key: "lincoln-and-was-late", turn: "create a ca for marnie holloway, she was at lincoln and was late", kept: /\bshe was at lincoln and was late\b/i },
];

export const NOV14_LONGER_PLACE_NAME_KEPT_CASES: ReplayCase[] = OPEN.map((wording) => ({
  id: `nov14-longer-place-name-kept-${wording.key}`,
  title: `Admin: "${wording.turn}" — the Observation keeps every word of the place`,
  report: REPORT,
  status: { open: "the city is cut out of the longer place name, or the place out of its sentence" },
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    const { said, reply } = await observationOf(t, wording.turn);
    expect(said, `the Observation lost the place:\n${reply}`).toMatch(wording.kept);
  },
}));

/** Guards, flag off and on: a place that is only where it happened still leaves the account. */
const STRIPPED: readonly { key: string; turn: string; said: RegExp }[] = [
  { key: "late-at-omaha-today", turn: "create a ca for marnie holloway, she was late at omaha today", said: /^she was late today\b/i },
  { key: "late-at-lincoln", turn: "create a ca for marnie holloway, she was late at lincoln on 11/1/26", said: /^she was late on 11\/1\/26\b/i },
];

export const NOV14_LONGER_PLACE_NAME_KEPT_GUARDS: ReplayCase[] = STRIPPED.map((wording) => ({
  id: `nov14-longer-place-name-kept-guard-${wording.key}`,
  title: `Admin: "${wording.turn}" — the place still leaves the account`,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    const { said, reply } = await observationOf(t, wording.turn);
    expect(said, `the Observation:\n${reply}`).toMatch(wording.said);
  },
}));
