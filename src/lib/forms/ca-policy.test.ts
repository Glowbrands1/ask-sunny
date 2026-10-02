import { describe, expect, it } from "vitest";

import { JOIN } from "./bounded-context";
import {
  statedOffenseKeys,
  withStatedOffense,
  caPolicyAmbiguousNotice,
  caPolicyProposalLine,
  groundConductPolicy,
  namesCaPolicy,
  readCaPolicy,
  sectionText,
  withConductOffense,
} from "./ca-policy";
import type { ManualChunk } from "./official-policy-manual";

/**
 * ============================================================================
 * WHICH POLICY A CORRECTIVE ACTION RESTS ON
 * ============================================================================
 *
 * HR feedback, 30 Sep 2026: "I had to tell Sunny the applicable policy (which
 * was the Standards of Conduct) for the CA for missing the Woven deadline."
 * The four cases point at the Standards of Conduct; an account that also reads
 * as attendance or a target is a question; a policy the manager named wins;
 * and nothing is ticked unless the manual's own section lists the infraction.
 */

describe("the four conduct cases", () => {
  it.each([
    ["Create a corrective action for Colene for missing the Woven deadline.", "deadline"],
    ["for not meeting the woven 9-30-26 deadline. this is a verbal warning.", "deadline"],
    ["Her Woven training is overdue.", "deadline"],
    ["She didn't complete her closing duties.", "task"],
    ["Colene hasn't completed her required Woven items.", "task"],
    ["She did not finish the training module by the deadline she was given.", "task"],
    ["She was told to restock the lotion wall and refused.", "direction"],
    ["She refused to follow my instructions.", "direction"],
    ["She was insubordinate when I asked her to clean the beds.", "direction"],
  ])("%s -> Standards of Conduct (%s)", (text, topic) => {
    const reading = readCaPolicy(text);
    expect(reading.topics).toContain(topic);
    expect(reading.suggestion).toBe("standards_of_conduct");
    expect(reading.source).toBe("incident");
    expect(reading.ambiguous).toBeNull();
  });

  it.each([
    "She wore slippers on shift today.",
    "She was twenty minutes late.",
    "Her upgrade rate is below goal again.",
    "Create a corrective action for Colene.",
    "Did she miss the Woven deadline?",
  ])("suggests nothing for %s", (text) => {
    expect(readCaPolicy(text).suggestion).toBeNull();
    expect(readCaPolicy(text).ambiguous).toBeNull();
  });
});

describe("an account that reads two ways is a question", () => {
  it("a task left undone because she was late", () => {
    const reading = readCaPolicy("She came in late and didn't finish her opening tasks.");
    expect(reading.suggestion).toBeNull();
    expect(reading.ambiguous).toEqual(["standards_of_conduct", "attendance"]);
  });

  it("a deadline for a sales number", () => {
    const reading = readCaPolicy("She missed the deadline to hit her sales goal.");
    expect(reading.ambiguous).toEqual(["standards_of_conduct", "under_performance"]);
  });

  it("the question says what each would mean, and picks neither", () => {
    const line = caPolicyProposalLine(readCaPolicy("She came in late and didn't finish her opening tasks."))!;
    expect(line).toBe(
      "**Which policy applies?** This could fall under **Standards of Conduct** (assigned work that wasn't completed) or **Attendance**, if it comes down to being late or absent. Tell me which, or tick Type of Offense on the form — I won't pick one for you.",
    );
    expect(caPolicyAmbiguousNotice(readCaPolicy("She came in late and didn't finish her opening tasks."))).toBe(
      "This could fall under Standards of Conduct or Attendance, and you didn't say which — check Type of Offense, Policy Violated and Direct policy before you finalize.",
    );
  });
});

