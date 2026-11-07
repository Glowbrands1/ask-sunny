import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { splitAppCitationLine } from "./app-citation-line";
import { planRevision, type CurrentValue } from "./revision";

/*
 * QA's production-flags read and bisect, 5 Nov 2026 (Sunny, POLICY_CITATION_ENABLED on in
 * production): the replay cases nov4-live-coaching-c1 ("fix her last name, it is Laine") and
 * nov3-edit-capitalised-words ("Add that she Must Practice the checklist with Dez before
 * Daily Stats.") were refused, because the Details ended in the app's own citation line and
 * keepsSubstance missed its page numbers in the revision. The people are the pack's invented ones.
 */
const FIELDS = [{ key: "coaching_details", label: "Details of Coaching" }];
const current = (value: string): ReadonlyMap<string, CurrentValue> => new Map([["coaching_details", { value, checked: [], filledBy: "ai" }]]);
const plan = (question: string, before: string, after: string) =>
  planRevision({ question, fields: FIELDS, current: current(before), proposed: { values: { coaching_details: after } } });

const LANE = "Observed:\nDana Lane was late to open the location today.\n\nExpectation:\nDana is expected to arrive on time and be ready to open.";
const LAINE = LANE.replace("Dana Lane", "Dana Laine");
const CITED_4 = "Policy reference: Late Opening Policy, JBA Policy Manual p.15; Attendance Policy, JBA Policy Manual p.14";
const MARNIE = "Observed:\nMarnie skipped the opening checklist today.";
const MARNIE_ADDED = "Observed:\nMarnie skipped the opening checklist today. She will practise the checklist with her lead before the daily stats review.";
const CITED_1 = "Policy reference: Standards of Conduct Policy, JBA Policy Manual p.12";

beforeEach(() => vi.stubEnv("CITATION_LINE_KEPT_ON_REVISION_ENABLED", ""));
afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("CITATION_LINE_KEPT_ON_REVISION_ENABLED", "true");

describe("CITATION_LINE_KEPT_ON_REVISION_ENABLED", () => {
  it("off: the revision that drops the app's citation line is refused (the production defect)", () => {
    const result = plan("fix her last name, it is Laine", `${LANE}\n\n${CITED_4}`, LAINE);
    expect(result.values).toEqual({});
    expect(result.untouched).toEqual(["coaching_details"]);
  });

  it("on, #4: \"fix her last name, it is Laine\" lands, and the citation line stays at the end", () => {
    on();
    const result = plan("fix her last name, it is Laine", `${LANE}\n\n${CITED_4}`, LAINE);
    expect(result.values.coaching_details).toBe(`${LAINE}\n\n${CITED_4}`);
  });

  it("on, #1: the capitalised-words addition lands, and the citation line stays", () => {
    on();
    const result = plan("Add that she Must Practice the checklist with Dez before Daily Stats.", `${MARNIE}\n\n${CITED_1}`, MARNIE_ADDED);
    expect(result.values.coaching_details).toBe(`${MARNIE_ADDED}\n\n${CITED_1}`);
  });

  it("on: a revision that kept the line is written as it is (never twice)", () => {
    on();
    const result = plan("fix her last name, it is Laine", `${LANE}\n\n${CITED_4}`, `${LAINE}\n\n${CITED_4}`);
    expect(result.values.coaching_details).toBe(`${LAINE}\n\n${CITED_4}`);
  });

  it("on, negative: a manager's own number that disappears is still refused", () => {
    on();
    const before = `Observed:\nMarnie was 25 minutes late to open on 10/20.\n\n${CITED_1}`;
    const result = plan("make it sound more professional", before, "Observed:\nMarnie arrived late to open.");
    expect(result.values).toEqual({});
    expect(result.untouched).toEqual(["coaching_details"]);
  });

  it("negative: a \"Policy reference\" the manager typed in the middle of the text is not the app's line", () => {
    const typed = `Observed:\nPolicy reference: Standards of Conduct Policy, JBA Policy Manual p.12\nMarnie skipped the opening checklist today.`;
    expect(splitAppCitationLine(typed)).toEqual({ body: typed, line: null });
    expect(splitAppCitationLine(`${MARNIE}\n\n${CITED_1}`)).toEqual({ body: MARNIE, line: CITED_1 });
    expect(splitAppCitationLine(`${LANE}\n\n${CITED_4}`)).toEqual({ body: LANE, line: CITED_4 });
  });
});
