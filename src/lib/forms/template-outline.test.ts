import { describe, expect, it } from "vitest";

import { scopeRevision } from "./revision";
import { asksForOutline, policyKeptNote, templateOutlineKeys, withPolicyKeptNote, withTemplateFieldsNamed } from "./template-outline";

/*
 * TEMPLATE_OUTLINE_FIELDS_ENABLED. Pau's sf-s21 (Sunny production, 4 Nov 2026), the manager's words verbatim; the people are
 * invented (Wynne Sarrow, Tamsyn Fairlow). The replay cases `nov5-sf-s21-must-see-behaviors-template` and
 * `nov10-sf-s21-template-outline-saved` run the chat.
 */
const FIELDS = [
  { key: "observation", label: "Observation of Offense" },
  { key: "action_plan", label: "Action Plan" },
  { key: "prior_actions", label: "List previously received coaching and/or corrective action with date signed" },
];
const TEMPLATE =
  "Observation of Offense:  During the month of September 2026, Tamsyn completed 237 tanning transactions. …\n\nAt Sun Tan City, we strive to provide the ultimate tanning experience for every client.\t\n\nAction Plan:  The Leadership Team will coach Tamsyn on Must See Behaviors …";

describe("a request for a pasted template's outline", () => {
  it("reads the manager's ways of asking for it", () => {
    expect(asksForOutline("No this should be the same out line but with wynnes info i told you in the first chat")).toBe(true);
    expect(asksForOutline("Make it in the format that I explained above in the first chat for Wynne.")).toBe(true);
    expect(asksForOutline("it needs to look exactally the same as tamsyns but wtih all of this information")).toBe(true);
    expect(asksForOutline("add that she was late on 10/12")).toBe(false);
  });

  it("may write every field the latest pasted template heads", () => {
    const history = [
      { role: "user", content: "create a ca for must see behaviors for performace  this should be for wynne sarrow  - verbal" },
      { role: "assistant", content: "I'll draft a **Corrective Action Form** …" },
      { role: "user", content: TEMPLATE },
    ];
    expect([...templateOutlineKeys({ question: "No this should be the same out line but with wynnes info i told you in the first chat", history, fields: FIELDS })].sort()).toEqual(["action_plan", "observation"]);
    // No outline asked for, or no template with two headings: nothing more.
    expect(templateOutlineKeys({ question: "add that she was late", history, fields: FIELDS }).size).toBe(0);
    expect(templateOutlineKeys({ question: "the same out line please", history: [history[0]!], fields: FIELDS }).size).toBe(0);
  });

  it("names the template's fields, so the revision's own scope lets it write both", () => {
    const history = [{ role: "user", content: TEMPLATE }];
    const question = withTemplateFieldsNamed({ question: "No this should be the same out line but with wynnes info i told you in the first chat", history, fields: FIELDS });
    expect(question).toMatch(/^Please rewrite the Observation of Offense and rewrite the Action Plan in the outline of the template/);
    const scope = scopeRevision(question, FIELDS);
    expect(scope.mode).toBe("fields");
    expect([...scope.keys].sort()).toEqual(["action_plan", "observation"]);
    expect(withTemplateFieldsNamed({ question: "add that she was late", history, fields: FIELDS })).toBe("add that she was late");
  });
});

describe("Must See Behaviors \"and not the standard of conduct\"", () => {
  const question = "I need the CA for the Must see behaviors and not the standard of conduct. Make it in the format that I explained above in the first chat for Wynne.";
  const language = "…\n\nSource: 2025 JBA Policy Manual - — Standards of Conduct, p. 12";

  it("is answered with why the form keeps Standards of Conduct", () => {
    const note = policyKeptNote({ question, policyViolated: "Standards of Conduct", policyLanguage: language });
    expect(note).toBe("Must See Behaviors is part of the Standards of Conduct policy (JBA Policy Manual p.12), so I kept that policy on the form.");
    expect(withPolicyKeptNote("I didn't change anything on the form.", note!)).toBe(`${note} Nothing else on the form changed.`);
    expect(
      withPolicyKeptNote("I haven't changed the **Corrective Action Form** for **Wynne Sarrow** — everything on it is as it was.\n\nTell me which part to change and what it should say, and I'll update just that.", note!),
    ).toBe(`${note} Nothing else on the form changed.`);
    expect(withPolicyKeptNote("Updated the **Corrective Action Form** for **Wynne Sarrow**: Action Plan.", note!)).toBe(
      `Updated the **Corrective Action Form** for **Wynne Sarrow**: Action Plan.\n\n${note}`,
    );
  });

  it("says nothing on another policy, or without the ask", () => {
    expect(policyKeptNote({ question, policyViolated: "Attendance", policyLanguage: language })).toBeNull();
    expect(policyKeptNote({ question: "make it about must see behaviors", policyViolated: "Standards of Conduct", policyLanguage: language })).toBeNull();
  });
});