describe("a policy the manager named wins", () => {
  it("named outright, in the words HR used", () => {
    const reading = readCaPolicy(
      ["write a corrective action for colene for not meeting the woven deadline", "the policy violated is the standards of conduct"].join(JOIN),
    );
    expect(reading).toMatchObject({ stated: "standards_of_conduct", suggestion: "standards_of_conduct", source: "stated" });
  });

  it("answers the question that was asked", () => {
    const turns = ["She came in late and didn't finish her opening tasks.", "standards of conduct"].join(JOIN);
    expect(readCaPolicy(turns)).toMatchObject({ suggestion: "standards_of_conduct", source: "stated", ambiguous: null });
    const attendance = ["She came in late and didn't finish her opening tasks.", "attendance"].join(JOIN);
    expect(readCaPolicy(attendance)).toMatchObject({ stated: "attendance", suggestion: null, ambiguous: null });
  });

  it("a different policy named stops the suggestion, and the later turn wins", () => {
    expect(readCaPolicy(["She missed the Woven deadline.", "it's under performance"].join(JOIN)).suggestion).toBeNull();
    const corrected = ["She missed the Woven deadline.", "use attendance", "actually it is the standards of conduct"].join(JOIN);
    expect(readCaPolicy(corrected)).toMatchObject({ stated: "standards_of_conduct", source: "stated" });
  });

  it("an everyday word is not a policy named, and a negation or a question names none", () => {
    // "her attendance" in a long account describes; it does not answer.
    expect(readCaPolicy("She missed the Woven deadline and her attendance has also slipped this month.").stated).toBeNull();
    expect(readCaPolicy("It's not standards of conduct.").stated).toBeNull();
    expect(readCaPolicy("Is this standards of conduct?").stated).toBeNull();
    expect(namesCaPolicy("standards of conduct")).toBe(true);
    expect(namesCaPolicy("attendance")).toBe(true);
    expect(namesCaPolicy("what does the attendance policy say?")).toBe(false);
    expect(namesCaPolicy("ok")).toBe(false);
  });
});

/* ------------------------------------------------- grounded in the manual -- */

/** The Production manual's Standards of Conduct, chunks 36–37, and the next section. */
const MANUAL: ManualChunk[] = [
  {
    chunkIndex: 36,
    page: 13,
    printedPage: 12,
    section: "Standards of Conduct",
    sections: [{ heading: "Standards of Conduct", page: 12 }],
    content:
      "Standards of Conduct\nThe Company expects Employees to follow rules of conduct that will protect the interests and\nsafety of all customers, Employees, and The Company.\nThe following are examples (non-inclusive list) of infractions that may result in disciplinary\naction:\no Failing to follow the policies and procedures of The Company",
  },
  {
    chunkIndex: 37,
    page: 13,
    printedPage: 12,
    section: "Standards of Conduct",
    sections: [],
    content: "o Lack of sales performance\no Insubordination -the refusal to follow the directions of the manager.",
  },
  {
    chunkIndex: 40,
    page: 15,
    printedPage: 14,
    section: "Attendance",
    sections: [{ heading: "Attendance", page: 14 }],
    content: "Attendance\nIt is the responsibility of each employee to know his or her work schedule.\no Insubordination is never excused",
  },
];

describe("grounded in the manual as it reads now", () => {
  it("rests a missed deadline on the manual's own line", () => {
    const grounding = groundConductPolicy({
      reading: readCaPolicy("Create a corrective action for Colene for missing the Woven deadline."),
      chunks: MANUAL,
    });
    expect(grounding).toMatchObject({
      ok: true,
      section: { heading: "Standards of Conduct", page: 12 },
      anchor: "o Failing to follow the policies and procedures of The Company",
    });
  });

  it("rests a direction not followed on the insubordination line, inside the section only", () => {
    const grounding = groundConductPolicy({ reading: readCaPolicy("She refused to follow my instructions."), chunks: MANUAL });
    expect(grounding).toMatchObject({ ok: true, anchor: "o Insubordination -the refusal to follow the directions of the manager." });
    // The section stops where Attendance begins.
    const section = grounding.ok ? grounding.section : null;
    expect(sectionText(MANUAL, section!)).not.toMatch(/Attendance|never excused/);
  });

  it("fails closed: no manual, no section, or a section that lists no such infraction", () => {
    const reading = readCaPolicy("She missed the Woven deadline.");
    expect(groundConductPolicy({ reading, chunks: null })).toEqual({ ok: false, reason: "no_manual" });
    expect(groundConductPolicy({ reading, chunks: [MANUAL[2]!] })).toEqual({ ok: false, reason: "no_section" });
    const bare: ManualChunk[] = [{ ...MANUAL[0]!, content: "Standards of Conduct\nThe Company expects Employees to follow rules of conduct." }];
    expect(groundConductPolicy({ reading, chunks: bare })).toEqual({ ok: false, reason: "not_supported" });
    expect(groundConductPolicy({ reading: readCaPolicy("She wore slippers."), chunks: MANUAL })).toEqual({
      ok: false,
      reason: "no_suggestion",
    });
  });

  it("a policy the manager named needs only its section", () => {
    const bare: ManualChunk[] = [{ ...MANUAL[0]!, content: "Standards of Conduct\nThe Company expects Employees to follow rules of conduct." }];
    const grounding = groundConductPolicy({ reading: readCaPolicy("the policy violated is the standards of conduct"), chunks: bare });
    expect(grounding).toMatchObject({ ok: true, anchor: null });
  });
});

