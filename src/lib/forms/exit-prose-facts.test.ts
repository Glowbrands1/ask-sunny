import { afterEach, describe, expect, it } from "vitest";

import type { ChatFormProposal } from "@/types";

import { readExitDetails } from "./exit-details";
import { guardExitDetails } from "./exit-draft";
import { readExitFacts } from "./exit-facts";
import { exitReady } from "./exit-intake";

/**
 * QA, 25 Oct 2026, exit form F2: the prose said "Date: the day the draft is
 * created" while the card showed another date; "Additional Details: a short
 * account drafted from what you've described" was promised after a bare
 * name; and Details said the employee "worked through it" beside "did not
 * call in". The managers' wording is kept; the people are invented.
 */
const TODAY = "2026-10-25";
const FLAG = "EXIT_PROSE_FACTS_ENABLED";

function withFlag(on: boolean): void {
  if (on) process.env[FLAG] = "true";
  else delete process.env[FLAG];
}

afterEach(() => withFlag(false));

function proposal(overrides: Partial<ChatFormProposal> = {}): ChatFormProposal {
  return {
    templateName: "Resignation/Exit Form",
    employeeName: "Ava Pellmore",
    employeeRole: null,
    locationId: null,
    supportsInlineDraft: true,
    status: "ready",
    locationResolution: "not_applicable",
    ...overrides,
  } as ChatFormProposal;
}

function prose(
  text: string,
  overrides: Partial<ChatFormProposal> = {},
): string {
  const facts = readExitFacts(text, TODAY);
  return exitReady({
    proposal: proposal(overrides),
    facts,
    details: readExitDetails(text, TODAY, facts),
  });
}

// conv_mvofnrm5217ss9v, turn 2: a bare name.
const BARE_NAME = "ava pellmore";
// conv_mvoepgw32o35rpt, turn 2.
const LAST_DAY_TODAY = "her last day is today she is not rehireble";

describe("EXIT_PROSE_FACTS_ENABLED", () => {
  it("off, main's prose (the reported failures)", () => {
    withFlag(false);
    expect(prose(BARE_NAME)).toContain(
      "- **Additional Details:** a short account drafted from what you've described",
    );
    expect(prose(LAST_DAY_TODAY, { formDate: "2026-09-29" })).toContain(
      "- **Date:** the day the draft is created",
    );
  });

  it("the Date line is the card's date when it has one", () => {
    withFlag(true);
    expect(prose(LAST_DAY_TODAY, { formDate: "2026-09-29" })).toContain(
      "- **Date:** September 29, 2026",
    );
    expect(prose(LAST_DAY_TODAY)).toContain(
      "- **Date:** the day the draft is created",
    );
  });

  it("after a bare name, Additional Details is left blank, not promised", () => {
    withFlag(true);
    const text = prose(BARE_NAME);
    expect(text).not.toContain("a short account drafted");
    expect(text).not.toMatch(/- \*\*Additional Details:\*\*/);
    expect(text).toMatch(
      /\*\*Left blank for you to review:\*\*[^\n]*Additional Details/,
    );
  });

  it("with facts given, it says it holds only the manager's facts", () => {
    withFlag(true);
    expect(prose(LAST_DAY_TODAY)).toContain(
      "- **Additional Details:** only the facts you've given about the departure — nothing added",
    );
  });

  it('"worked through it" is dropped when the manager said "did not call in" and nothing about working the notice', () => {
    withFlag(true);
    const notes = "ava pellmore did not call in for her last two shifts";
    const drafted =
      "Ava gave notice and worked through it. Ava did not call in for the last two shifts.";
    expect(guardExitDetails(drafted, notes, TODAY)).toEqual({
      value: "Ava did not call in for the last two shifts.",
      removed: ["Ava gave notice and worked through it."],
    });
    withFlag(false);
    expect(guardExitDetails(drafted, notes, TODAY).value).toBe(drafted);
  });

  for (const on of [false, true]) {
    it(`NEVER-BREAK (flag ${on ? "on" : "off"}): the manager's own account and the filled lines stay`, () => {
      withFlag(on);
      const notes =
        "ava gave and worked 2 week notice. ava messaged management her resignation via woven";
      const drafted =
        "Ava gave two weeks notice and worked through the last day. Ava sent the resignation through Woven.";
      expect(guardExitDetails(drafted, notes, TODAY).value).toBe(drafted);
      const lastDay = "Ava gave two weeks notice on 9/1 and worked through the last day.";
      expect(guardExitDetails(lastDay, "Ava gave two weeks notice on 9/1 and her last day was 9/15.", TODAY).removed).toEqual([]);
      const text = prose(
        "tanning consultant. on 9-15-26 ava provided her resignation to management and her last day worked was 9-28-26",
        {
          employeeRole: "Tanning Consultant",
        },
      );
      expect(text).toContain("- **Name:** Ava Pellmore");
      expect(text).toContain("- **Job Title:** Tanning Consultant");
      expect(text).toContain("- **Last Day Worked:** September 28, 2026");
      expect(text).toContain(
        "- **Date that notice was given:** September 15, 2026",
      );
    });
  }
});

