import { describe, expect, it } from "vitest";

import { readCaPolicy } from "./ca-policy";
import { statesFirstOccurrence } from "./corrective-action-intake";
import { rosterNameNamedIn, type RosterEmployee } from "./employee-match";
import { correctedIncidentDate } from "./form-date-answer";
import { statedPayrollDeduct } from "./payroll-deduct";
import { policyPhrasesIn, readPolicyChange } from "./policy-change";
import { extractEmployeeNames } from "./proposal";
import { detectTemplateIntent } from "./template-intent";
import { statedWarningLevel } from "./warning-level";

/*
 * ============================================================================
 * ROUND 3 (QA, 22 Oct 2026): THE READERS, ON WORDING NOBODY TUNED FOR
 * ============================================================================
 *
 * The end-to-end tests (`corrective-action-dm-feedback-e2e.test.ts`,
 * `corrective-action-chat-edits-e2e.test.ts`) run these phrasings through to a
 * saved form. Here each reader's new rule is pinned on its own, with the
 * sentences that must NOT trigger it beside the ones that must. Synthetic
 * people only.
 */
const TODAY = "2026-10-21";

const asksForTheForm = (text: string) => {
  const intent = detectTemplateIntent(text);
  return (
    (intent.kind === "explicit" && intent.templateKey === "dpoa") ||
    (intent.kind === "corrective_action" && intent.requestedCreation)
  );
};

describe("a Corrective Action asked for in everyday words", () => {
  it.each([
    "tess varga needs a write up",
    "write up for tess varga, missed meeting 10/20/26, written",
    "Remy Calder - CA - written - no call no show to manager meeting 10/13/26",
    "I'd like to issue Remy Calder a verbal for showing up late on 10/18/26.",
    "Tess Varga ditched the 10/20/26 all-hands meeting. Final step isn't needed yet, just a verbal.",
    "Hi, can you help me start a written warning for Tess Varga? She never came to the meeting.",
    "Can we put Tess Varga on a written for skipping the 10/20/26 meeting?",
    "Doc a CA on Tess Varga. Missed mandatory meeting 10.20.26.",
    "I'd like a verbal corrective for Remy Calder, register was $5 short on 10/19/26",
    "she needs to be written up for the 10/20 meeting",
  ])("asks for the form: %s", (text) => {
    expect(asksForTheForm(text)).toBe(true);
  });

  it.each([
    "how do I write up an employee?",
    "can you give me a written summary of the attendance policy",
    "I want everyone to get a written copy of the schedule",
    "she only had a verbal before",
    "can you write a summary of the meeting for the team",
  ])("does not: %s", (text) => {
    expect(asksForTheForm(text)).toBe(false);
  });
});

describe("the warning level said for THIS form", () => {
  it.each([
    ["I'd like to issue Remy Calder a verbal for showing up late on 10/18/26.", "verbal"],
    ["Tess Varga ditched the meeting. Final step isn't needed yet, just a verbal.", "verbal"],
    ["Hi, can you help me start a written warning for Tess Varga?", "written"],
    ["Remy Calder - CA - written - no call no show to manager meeting 10/13/26", "written"],
    ["Level: written. Payroll ded: N", "written"],
    ["oops, should've been written", "written"],
    ["bump it up to a written", "written"],
    ["downgrade to verbal", "verbal"],
    ["on second thought, verbal", "verbal"],
  ])("%s → %s", (text, level) => {
    expect(statedWarningLevel(text)).toBe(level);
  });

  it.each([
    "late again today. last CA: written warning",
    "she should've been given a written months ago",
    "we moved her to a written last month",
    "she only had a verbal before",
    "she had coaching on the jba manual 1/1/26 and a verbal ca 9/1/26",
  ])("history, not this form's level: %s", (text) => {
    expect(statedWarningLevel(text)).toBeNull();
  });
});

describe("the payroll answer without the form's words", () => {
  it.each([
    ["We aren't docking her pay.", "no"],
    ["not taking it out of her check", "no"],
    ["no pay deduction", "no"],
    ["payroll deduction no - prior coaching 7/1/26", "no"],
    ["dock her pay for the shortage", "yes"],
    ["take it out of his paycheck", "yes"],
    ["payroll deduction yes - $5 short", "yes"],
  ])("%s → %s", (text, answer) => {
    expect(statedPayrollDeduct(text)).toBe(answer);
  });

  it.each(["she was docked on the schedule board", "the paycheck stub was wrong"])("nothing: %s", (text) => {
    expect(statedPayrollDeduct(text)).toBeNull();
  });
});

