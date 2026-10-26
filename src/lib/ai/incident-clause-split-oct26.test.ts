import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { slotClause } from "./form-full-remap";
import { incidentClauses, incidentOnlyText, incidentSentences } from "./incident-clauses";
import { accountSentences, requestIncident } from "./remap-incident";

/**
 * INCIDENT_CLAUSE_SPLIT_ENABLED (QA, 26 Oct 2026; production chats in both
 * apps). What happened was a fragment of the turn: cut at the comma of a
 * "place, state", an employee fact or a policy instruction typed last, or a
 * pasted policy paragraph. The managers' wording is kept; the names are
 * invented, and the sibling app's store names are this app's salon words.
 *
 * Every wording runs all lowercase and in sentence case (first letter
 * capitalised, names lowercase or Capitalised): the app must read both the
 * same.
 */

const remap = (text: string, employeeName: string) => requestIncident({ text, employeeName, slotClause });
const intent = (turns: readonly string[], employeeName: string) => accountSentences(turns, employeeName);

function cased(text: string, names: readonly string[]): string[] {
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  let named = sentence;
  for (const name of names) {
    const capital = name.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
    named = named.split(name).join(capital);
  }
  return [...new Set([text.toLowerCase(), sentence, named])];
}

const DEVON =
  "please create a corrective action form for devon harlan, she works at our kearney, ne salon as a tan consultant and was late today.";
const MARLO =
  "create a ca for marlo fenwick. she is the salon director at our kearney, ne. she did not do the 10 minute disinfect on 9/25/26";
const TESSA = "ca for tessa quill, primary salon is lawrence. tessa skipped the 10 minute disinfect today";
const TENURE = "create a written ca for jory pell for late opening on 10-21-26. employee for 7 months";
const CITE = "create a written ca for jory pell for late opening on 10-21-26. and cite the standards of conduct as the policy violated";
const NOT_ATTENDANCE =
  "create a written ca for jory pell, opened the salon 20 minutes late on 10-21-26. the policy violated is late opening, not attendance";
const PASTED = [
  "create a ca for jory pell, she opened 30 minutes late today",
  "Issue: The employee who failed to open will then be required to reimburse The Company $25",
];
const TWO_PEOPLE =
  "create a ca for nell ostrow. the salon director went over the policy acknowledgements with nell on 10-02-26. nell did not acknowledge the policies in woven by 10-09-26";