/* How managers type (Pau, 26 Oct 2026): all lowercase, sentence case with names capitalised, and ALL CAPS. */
const REGISTERS: [string, (text: string) => string][] = [
  ["all lowercase", (text) => text.toLowerCase()],
  [
    "sentence case",
    (text) => {
      const named = text.toLowerCase().split("ava pellmore").join("Ava Pellmore").split("ava ").join("Ava ");
      return named.charAt(0).toUpperCase() + named.slice(1);
    },
  ],
  ["ALL CAPS", (text) => text.toUpperCase()],
];

describe.each(REGISTERS)("EXIT_PROSE_FACTS_ENABLED in the managers' register: %s", (_register, as) => {
  it("the Date line is the card's date; a bare name leaves Additional Details blank", () => {
    withFlag(true);
    expect(prose(as("Her last day is today, she is not rehireable"), { formDate: "2026-09-29" })).toContain(
      "- **Date:** September 29, 2026",
    );
    expect(prose(as(BARE_NAME))).toMatch(/\*\*Left blank for you to review:\*\*[^\n]*Additional Details/);
  });

  it('"worked through it" is dropped beside "did not call in"; the manager\'s own account stays', () => {
    withFlag(true);
    const drafted = "Ava gave notice and worked through it. Ava did not call in for the last two shifts.";
    expect(guardExitDetails(drafted, as("ava pellmore did not call in for her last two shifts"), TODAY).removed).toEqual([
      "Ava gave notice and worked through it.",
    ]);
    const own = "Ava gave two weeks notice and worked through the last day.";
    expect(guardExitDetails(own, as("ava gave and worked 2 week notice"), TODAY).removed).toEqual([]);
  });

  // Dispatcher, 26 Oct 2026: notes that say it did NOT happen do not let a sentence say it did.
  it("on, a sentence saying the opposite of the notes is dropped; the notes' own negation stays", () => {
    withFlag(true);
    const drafted = "Ava resigned. Ava worked her two weeks notice. Ava called in to resign.";
    expect(guardExitDetails(drafted, as("exit for ava pellmore she never worked her notice"), TODAY).removed).toContain(
      "Ava worked her two weeks notice.",
    );
    expect(guardExitDetails(drafted, as("exit for ava pellmore she did not call in"), TODAY).removed).toContain(
      "Ava called in to resign.",
    );
    expect(guardExitDetails(drafted, as("exit for ava pellmore no 2 wk notice worked"), TODAY).value).toBe("Ava resigned.");
    const negated = "Ava did not work her notice. Ava never called in.";
    expect(guardExitDetails(negated, as("exit for ava pellmore she never worked her notice, did not call in"), TODAY).removed).toEqual([]);
  });

  it("flag off, the prose is main's", () => {
    withFlag(false);
    expect(prose(as(BARE_NAME))).toContain("a short account drafted from what you've described");
  });
});