describe("a missed meeting is Attendance; assigned work blown off is conduct", () => {
  it.each([
    "she didn't show for our 10/20/26 staff meeting",
    "no call to the 10/20/26 manager meeting",
    "Can we put Tess Varga on a written for skipping the 10/20/26 meeting?",
    "she no call no showed to the store meeting tuesday",
    "he skipped the training session on 10/3",
  ])("attendance: %s", (text) => {
    expect(readCaPolicy(text).described).toBe("attendance");
  });

  it.each(["tess varga blew off her woven training due 10/15/26", "he ignored his woven modules again"])(
    "assigned work: %s",
    (text) => {
      const reading = readCaPolicy(text);
      expect(reading.topics).toContain("task");
      expect(reading.described).toBeNull();
    },
  );

  it.each(["is skipping a meeting an attendance issue?", "she didn't show for her shift"])("neither: %s", (text) => {
    const reading = readCaPolicy(text);
    expect(reading.described).toBeNull();
    expect(reading.topics).toEqual([]);
  });

  it("\"against dress code\" names the policy; an opinion about it does not", () => {
    expect(readCaPolicy("Remy Calder, written warning, wore jeans on 10/19/26 against dress code, no payroll deduction").stated).toBe("dress_code");
    expect(readCaPolicy("she said in the huddle she is not against dress code changes at all").stated).toBeNull();
  });
});

describe("a corrected incident date replaces the first one", () => {
  it.each([
    [["need a CA for tess varga for missing the 10/20/26 meeting", "wait, the meeting was 10/19/26"], "2026-10-19"],
    [["ca for remy calder for being late 10/15/26", "correction: it was 10/16/26 not 10/15"], "2026-10-16"],
  ] as const)("%j → %s", (turns, iso) => {
    expect(correctedIncidentDate(turns, TODAY)).toBe(iso);
  });

  it.each([
    [["ca for tess varga for missing the 10/20/26 meeting", "actually she also missed 10/14/26"]],
    [["ca for tess varga for missing the 10/20/26 meeting", "she was coached 1-1-26 on the jba manual"]],
    [["ca for tess varga for missing the 10/20/26 meeting"]],
    [["ca for tess varga for missing the 10/20/26 meeting", "wait, was it 10/19/26?"]],
  ] as const)("no correction: %j", (turns) => {
    expect(correctedIncidentDate(turns, TODAY)).toBeNull();
  });
});

describe("names", () => {
  const person = (id: string, firstName: string, lastName: string) =>
    ({ id, firstName, lastName, preferredFirstName: null, locationIds: [] }) as unknown as RosterEmployee;
  const ROSTER = [person("1", "Tess", "Varga"), person("2", "Remy", "Calder")];

  it("a possessive names the person whose it is", () => {
    expect(rosterNameNamedIn("remy calder's drawer came up $20 short on 10/17/26", ROSTER)).toBe("Remy Calder");
  });

  it("\"Final step isn't needed yet\" names nobody", () => {
    expect(extractEmployeeNames("Final step isn't needed yet, just a verbal.")).toEqual([]);
    expect(extractEmployeeNames("Tess Varga ditched the meeting. Final step isn't needed yet.")).toEqual(["Tess Varga"]);
  });
});

describe("a stated absence of history", () => {
  it.each(["nothing prior", "nothing on file", "clean record", "no history"])("%s", (text) => {
    expect(statesFirstOccurrence(text)).toBe(true);
  });
  it("a history is not one", () => {
    expect(statesFirstOccurrence("she has a history of lateness")).toBe(false);
  });
});

describe("\"switch the policy to …\"", () => {
  it("names the policy asked for, as a replacement", () => {
    const text = "switch the policy to standards of conduct";
    expect(readPolicyChange(text)).toBe("replace");
    expect(policyPhrasesIn(text)[0]).toBe("standards of conduct");
  });
});

describe("the level reader stays out of the intake's import cycle", () => {
  /*
   * A production build of the round-3 working tree answered 500 on /api/chat and
   * the forms routes: "Cannot access … before initialization", from
   * template-intent → corrective-action-intake → payroll-deduct →
   * template-intent. The test runner loads modules in another order and never
   * saw it. `warning-level.ts` is where the level reader lives so that it can
   * import nothing; this keeps it that way.
   */
  // It may use the payroll reader, which imports nothing itself; `src/lib/import-cycles.test.ts` guards the rest.
  it("warning-level.ts imports only the import-free payroll reader", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const imports = (path: string) =>
      [...readFileSync(join(process.cwd(), path), "utf8").matchAll(/^\s*import\s.*from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(imports("src/lib/forms/warning-level.ts")).toEqual(["./payroll-deduct-answer"]);
    expect(imports("src/lib/forms/payroll-deduct-answer.ts")).toEqual([]);
  });
});
