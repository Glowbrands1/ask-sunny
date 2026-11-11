import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { at } from "./nov4-live-regressions-scenarios";

/**
 * NEAR_MISS_TURNED_DOWN_EVERYWHERE (QA, 10 Nov 2026). nov7-near-miss-details-{corvina,delphine}-turned-down hold with the
 * name set and NEAR_MISS_QUESTION_RULES: after "Is this for **<roster name>**? Tell me if that should change.", "no,
 * verbal warning …" leaves the card with no employee and asks who. But the same reply still named the turned-down
 * person in its Action Plan ("Management will review … with Corvina.") and opened its Observation with the "no," that
 * turned the name down. The same chats as nov7-near-miss-details (invented people).
 */
const ON = [
  "FORM_NAME_FROM_ROSTER_ENABLED",
  "ROSTER_NEAR_MISS_ENABLED",
  "ROSTER_NAME_IN_CANDIDATE_ENABLED",
  "ROSTER_COMPOUND_SURNAME_ENABLED",
  "ROSTER_NOT_FOUND_ANY_PHRASING_ENABLED",
  "OFF_ROSTER_CONFIRM_ENABLED",
  "NEAR_MISS_DETAILS_ACCEPT_ENABLED",
  "NEAR_MISS_QUESTION_RULES_ENABLED",
  "NEAR_MISS_TURNED_DOWN_EVERYWHERE_ENABLED",
];
const CORVINA = at("nm-corvina", "Corvina", "Vellacott");
const DELPHINE = at("nm-delphine", "Delphine", "Marlowe Ostrander");
const ASKED = /Is this for \*\*[^*]+\*\*\? Tell me if that should change\./;

const CHATS = [
  {
    id: "corvina",
    first: "Corvina",
    turns: ["i have an employee, Corvina Ashdown Vellacot that needs a corrective action form with a customer complaint", "verbal warning, no payroll deduct, part-time tanning consultant,"],
  },
  {
    id: "delphine",
    first: "Delphine",
    turns: ["create a ca form for Delphine Marlwoe Ostrander", "verbal warning The date she complained was Oct 31st . The customer said she was giving her an attitude."],
  },
] as const;

export const NOV10_NEAR_MISS_TURNED_DOWN_PLAN_CASES: ReplayCase[] = CHATS.map(({ id, first, turns }) => ({
  id: `nov10-near-miss-turned-down-plan-${id}`,
  title: `"no, ${turns[1].slice(0, 30)}…" after "Is this for **…**?": the Action Plan never names ${first}, and the account never opens with "no,"`,
  report: "QA, 10 Nov 2026: the turned-down near-miss (nov7-near-miss-details-*-turned-down) left in the reply's Action Plan and Observation",
  status: { open: "the Action Plan names the turned-down first name; the Observation opens with \"no,\"" },
  fixFlags: ON,
  async run(t) {
    vi.setSystemTime(new Date("2026-11-04T15:30:00Z"));
    t.directory([...STAFF, CORVINA, DELPHINE]);
    t.as("salon_director", KEARNEY);
    const thread = t.thread();
    const asked = await thread.say(turns[0]);
    expect(asked.content, "the near-miss question was not asked").toMatch(ASKED);
    const reply = await thread.say(`no, ${turns[1]}`);
    expect(thread.proposal?.employeeName ?? null, reply.content).toBeNull();
    const plan = reply.content.split("\n").find((line) => line.startsWith("**Action Plan:**")) ?? "";
    expect(plan, `the Action Plan names the turned-down person:\n${reply.content}`).not.toMatch(new RegExp(`\\b${first}\\b`));
    expect(reply.content, `the account opens with the "no," that turned the name down:\n${reply.content}`).not.toMatch(
      /^\*\*(?:Observation of Offense|Issue|What happened):\*\*\s*no\b/im,
    );
  },
}));

/*
 * QA's guard (11 Nov 2026): only the "no," that turns the asked name down leaves the account. "no call no show" is an
 * account, after the near-miss question or on a fresh request, and is never touched.
 */
const NO_CALL = "no call no show on 11/3, verbal warning";
export const NOV10_NEAR_MISS_NO_CALL_NO_SHOW_CASES: ReplayCase[] = [
  {
    id: "nov10-near-miss-turned-down-plan-no-call-no-show-after-question",
    title: `after "Is this for **Corvina Vellacott**?", "${NO_CALL}": the account keeps "no call no show"`,
    report: "QA's guard on NEAR_MISS_TURNED_DOWN_EVERYWHERE (11 Nov 2026)",
    status: { open: "after the near-miss question, \"no call no show …\" is read as turning the name down" },
    fixFlags: ON,
    async run(t) {
      vi.setSystemTime(new Date("2026-11-04T15:30:00Z"));
      t.directory([...STAFF, CORVINA, DELPHINE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(CHATS[0].turns[0]);
      const reply = await thread.say(NO_CALL);
      const account = reply.content.split("\n").find((line) => /^\*\*(?:Observation of Offense|Issue|What happened):\*\*/.test(line));
      if (account) expect(account, reply.content).toMatch(/no call no show/i);
      // QA (11 Nov 2026): "no call no show …" is an account, not a "no": the asked name is kept.
      expect(thread.proposal?.employeeName ?? null, `the asked name was taken off:\n${reply.content}`).toBe("Corvina Vellacott");
      expect(reply.content, reply.content).not.toMatch(/^\*\*(?:Observation of Offense|Issue|What happened):\*\*\s*call no show/im);
    },
  },
  {
    id: "nov10-near-miss-turned-down-plan-no-call-no-show-fresh",
    title: `"create a ca for Corvina Vellacott, ${NO_CALL}": the account keeps "no call no show"`,
    report: "QA's guard on NEAR_MISS_TURNED_DOWN_EVERYWHERE (11 Nov 2026)",
    status: "fixed",
    fixFlags: ON,
    async run(t) {
      vi.setSystemTime(new Date("2026-11-04T15:30:00Z"));
      t.directory([...STAFF, CORVINA, DELPHINE]);
      t.as("salon_director", KEARNEY);
      const reply = await t.thread().say(`create a ca for Corvina Vellacott, ${NO_CALL}`);
      expect(reply.content, reply.content).not.toMatch(/^\*\*(?:Observation of Offense|Issue|What happened):\*\*\s*call no show/im);
      expect(reply.content, reply.content).toMatch(/no call no show/i);
    },
  },
];