describe("the Type of Offense once it is grounded", () => {
  it("replaces Under Performance and the Other write-in, and keeps everything else", () => {
    const result = withConductOffense({
      checked: { offense_type: ["under_performance", "dress_code"], warning_type: ["verbal"] },
      values: { observation: "x", other_offense: "Failure to complete required task" },
    });
    expect(result.checked).toEqual({ offense_type: ["standards_of_conduct", "dress_code"], warning_type: ["verbal"] });
    expect(result.values).toEqual({ observation: "x" });
    expect(result.replaced).toEqual(["under_performance", "other_offense"]);
  });

  it("ticks it once, whatever was ticked", () => {
    const result = withConductOffense({ checked: { offense_type: ["standards_of_conduct"] }, values: {} });
    expect(result.checked.offense_type).toEqual(["standards_of_conduct"]);
    expect(result.replaced).toEqual([]);
  });
});

describe("the box a named policy ticks", () => {
  it.each([
    [["She came in late and didn't finish her opening tasks.", "attendance"], ["tardiness"]],
    [["She was a no call no show Saturday.", "it's attendance"], ["absenteeism"]],
    [["She was late Friday and absent Saturday.", "attendance"], ["tardiness", "absenteeism"]],
    [["She missed the Woven deadline.", "under performance"], ["under_performance"]],
    [["She missed the Woven deadline.", "the policy is standards of conduct"], ["standards_of_conduct"]],
    [["She wore slippers.", "dress code"], ["dress_code"]],
  ])("%j -> %j", (turns, keys) => {
    const text = (turns as string[]).join(JOIN);
    expect(statedOffenseKeys(readCaPolicy(text), text)).toEqual(keys);
  });

  it("nothing named, nothing ticked here", () => {
    expect(statedOffenseKeys(readCaPolicy("She missed the Woven deadline."), "She missed the Woven deadline.")).toBeNull();
  });

  it("ticks only what the version offers, and the model's choice gives way", () => {
    const result = withStatedOffense({
      checked: { offense_type: ["standards_of_conduct"], warning_type: ["verbal"] },
      values: { other_offense: "Punctuality" },
      keys: ["tardiness", "not_an_option"],
      offered: ["tardiness", "absenteeism", "standards_of_conduct"],
    });
    expect(result.checked).toEqual({ offense_type: ["tardiness"], warning_type: ["verbal"] });
    expect(result.values).toEqual({});
    expect(result.replaced).toEqual(["standards_of_conduct", "other_offense"]);
  });

  it("the proposal says the named policy back", () => {
    expect(caPolicyProposalLine(readCaPolicy("attendance"))).toBe(
      "**Policy:** Attendance, as you said. I'll quote that section from the current policy manual on the draft.",
    );
    expect(caPolicyProposalLine(readCaPolicy("it's under performance"))).toBe(
      "**Policy:** Under Performance, as you said. The policy manual has no single section to quote for it, so Direct policy is left for you to complete.",
    );
  });
});
