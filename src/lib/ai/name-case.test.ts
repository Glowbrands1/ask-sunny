import { afterEach, describe, expect, it } from "vitest";

import { extractEmployeeNames } from "@/lib/forms/proposal";

import { humanCase, withNameCase } from "./name-case";
import type { AskRequest } from "./types";

/**
 * QA, 25-26 Oct 2026 (production, both apps, names invented): the same
 * sentences in lowercase, sentence case and capitals. Mixed case was read;
 * lowercase and capitals lost the employee, and capitals read "LAST DAY WAS"
 * as a second person.
 */
const FLAG = "NAME_CASE_INSENSITIVE_ENABLED";
const saved = process.env[FLAG];
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

function sentenceCase(text: string): string {
  const lower = text.toLowerCase();
  return lower[0]!.toUpperCase() + lower.slice(1);
}

const CASES: readonly [string, string][] = [
  ["write up devon harlan, team member, at dodge, ne, for being late today", "Devon Harlan"],
  ["write up devon harlan for being late", "Devon Harlan"],
  ["devon harlan, ks manhattan, was on her phone 25 min customers waiting 9-29-26", "Devon Harlan"],
  ["create a ca for rory vance", "Rory Vance"],
  ["create an exit form for devon harlan who was a team member at dodge, ne. she resigned on 9-15-26 and her last day was 9-28-26", "Devon Harlan"],
  ["i need an exit form for devon harlan, a team member at our dodge, ne store. her last day worked was 9-20-26", "Devon Harlan"],
];

describe("NAME_CASE_INSENSITIVE_ENABLED off", () => {
  it("reads every turn as typed, and main's reader misses the lowercase and capitals", () => {
    delete process.env[FLAG];
    const request = { question: CASES[1]![0], history: [] } as unknown as AskRequest;
    expect(withNameCase(request)).toBe(request);
    expect(extractEmployeeNames("write up devon harlan for being late")).toEqual([]);
    expect(extractEmployeeNames("WRITE UP DEVON HARLAN FOR BEING LATE")).toEqual([]);
    expect(extractEmployeeNames("Devon harlan, ks manhattan, was on her phone")).toEqual(["Devon harlan"]);
  });
});

describe("NAME_CASE_INSENSITIVE_ENABLED on: the same person in lowercase, sentence case, first-name-only capital and capitals", () => {
  it.each(CASES)("%s", (text, name) => {
    const variants = [
      text,
      sentenceCase(text),
      text.toUpperCase(),
      text.replace(name.split(" ")[0]!.toLowerCase(), name.split(" ")[0]!),
    ];
    for (const variant of variants) {
      expect(extractEmployeeNames(humanCase(variant))).toContain(name);
    }
  });

  it("writes the 'test employee' placeholder in Title Case like any name", () => {
    expect(humanCase("create a coaching form for test employee")).toBe("create a coaching form for Test Employee");
  });

  it("never reads 'LAST DAY WAS' as a person in a message typed in capitals", () => {
    const out = humanCase("CREAT AN EXIT FORM FOR DEVON HARLAN WHO WAS A TEAM MEMEBER AT DODGE, NE. SHE RESINED ON 9-15-26 AND HER LAST DAY WAS 9-28-26");
    expect(extractEmployeeNames(out)).toEqual(["Devon Harlan"]);
  });

  it("applies to the question and earlier manager turns with the flag on", () => {
    process.env[FLAG] = "on";
    const out = withNameCase({
      question: "write up devon harlan for being late",
      history: [{ role: "user", content: "create a ca for rory vance" }, { role: "assistant", content: "Who is this for?" }],
    } as unknown as AskRequest);
    expect(out.question).toBe("write up Devon Harlan for being late");
    expect(out.history[0]!.content).toBe("create a ca for Rory Vance");
    expect(out.history[1]!.content).toBe("Who is this for?");
  });

  it("keeps names that are also words, one-word names, topics and questions as typed", () => {
    expect(extractEmployeeNames(humanCase("ca for will hope"))).toEqual(["Will Hope"]);
    expect(extractEmployeeNames(humanCase("coaching form for joy summer"))).toEqual(["Joy Summer"]);
    for (const text of [
      "coaching for dress code",
      "coaching for cash handling",
      "a written warning for attendance",
      "what is a ca?",
      "she works at ks manhattan",
      "Create a coaching form for Kaitlyn about how the whole team should sanitize beds",
      "ca for lisa",
      "write up for being late",
    ]) {
      expect(humanCase(text)).toBe(text);
    }
  });

  it("never offers words in capitals after a terse exit line as people (Sunny conv_mvokbx6w2gp8cu4)", async () => {
    const { expandTerseRequest } = await import("./terse-slots");
    const text = "EXIT DEVON HARLAN TC KS MANHATTAN NC/NS LAST DAY 9/20 CALLED 9/27 NO ANSWER";
    for (const variant of [text, sentenceCase(text), text.toLowerCase()]) {
      expect(extractEmployeeNames(humanCase(expandTerseRequest(variant, "2026-10-25")))).toEqual(["Devon Harlan"]);
    }
    expect(humanCase("ca for avery stone, JBA manual 1-1-26")).toBe("ca for Avery Stone, JBA manual 1-1-26");
  });
});
