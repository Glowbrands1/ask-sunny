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
  // Changed on purpose (14 Nov 2026): fixed in production by OBSERVATION_NO_LEADING_NAME_ENABLED, QA round 38j. Was OPEN.
  status: "fixed",
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

const WORK_AREAS: readonly { key: string; turn: string; area: string }[] = [
  { key: "front-desk", turn: `create a ca for ${OFF_ROSTER} at the front desk, she was rude to a guest`, area: "front desk" },
  { key: "register", turn: `create a ca for ${OFF_ROSTER} at the register, she was rude to a guest`, area: "register" },
  // On main the card shows "Job title: Bed" (the whole-pack diff, 13 Nov 2026): the work area cut to its first word.
  { key: "bed-4", turn: `create a ca for ${OFF_ROSTER} in bed 4, she left it dirty`, area: "bed 4" },
];

export const NOV13_WORK_AREA_NOT_A_TITLE_CASES: ReplayCase[] = WORK_AREAS.map((wording) => ({
  id: `nov13-work-area-not-a-title-${wording.key}`,
  title: `Admin, a person not on the roster: "${wording.turn}" — "${wording.area}" is never the Job title`,
  report: `${REPORT}; item (a), trace slots.title "front desk"`,
  // Changed on purpose (14 Nov 2026): fixed in production by WORK_AREA_NOT_A_TITLE_ENABLED, QA round 38j. Was OPEN.
  status: "fixed",
  fixFlags: [WORK_AREA_FLAG],
  async run(t: ReplayContext) {
    vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
    t.directory([...STAFF]);
    t.as("admin", EVERY_SALON);
    t.slotsRead({ employee: OFF_ROSTER, title: wording.area, formType: "Corrective Action Form", formTurn: true }, OFF_ROSTER);
    const thread = t.thread();
    const reply = (await thread.say(wording.turn)).content;
    const role = (thread.proposal as { employeeRole?: string | null } | null)?.employeeRole ?? "";
    const head = wording.area.split(" ")[0]!;
    expect(role.toLowerCase(), `the work area became the job title:\n${reply}`).not.toMatch(new RegExp(`^${head}\\b`, "i"));
    expect(reply, `the card shows the work area as the job title:\n${reply}`).not.toMatch(new RegExp(`\\*\\*Job title:\\*\\*\\s*${head}\\b`, "i"));
  },
}));

/*
 * Gate-Sunny's #939 probes; QA's ruling (13 Nov 2026): the name is dropped only when the place phrase is a lead that ends
 * at a comma or full stop, or another subject (she/he/they) follows. Where the employee is the subject of the clause's
 * verb, the name stays: "<A> at the front desk was rude to a guest" never becomes "at the front desk was rude …".
 */
const NAME_IS_SUBJECT: readonly { key: string; turn: string; kept: string }[] = [
  {
    key: "front-desk-was-rude",
    turn: "create a ca for marnie holloway, marnie holloway at the front desk was rude to a guest",
    kept: "marnie holloway at the front desk was rude to a guest",
  },
  {
    key: "second-sentence",
    turn: "create a ca for marnie holloway. she was late. marnie holloway at the front desk was rude",
    kept: "marnie holloway at the front desk was rude",
  },
  // Gate-Sunny's probes on c3aec37c: a verb not on a list still makes the employee the subject.
  { key: "desk-ignored", turn: "create a ca for marnie holloway, marnie holloway at the desk ignored guests", kept: "marnie holloway at the desk ignored guests" },
  { key: "close-left-early", turn: "create a ca for marnie holloway, marnie holloway at close left early", kept: "marnie holloway at close left early" },
  { key: "front-desk-yelled", turn: "create a ca for marnie holloway, marnie holloway at the front desk yelled", kept: "marnie holloway at the front desk yelled" },
  { key: "back-room-slept", turn: "create a ca for marnie holloway. marnie holloway in the back room slept.", kept: "marnie holloway in the back room slept" },
];

export const NOV13_OBSERVATION_NAME_IS_SUBJECT_CASES: ReplayCase[] = NAME_IS_SUBJECT.map((wording) => ({
  id: `nov13-observation-name-is-subject-${wording.key}`,
  title: `Admin: "${wording.turn}" — the employee is the subject, so the name stays`,
  report: `${REPORT}; Gate-Sunny's #939 probes, QA's ruling`,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    const { reply, said } = await observationOf(t, wording.turn);
    expect(said, `the clause lost its subject:\n${reply}`).toContain(wording.kept);
  },
}));

// Gate-Sunny's minor note: "on the floor" leads like "at"/"in".
export const NOV13_OBSERVATION_NO_LEADING_NAME_ON_CASES: ReplayCase[] = [
  {
    id: "nov13-observation-no-leading-name-on-the-floor",
    title: `Admin: "create a ca for marnie holloway on the floor, she was rude to a guest" — "on the floor, she was rude to a guest"`,
    report: `${REPORT}; Gate-Sunny's #939 probe`,
    // Changed on purpose (14 Nov 2026): fixed in production by OBSERVATION_NO_LEADING_NAME_ENABLED, QA round 38j. Was OPEN.
    status: "fixed",
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, said } = await observationOf(t, "create a ca for marnie holloway on the floor, she was rude to a guest");
      expect(said, `the employee's name leads the Observation:\n${reply}`).not.toMatch(/^marnie\b|holloway/i);
      expect(said, `the account lost words:\n${reply}`).toContain("on the floor, she was rude to a guest");
    },
  },
];

// Gate-Sunny's probe on c3aec37c: "bed #4" is a work area too (a regression from e876d12f, where "#" was not read).
export const NOV13_OBSERVATION_NO_LEADING_NAME_BED_HASH_CASES: ReplayCase[] = [
  {
    id: "nov13-observation-no-leading-name-bed-hash-4",
    title: `Admin: "create a ca for marnie holloway in bed #4, she left it dirty" — "in bed #4, she left it dirty"`,
    report: `${REPORT}; Gate-Sunny's #939 probe`,
    // Changed on purpose (14 Nov 2026): fixed in production by OBSERVATION_NO_LEADING_NAME_ENABLED, QA round 38j. Was OPEN.
    status: "fixed",
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const { reply, said } = await observationOf(t, "create a ca for marnie holloway in bed #4, she left it dirty");
      expect(said, `the employee's name leads the Observation:\n${reply}`).not.toMatch(/^marnie\b|holloway/i);
      expect(said, `the account lost words:\n${reply}`).toContain("in bed #4, she left it dirty");
    },
  },
];