describe("INCIDENT_CLAUSE_SPLIT_ENABLED on", () => {
  beforeEach(() => vi.stubEnv("INCIDENT_CLAUSE_SPLIT_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it("keeps \"kearney, ne\" in one clause and drops the employee facts before the incident", () => {
    for (const text of cased(DEVON, ["devon harlan"])) {
      expect(remap(text, "devon harlan")).toBe("late today");
      expect(intent([text], "devon harlan")).toEqual(["was late today"]);
    }
  });

  it("a title at a salon is not the incident; the missed disinfect is", () => {
    for (const text of cased(MARLO, ["marlo fenwick"])) {
      expect(remap(text, "marlo fenwick")).toBe("did not do the 10 minute disinfect");
      expect(intent([text], "marlo fenwick")).toEqual(["she did not do the 10 minute disinfect on 9/25/26"]);
    }
  });

  it("\"primary salon is …\" is the salon, never the account", () => {
    for (const text of cased(TESSA, ["tessa quill", "tessa"])) {
      expect(remap(text, "tessa quill")).toBe("skipped the 10 minute disinfect today");
      expect(intent([text], "tessa quill").join(" ").toLowerCase()).not.toContain("primary salon");
    }
  });

  it("tenure typed last does not overwrite the incident", () => {
    for (const text of cased(TENURE, ["jory pell"])) {
      expect(remap(text, "jory pell")).toBe("late opening");
      expect(intent([text], "jory pell")).toEqual(["late opening on 10-21-26"]);
    }
  });

  it("a policy instruction typed last does not overwrite the incident", () => {
    for (const text of [...cased(CITE, ["jory pell"]), ...cased(NOT_ATTENDANCE, ["jory pell"])]) {
      const incident = remap(text, "jory pell");
      expect(incident).toMatch(/^(?:late opening|opened the salon 20 minutes late)$/i);
      expect(intent([text], "jory pell").join(" ")).not.toMatch(/policy violated|not attendance/i);
    }
  });

  it("a pasted policy paragraph never replaces the incident", () => {
    for (const first of cased(PASTED[0]!, ["jory pell"])) {
      const turns = [first, PASTED[1]!];
      expect(remap(turns.join("\n"), "jory pell")).toBe("opened 30 minutes late today");
      expect(intent(turns, "jory pell")).toEqual(["she opened 30 minutes late today"]);
    }
  });

  it("a fragment follow-up turn (an employee fact) keeps the incident already given", () => {
    const turns = [cased(TENURE, ["jory pell"])[0]!, "employee for 7 months", "the location is NE Grand Island"];
    expect(remap(turns.join("\n"), "jory pell")).toBe("late opening");
  });

  it("a story that names two people keeps the incident whole", () => {
    for (const text of cased(TWO_PEOPLE, ["nell ostrow", "nell"])) {
      const read = remap(text, "nell ostrow") ?? "";
      expect(read.toLowerCase()).toContain("went over the policy acknowledgements");
      expect(read.toLowerCase()).toContain("did not acknowledge the policies in woven");
    }
  });

  it("keeps $3.25 whole", () => {
    for (const text of cased("create ca form for wren calloway, register shortage 10-20-26, $3.25 payroll deduct", ["wren calloway"])) {
      expect(intent([text], "wren calloway")).toEqual(["register shortage 10-20-26, $3.25 payroll deduct"]);
    }
  });
});

describe("INCIDENT_CLAUSE_SPLIT_ENABLED on: the intent read's own sentences", () => {
  beforeEach(() => vi.stubEnv("INCIDENT_CLAUSE_SPLIT_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it("a bare salon reply with the intent read's sentences in front keeps the incident already given", () => {
    for (const first of cased("create a ca for kira dunmore, she was late today", ["kira dunmore"])) {
      const turns = [first, "The employee is Kira Dunmore. Policy reference: Attendance, JBA Policy Manual p.14. the salon is NE Kearney"];
      expect(remap(turns.join("\n"), "kira dunmore")).toBe("late today");
    }
  });

  it("a manager's own \"it happened at 3 when she …\" is still the account", () => {
    expect(incidentOnlyText("it happened at 3 when she left the front desk empty", null)).toBe(
      "it happened at 3 when she left the front desk empty",
    );
  });
});

describe("INCIDENT_CLAUSE_SPLIT_ENABLED on: the Sunny tester's case and commas inside an account", () => {
  beforeEach(() => vi.stubEnv("INCIDENT_CLAUSE_SPLIT_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());

  // QA, 26 Oct 2026, Sunny tester: first name capitalised, surname lowercase.
  const TESTER = "Devon harlan, ks manhattan, was on her phone 25 min customers waiting 9-29-26";

  it("keeps the tester's incident whole", () => {
    for (const text of [TESTER, TESTER.toLowerCase(), "Devon Harlan, KS Manhattan, was on her phone 25 min customers waiting 9-29-26"]) {
      expect(intent([text], "devon harlan").join(" ")).toContain("was on her phone 25 min customers waiting");
      expect(remap(text, "devon harlan")).toBe("on her phone 25 min customers waiting");
    }
  });

  it("commas inside a real account still split into its acts, none dropped", () => {
    for (const text of cased("she was late, again, and left early", [])) {
      const clauses = incidentClauses(text);
      expect(clauses.map((clause) => clause.toLowerCase())).toEqual(["she was late", "again", "and left early"]);
      expect(incidentOnlyText(text, null).toLowerCase()).toBe("she was late, again, and left early");
    }
  });
});

describe("INCIDENT_CLAUSE_SPLIT_ENABLED on: commands are never the incident", () => {
  beforeEach(() => vi.stubEnv("INCIDENT_CLAUSE_SPLIT_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());

  // QA / Code 8, 26 Oct 2026, production flags: the command rode into Observation of Offense.
  it("\"no deduct\" and \"date 10/14\" after the account stay out of it", () => {
    for (const text of cased("coaching form for kira dunmore. late opening the salon today. no deduct", ["kira dunmore"])) {
      expect(intent([text], "kira dunmore").join(" ")).not.toMatch(/deduct/i);
      expect(remap(text, "kira dunmore")).toBe("late opening the salon today");
    }
    for (const text of cased("coaching form for kira dunmore. skipped a tour today. date 10/14", ["kira dunmore"])) {
      expect(intent([text], "kira dunmore").join(" ")).not.toMatch(/date/i);
      expect(remap(text, "kira dunmore")).toBe("skipped a tour today");
    }
  });

  it("the intent read's \"It happened at …\" glued onto the account is not part of it", () => {
    const text = "coaching form for kira dunmore, skipped a tour today It happened at KS Lawrence.";
    expect(incidentOnlyText(text, "kira dunmore")).toBe("coaching form for kira dunmore, skipped a tour today");
  });

  it("a later command turn keeps the incident already given (\"no deduct\", \"date is\", \"change it to written\")", () => {
    for (const later of ["no deduct", "No deduct", "date is 10/14", "Date is", "change it to written", "Change it to written", "verbal"]) {
      expect(remap(["create a ca for kira dunmore, she was late today", later].join("\n"), "kira dunmore"), later).toBe("late today");
    }
  });
});

describe("the clause splitter", () => {
  it("keeps a place and its state, a date, an amount and an abbreviation in one clause", () => {
    expect(incidentClauses("she works at our kearney, ne salon, and was late")).toEqual([
      "she works at our kearney ne salon",
      "and was late",
    ]);
    expect(incidentClauses("lawrence, ks")).toEqual(["lawrence ks"]);
    expect(incidentSentences("she was short $3.25 on 9/25/26. she left at 3 p.m. on friday")).toEqual([
      "she was short $3.25 on 9/25/26",
      "she left at 3 p.m. on friday",
    ]);
    expect(incidentSentences("she was late to the st. joe salon")).toEqual(["she was late to the st. joe salon"]);
  });

  it("a state code that is also a word splits as before", () => {
    expect(incidentClauses("she was late, in the back room, on her phone")).toEqual([
      "she was late",
      "in the back room",
      "on her phone",
    ]);
    expect(incidentClauses("she was late, co-workers covered")).toEqual(["she was late", "co-workers covered"]);
  });

  it("an account that says \"the employee who\" without a rule word stays", () => {
    expect(incidentOnlyText("the employee who was scheduled did not show", null)).toBe(
      "the employee who was scheduled did not show",
    );
  });
});

describe("INCIDENT_CLAUSE_SPLIT_ENABLED off", () => {
  beforeEach(() => vi.stubEnv("INCIDENT_CLAUSE_SPLIT_ENABLED", ""));
  afterEach(() => vi.unstubAllEnvs());

  it("the readers see the turn as typed (the reported fragments)", () => {
    expect(remap(DEVON, "devon harlan")).toBe("ne salon as a tan consultant and was late today");
    expect(remap(TENURE, "jory pell")).toBe("employee for 7 months");
    expect(remap(PASTED.join("\n"), "jory pell")).toBe(PASTED[1]);
  });

  it("a later command turn is read as the incident (the reported command bug)", () => {
    expect(remap(["create a ca for kira dunmore, she was late today", "no deduct"].join("\n"), "kira dunmore")).toBe("no deduct");
  });
});
