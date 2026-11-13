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

/*
 * QA's Sunny 38d live check, (a): the same turn gave the card "Job title: Front Desk". The trace (conv_mwfcjmwx28iq0v1,
 * slots.title "front desk") shows the slot model read the work area as the title, and it was kept because the words were
 * in the turn; the tester's person was not on the roster. With WORK_AREA_NOT_A_TITLE a place in the salon is never the
 * job title. The model's reading is scripted as the trace shows it; the person is invented and not on the directory.
 */
const WORK_AREA_FLAG = "WORK_AREA_NOT_A_TITLE_ENABLED";
const OFF_ROSTER = "kira dunmore";

const WORK_AREAS: readonly { key: string; turn: string; area: string; onMain?: "fixed" }[] = [
  { key: "front-desk", turn: `create a ca for ${OFF_ROSTER} at the front desk, she was rude to a guest`, area: "front desk" },
  { key: "register", turn: `create a ca for ${OFF_ROSTER} at the register, she was rude to a guest`, area: "register" },
  // Guard: main already keeps "bed 4" off the card (the title reader does not take it as stated); it must stay so.
  { key: "bed-4", turn: `create a ca for ${OFF_ROSTER} in bed 4, she left it dirty`, area: "bed 4", onMain: "fixed" },
];

export const NOV13_WORK_AREA_NOT_A_TITLE_CASES: ReplayCase[] = WORK_AREAS.map((wording) => ({
  id: `nov13-work-area-not-a-title-${wording.key}`,
  title: `Admin, a person not on the roster: "${wording.turn}" — "${wording.area}" is never the Job title`,
  report: `${REPORT}; item (a), trace slots.title "front desk"`,
  status: wording.onMain ?? { open: `the card's Job title is "${wording.area}"` },
  fixFlags: [WORK_AREA_FLAG],
  async run(t: ReplayContext) {
    vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
    t.directory([...STAFF]);
    t.as("admin", EVERY_SALON);
    t.slotsRead({ employee: OFF_ROSTER, title: wording.area, formType: "Corrective Action Form", formTurn: true }, OFF_ROSTER);
    const thread = t.thread();
    const reply = (await thread.say(wording.turn)).content;
    const role = (thread.proposal as { employeeRole?: string | null } | null)?.employeeRole ?? "";
    expect(role.toLowerCase(), `the work area became the job title:\n${reply}`).not.toBe(wording.area);
    expect(reply, `the card shows the work area as the job title:\n${reply}`).not.toMatch(new RegExp(`\\*\\*Job title:\\*\\*\\s*${wording.area}`, "i"));
  },
}));
