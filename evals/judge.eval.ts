import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { ChatFormProposal } from "@/types";

import { compareToBaseline, judgeCase, modeFlags, readEvalFlags, rosterTables, speedVerdict, withoutTime, type EvalCase, type EvalResult } from "./replay-harness";

/** The eval's own judge, so a pass in the replay table means what it says. */

const CASE: EvalCase = {
  id: "t1",
  turns: ["create a CA for Test Employee at Manhattan for being late to open on 10-20-26"],
  criteria: { employee: "Test Employee", salon: "loc-0462", date: "2026-10-20", policy: "Late Opening p.15", noBlockingQuestion: true, noLeakedInternalText: true },
};

const card = (overrides: Partial<ChatFormProposal>) =>
  ({ employeeName: "Test Employee", locationId: "loc-0462", formDate: "2026-10-20", status: "ready", issue: null, ...overrides }) as ChatFormProposal;

const result = (id: string, pass: boolean, ms = 10): EvalResult => ({
  id,
  pass,
  misses: pass ? [] : ["employee"],
  card: { employee: null, salon: null, date: null, status: null },
  ms,
});

describe("the replay judge", () => {
  it("passes a card that meets every criterion", () => {
    const judged = judgeCase({ item: CASE, proposal: card({}), lastReply: "Cited: Late Opening, p. 15.", error: null, ms: 5 });
    expect(judged.misses).toEqual([]);
    expect(judged.pass).toBe(true);
  });

  it("names every criterion that missed", () => {
    const judged = judgeCase({
      item: CASE,
      proposal: card({ employeeName: "Test", locationId: null, formDate: "2026-10-21" }),
      lastReply: "Did you mean Test Employee? Late Opening p.16",
      error: null,
      ms: 5,
    });
    expect(judged.misses).toEqual(["employee", "salon", "date", "policy", "blocking question"]);
  });

  it("does not judge a null criterion or a false check", () => {
    const loose: EvalCase = { ...CASE, criteria: { employee: null, salon: null, date: null, policy: null, noBlockingQuestion: false, noLeakedInternalText: false } };
    expect(judgeCase({ item: loose, proposal: null, lastReply: "Which employee? does not appear on the employee roster", error: null, ms: 1 }).pass).toBe(true);
  });

  it("fails a case whose turn errored", () => {
    expect(judgeCase({ item: CASE, proposal: card({}), lastReply: "Late Opening p.15", error: "turn 1: HTTP 500", ms: 1 }).misses).toEqual(["error: turn 1: HTTP 500"]);
  });
});

describe("the baseline and speed gates", () => {
  it("flags off must equal the baseline exactly, in both directions", () => {
    const baseline = [result("a", true), result("b", false)].map(withoutTime);
    expect(compareToBaseline(baseline, [result("a", true), result("b", false)], []).offChanged).toEqual([]);
    expect(compareToBaseline(baseline, [result("a", true), result("b", true)], []).offChanged).toHaveLength(1);
    expect(compareToBaseline(baseline, [result("a", true)], []).offChanged).toEqual(["b: in the baseline, not replayed"]);
  });

  it("flags on may not break a case that passes with them off", () => {
    const off = [result("a", true), result("b", false)];
    expect(compareToBaseline([], off, [result("a", false), result("b", false)]).onBroke).toEqual(["a: employee"]);
    expect(compareToBaseline([], off, [result("a", true), result("b", true)]).onBroke).toEqual([]);
  });

  it("flags on may be at most 25% slower, plus the noise floor", () => {
    expect(speedVerdict([result("a", true, 1000)], [result("a", true, 1350)]).ok).toBe(true);
    expect(speedVerdict([result("a", true, 1000)], [result("a", true, 1351)]).ok).toBe(false);
  });
});

describe("flags and roster", () => {
  it("production flags are on in both columns, the step's flag only in ON", () => {
    const flags = readEvalFlags({ production: ["EVAL_PROD_ENABLED"], on: ["EVAL_STEP_ENABLED"] });
    process.env.EVAL_STEP_ENABLED = "true";
    const restoreOff = modeFlags(flags, "off");
    expect([process.env.EVAL_PROD_ENABLED, process.env.EVAL_STEP_ENABLED]).toEqual(["true", undefined]);
    restoreOff();
    const restoreOn = modeFlags(flags, "on");
    expect([process.env.EVAL_PROD_ENABLED, process.env.EVAL_STEP_ENABLED]).toEqual(["true", "true"]);
    restoreOn();
    expect([process.env.EVAL_PROD_ENABLED, process.env.EVAL_STEP_ENABLED]).toEqual([undefined, "true"]);
    delete process.env.EVAL_STEP_ENABLED;
  });

  it("refuses a flag that is both production and the step's", () => {
    expect(() => readEvalFlags({ production: ["A_ENABLED"], on: ["A_ENABLED"] })).toThrow(/both/);
  });

  it("builds the four directory tables the roster reads", () => {
    const tables = rosterTables([{ id: "p1", firstName: "Ada", lastName: "Quill", locationIds: ["loc-0462"] }]);
    expect(tables.employee_access_directory).toHaveLength(1);
    expect(tables.employee_location_affiliations).toEqual([{ employee_id: "p1", woven_location_id: "woven-loc-0462", active: true }]);
    expect(tables.woven_location_map).toEqual([{ woven_location_id: "woven-loc-0462", salon_id: "salon-loc-0462", status: "mapped" }]);
    expect(tables.salons).toEqual([{ id: "salon-loc-0462", salon_number: "0462" }]);
  });
});

describe("the eval's cases", () => {
  it("keep the priority replay fixture's turns and criteria word for word", () => {
    const fixture = JSON.parse(readFileSync("src/lib/ai/__fixtures__/replay_set.json", "utf8")) as EvalCase[];
    const cases = JSON.parse(readFileSync("evals/replay_set.json", "utf8")) as EvalCase[];
    /*
     * Changed on purpose (QA, 10 Nov 2026, the roster-name set #741), after Pau's rulings of 5 Nov 2026: s25's eval
     * criteria take the roster's spelling, "Daisley Veklo"; b9, n1 ("Test Employee": a name with "employee" in it) and n3
     * ("TT": bare initials) expect no employee on the card and "Who is this form for?". The priority replay fixture keeps
     * the old criteria: that test measures production's flags. The turns are still pinned word for word.
     */
    const ASKS_WHO = { employee: "", noBlockingQuestion: false, replyIncludes: ["Who is this form for?"] };
    const RULED: Readonly<Record<string, Partial<EvalCase["criteria"]>>> = { s25: { employee: "Daisley Veklo" }, b9: ASKS_WHO, n1: ASKS_WHO, n3: ASKS_WHO };
    for (const item of fixture) {
      const copy = cases.find((other) => other.id === item.id);
      expect(copy, `${item.id} is not in evals/replay_set.json`).toBeDefined();
      expect({ turns: copy!.turns, criteria: copy!.criteria }, item.id).toEqual({ turns: item.turns, criteria: { ...item.criteria, ...RULED[item.id] } });
    }
  });
});
