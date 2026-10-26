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
// These pin TERSE_SLOT_READ alone. With TERSE_COMMAND_ONLY_ENABLED on as well,
// a "ca for <name> …" sentence is left as typed on purpose (QA, 26 Oct 2026),
// pinned in terse-command-only.test.ts, so that flag is cleared here.
const COMMAND_ONLY = "TERSE_COMMAND_ONLY_ENABLED";
const savedCommandOnly = process.env[COMMAND_ONLY];
beforeEach(() => {
  delete process.env[COMMAND_ONLY];
});
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
  if (savedCommandOnly === undefined) delete process.env[COMMAND_ONLY];
  else process.env[COMMAND_ONLY] = savedCommandOnly;
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
