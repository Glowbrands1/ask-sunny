import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { detectTemplateIntent } from "@/lib/forms/template-intent";

import { expandTerseRequest, withTerseSlots } from "./terse-slots";
import type { AskRequest } from "./types";

/**
 * Ask Sunny conv_mvoffldz24z2t0u and QA persona batches 11-12 (25 Oct 2026):
 * the managers' terse turns exactly, with invented names (Quenby Arlott,
 * Tamsin Vedder). Each is also run all-caps, and as typed in lowercase.
 */
const FLAG = "TERSE_SLOT_READ_ENABLED";
const saved = process.env[FLAG];
const NO_NAME = "TERSE_INCIDENT_NO_NAME_ENABLED";
const savedNoName = process.env[NO_NAME];
// The strings below are TERSE_INCIDENT_NO_NAME off, whatever the run sets; its flag-on twins are at the end.
beforeEach(() => {
  delete process.env[NO_NAME];
});
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
  if (savedNoName === undefined) delete process.env[NO_NAME];
  else process.env[NO_NAME] = savedNoName;
});

const TODAY = "2026-10-25";

function request(question: string, history: AskRequest["history"] = []): AskRequest {
  return { question, history, context: { todayIso: TODAY } } as unknown as AskRequest;
}

const CASES: readonly [string, string][] = [
  [
    "ca quenby arlott opened late 15 min 9-20 verbal 25 deduct",
    "Create a corrective action form for quenby arlott. On 9-20-26 quenby arlott opened late 15 min. This is a verbal warning. Payroll deduct applies and $25 will be deducted.",
  ],
  [
    "ca for quenby arlott not opening salon on time and no call no show",
    "Create a corrective action form for quenby arlott. quenby arlott not opening salon on time and no call no show.",
  ],
  ["coach quenby arlott woven acks 10-16", "Create a coaching form for quenby arlott. On 10-16-26 quenby arlott woven acks."],
  ["coach tamsin vedder", "Create a coaching form for tamsin vedder."],
  [
    "coaching quenby arlott tanned on clock 9-28-26 tc ks manhattan",
    "Create a coaching form for quenby arlott at ks manhattan, Tanning Consultant. On 9-28-26 quenby arlott tanned on clock.",
  ],
  [
    "exit quenby arlott tc ks manhattan nc/ns last day 9/20 called 9/27 no answer",
    "Create an exit form for quenby arlott at ks manhattan, Tanning Consultant. nc/ns last day 9/20 called 9/27 no answer.",
  ],
  [
    "verbal ca quenby arlott ks manhattan dress code 10/11",
    "Create a corrective action form for quenby arlott at ks manhattan. On 10/11/26 quenby arlott dress code. This is a verbal warning.",
  ],
];

describe("withTerseSlots", () => {
  it("passes the request on as it is with the flag off", () => {
    delete process.env[FLAG];
    const input = request(CASES[0]![0]);
    expect(withTerseSlots(input)).toBe(input);
  });

  it("writes the terse turn, and an earlier terse turn, out as the long form", () => {
    process.env[FLAG] = "on";
    const out = withTerseSlots(request("verbal", [{ id: "m0", role: "user", content: CASES[0]![0], createdAt: "" } as never]));
    expect(out.history[0]!.content).toBe(CASES[0]![1]);
    expect(out.question).toBe("verbal");
  });
});

describe("expandTerseRequest", () => {
  it.each(CASES)("writes out %s", (terse, long) => {
    expect(expandTerseRequest(terse, TODAY)).toBe(long);
  });

  it.each(CASES)("reads %s the same in capitals", (terse) => {
    const upper = expandTerseRequest(terse.toUpperCase(), TODAY);
    expect(upper).not.toBe(terse.toUpperCase());
    const name = terse.includes("tamsin") ? "tamsin vedder" : "quenby arlott";
    expect(upper.toLowerCase()).toContain(`form for ${name}`);
  });

  it("each written-out request names its form for the readers", () => {
    expect(detectTemplateIntent(CASES[0]![1])).toEqual({ kind: "explicit", templateKey: "dpoa" });
    expect(detectTemplateIntent(CASES[2]![1])).toEqual({ kind: "explicit", templateKey: "coaching" });
    // The written-out request opens with "Create", which is never read as reopening a form on file.
    expect(CASES[1]![1].startsWith("Create a corrective action form for")).toBe(true);
  });

  it("leaves questions, topics, sentences and other uses of the words as typed", () => {
    for (const text of [
      "ca",
      "show me the ca for quenby arlott",
      "Sacramento, CA",
      "what is the exit process?",
      "exit process",
      "exit interview tips",
      "coaching tips for new hires",
      "ca for quenby arlott. she was late on 10-2.",
      "create a ca for quenby arlott",
      "Quenby was late",
    ]) {
      expect(expandTerseRequest(text, TODAY)).toBe(text);
    }
  });
});

/*
 * CHANGED ON PURPOSE, TERSE_INCIDENT_NO_NAME_ENABLED on (QA, 26 Oct 2026): the
 * incident sentence no longer repeats the employee's name ("On 9-20-26,
 * opened late 15 min"); the name stays in the request sentence, and the date,
 * level and deduction are unchanged. Flag off keeps the strings above.
 */
const CASES_NO_NAME: readonly [string, string][] = [
  [
    "ca quenby arlott opened late 15 min 9-20 verbal 25 deduct",
    "Create a corrective action form for quenby arlott. On 9-20-26, opened late 15 min. This is a verbal warning. Payroll deduct applies and $25 will be deducted.",
  ],
  [
    "ca for quenby arlott not opening salon on time and no call no show",
    "Create a corrective action form for quenby arlott. Not opening salon on time and no call no show.",
  ],
  [
    "coach quenby arlott woven acks 10-16",
    "Create a coaching form for quenby arlott. On 10-16-26, woven acks.",
  ],
  [
    "coach tamsin vedder",
    "Create a coaching form for tamsin vedder.",
  ],
  [
    "coaching quenby arlott tanned on clock 9-28-26 tc ks manhattan",
    "Create a coaching form for quenby arlott at ks manhattan, Tanning Consultant. On 9-28-26, tanned on clock.",
  ],
  [
    "exit quenby arlott tc ks manhattan nc/ns last day 9/20 called 9/27 no answer",
    "Create an exit form for quenby arlott at ks manhattan, Tanning Consultant. nc/ns last day 9/20 called 9/27 no answer.",
  ],
  [
    "verbal ca quenby arlott ks manhattan dress code 10/11",
    "Create a corrective action form for quenby arlott at ks manhattan. On 10/11/26, dress code. This is a verbal warning.",
  ],
];

describe("expandTerseRequest with TERSE_INCIDENT_NO_NAME_ENABLED on", () => {
  it.each(CASES_NO_NAME)("writes out %s", (terse, long) => {
    process.env[NO_NAME] = "true";
    expect(expandTerseRequest(terse, TODAY)).toBe(long);
  });

  it("withTerseSlots writes the earlier terse turn out the same way", () => {
    process.env[FLAG] = "on";
    process.env[NO_NAME] = "true";
    const out = withTerseSlots(request("verbal", [{ id: "m0", role: "user", content: CASES_NO_NAME[0]![0], createdAt: "" } as never]));
    expect(out.history[0]!.content).toBe(CASES_NO_NAME[0]![1]);
  });
});
