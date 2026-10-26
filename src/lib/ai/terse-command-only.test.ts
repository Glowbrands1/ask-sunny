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
