import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * THE OBSERVATION NEVER STARTS WITH THE EMPLOYEE'S NAME (QA's Sunny 38d live check, 13 Nov 2026)
 * ============================================================================
 *
 * QA, live: "create a ca for <A> at the front desk, she was rude to a guest" gave the Observation of Offense "<A> at the
 * front desk, she was rude to a guest" (on main 7dc8f51c, with SHARED_CITY_ASKS_SALON off and on). QA: keep "at the front
 * desk", drop the leading name. Tester's wording; the person is invented.
 */
const FLAG = "OBSERVATION_NO_LEADING_NAME_ENABLED";
const REPORT = "QA's Sunny 38d live check (13 Nov 2026), tester's wording, invented person";
const EVERY_SALON = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

async function observationOf(t: ReplayContext, turn: string): Promise<{ reply: string; said: string }> {
  vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("admin", EVERY_SALON);
  const reply = (await t.thread().say(turn)).content;
  return { reply, said: /\*\*Observation of Offense:\*\*\s*([^\n]*)/i.exec(reply)?.[1]?.trim() ?? "" };
}

const WORDINGS: readonly { key: string; turn: string; kept: string }[] = [
  { key: "front-desk", turn: "create a ca for marnie holloway at the front desk, she was rude to a guest", kept: "at the front desk, she was rude to a guest" },
  { key: "back-room", turn: "create a ca for marnie holloway in the back room, she was on her phone", kept: "in the back room, she was on her phone" },
];

export const NOV13_OBSERVATION_NO_LEADING_NAME_CASES: ReplayCase[] = WORDINGS.map((wording) => ({
  id: `nov13-observation-no-leading-name-${wording.key}`,
  title: `Admin: "${wording.turn}" — the Observation is "${wording.kept}", without the employee's name`,
  report: REPORT,
  status: { open: `the Observation starts with the employee's name ("marnie holloway ${wording.kept}")` },
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    const { reply, said } = await observationOf(t, wording.turn);
    expect(said, `the employee's name leads the Observation:\n${reply}`).not.toMatch(/^marnie\b|holloway/i);
    expect(said, `the account lost words:\n${reply}`).toContain(wording.kept);
  },
}));
