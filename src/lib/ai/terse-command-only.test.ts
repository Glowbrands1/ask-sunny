import { afterEach, describe, expect, it } from "vitest";

import { detectTemplateIntent } from "@/lib/forms/template-intent";

import { expandTerseRequest } from "./terse-slots";

/**
 * QA, 26 Oct 2026: with TERSE_SLOT_READ on, three existing suites changed —
 * the sentences below were rewritten (a middle name lost, a held coaching
 * dated by the first date, "out of dress code" losing "out of").
 * TERSE_COMMAND_ONLY_ENABLED leaves them as typed and keeps every live short
 * command. Names invented.
 */
const FLAGS = ["TERSE_SLOT_READ_ENABLED", "TERSE_COMMAND_ONLY_ENABLED"] as const;
const saved = Object.fromEntries(FLAGS.map((name) => [name, process.env[name]]));
afterEach(() => {
  for (const name of FLAGS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

const TODAY = "2026-10-25";
const SENTENCES = [
  "Exit for john michael doe effective october 2",
  "coaching form for Test Employee at NE Kearney, she was late on 10-5 and 10-15, I coached her on 10-16 about being late",
  "CA for Test Employee at Kearney, out of dress code 10/11",
  "ca for quenby arlott not opening salon on time and no call no show",
  "exit devon hale, she gave her notice and her last day was 9/20",
];
const COMMANDS: readonly [string, string][] = [
  ["ca quenby arlott opened late 15 min 9-20 verbal 25 deduct", "Create a corrective action form for quenby arlott."],
  ["coach quenby arlott woven acks 10-16", "Create a coaching form for quenby arlott."],
  ["exit quenby arlott tc ks manhattan nc/ns last day 9/20 called 9/27 no answer", "Create an exit form for quenby arlott"],
  ["verbal ca quenby arlott ks manhattan dress code 10/11", "Create a corrective action form for quenby arlott at ks manhattan."],
  ["coach tamsin vedder", "Create a coaching form for tamsin vedder."],
];

function cases(text: string): string[] {
  const lower = text.toLowerCase();
  return [lower, lower[0]!.toUpperCase() + lower.slice(1), text.toUpperCase()];
}

describe("TERSE_COMMAND_ONLY_ENABLED off: TERSE_SLOT_READ rewrites the sentences, as on main", () => {
  it("rewrites the 'for' sentences", () => {
    delete process.env.TERSE_COMMAND_ONLY_ENABLED;
    expect(expandTerseRequest(SENTENCES[0]!, TODAY)).not.toBe(SENTENCES[0]);
    expect(expandTerseRequest(SENTENCES[2]!, TODAY)).not.toBe(SENTENCES[2]);
  });
});

describe("TERSE_COMMAND_ONLY_ENABLED on", () => {
  it.each(SENTENCES)("leaves the sentence '%s' as typed, in any case", (sentence) => {
    process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
    for (const variant of cases(sentence)) expect(expandTerseRequest(variant, TODAY)).toBe(variant);
  });

  it("a 'ca for <name>' sentence is still the Corrective Action request", () => {
    process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
    expect(detectTemplateIntent(SENTENCES[3]!)).toEqual({ kind: "explicit", templateKey: "dpoa" });
  });

  it.each(COMMANDS)("still writes out the command '%s', in any case", (command, start) => {
    process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
    for (const variant of cases(command)) expect(expandTerseRequest(variant, TODAY).toLowerCase().startsWith(start.toLowerCase())).toBe(true);
  });
});

/**
 * QA live runs, 26 Oct 2026 (Sunny tester 1, TERSE off and on; names invented,
 * "rory ann vance" stands in for the tester's three-part name).
 */
describe("TERSE_COMMAND_ONLY_ENABLED on: the live command lines", () => {
  const THREE: readonly [string, string][] = [
    ["ca rory ann vance ks manhattan late today verbal", "Create a corrective action form for rory ann vance at ks manhattan."],
    ["ca john michael doe late today", "Create a corrective action form for john michael doe."],
    ["ca rory ann vance opened late 10-12", "Create a corrective action form for rory ann vance."],
  ];
  it.each(THREE)("keeps a three-part name whole: '%s', in any case", (command, start) => {
    process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
    for (const variant of cases(command)) expect(expandTerseRequest(variant, TODAY).toLowerCase().startsWith(start.toLowerCase())).toBe(true);
  });

  it.each([
    ["ca devon harlan opened late 15 min 9-20 verbal 25 deduct", "Create a corrective action form for devon harlan."],
    ["coach devon harlan woven acks 10-16", "Create a coaching form for devon harlan."],
    ["exit devon harlan tc ks manhattan nc/ns last day 9/20 called 9/27 no answer", "Create an exit form for devon harlan at ks manhattan"],
  ])("writes out the tester's line '%s' with the form word never in the name", (command, start) => {
    process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
    for (const variant of cases(command)) {
      const out = expandTerseRequest(variant, TODAY);
      expect(out.toLowerCase().startsWith(start.toLowerCase())).toBe(true);
      expect(out.toLowerCase()).not.toContain("for ca ");
    }
  });

  it("stays two words when the third is the account ('woven acks', 'tanned on clock')", () => {
    process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
    expect(expandTerseRequest("coach devon harlan woven acks 10-16", TODAY)).toMatch(/^Create a coaching form for devon harlan\. /);
    expect(expandTerseRequest("coaching quenby arlott tanned on clock 9-28-26 tc ks manhattan", TODAY)).toMatch(/^Create a coaching form for quenby arlott at ks manhattan, /);
  });

  it.each([
    "coaching form for rory ann vance, she was late today",
    "Create a coaching form for Test Employee at KS Manhattan, she was late on 10-5 and 10-15, I coached her on 10-16.",
    "coaching form for rory vance and a ca for devon harlan",
    "Exit for rory ann vance effective october 2",
    "Sacramento, CA",
    "ca",
    "coach",
    "exit",
  ])("leaves '%s' as typed, in any case", (turn) => {
    process.env.TERSE_COMMAND_ONLY_ENABLED = "on";
    for (const variant of cases(turn)) expect(expandTerseRequest(variant, TODAY)).toBe(variant);
  });
});
