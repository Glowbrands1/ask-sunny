import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { coachingDocument } from "./library";
import { draftableCheckboxGroups, draftableFields } from "./responsibility";

/**
 * ============================================================================
 * THE DRAFTING CONTRACT, READ OFF THE ROUTE THAT SENDS IT
 * ============================================================================
 *
 * Half of "the form came back half empty" was a guard, and that half is tested
 * against behaviour in `narrative-draft.test.ts`. The other half was the PROMPT,
 * and a prompt has no behaviour to assert without calling the model — so these
 * read the instructions the route actually sends.
 *
 * That is a weaker kind of test and it is used deliberately, for the things
 * whose absence caused the defect:
 *
 *   "CHECKBOXES YOU MAY TICK" is a permission, and read next to a page of
 *   never-invent rules the safest reading of a permission is to decline it. A
 *   clear tardiness case came back with no type, no topic and no write-in.
 *
 *   The section contract said TWO sections and told the model the expectation
 *   was the manager's to supply. It did as it was told.
 *
 * Comments are stripped before matching: this file's own explanations mention
 * the very strings it asserts are absent.
 */

const ROUTE = readFileSync("src/app/api/forms/instances/[id]/draft/route.ts", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The instructions, without the handler's plumbing around them. */
const SYSTEM = ROUTE.slice(ROUTE.indexOf("const system = ["), ROUTE.indexOf("const prompt = ["));

describe("the draft asks for all three sections", () => {
  it("names Observed, Expectation and Going Forward", () => {
    expect(SYSTEM).toContain("OBSERVED_LABEL");
    expect(SYSTEM).toContain("EXPECTATION_LABEL");
    expect(SYSTEM).toContain("GOING_FORWARD_LABEL");
    expect(SYSTEM).toMatch(/three labelled sections/i);
  });

  it("tells the assistant to write the expectation itself", () => {
    expect(SYSTEM).toMatch(/WRITE THE EXPECTATION YOURSELF/);
    expect(SYSTEM).toMatch(/infer a reasonable, neutral, behavioural standard/i);
  });

  it("does NOT make the expectation the manager's to supply", () => {
    /*
     * The exact instructions that produced the one-line form. Their absence is
     * the fix, so their absence is what is checked.
     */
    expect(SYSTEM).not.toMatch(/THE EXPECTATION MUST BE THE MANAGER'S OWN/);
    expect(SYSTEM).not.toMatch(/Never supply an expectation of your own/);
    expect(SYSTEM).not.toMatch(/two labelled sections/i);
  });

  it("tells the assistant to complete the form rather than ask", () => {
    expect(SYSTEM).toMatch(/Complete the form/);
    expect(SYSTEM).toMatch(/do not ask the manager for wording you can write yourself/i);
  });

  it("separates the manager's facts from the assistant's guidance", () => {
    expect(SYSTEM).toMatch(/FACTS come only from what the manager described/);
    expect(SYSTEM).toMatch(/COACHING GUIDANCE is yours to write/);
  });
});

describe("the draft is told to tick the boxes, not merely permitted to", () => {
  it("instructs rather than permits", () => {
    expect(ROUTE).toContain("CHECKBOXES TO TICK");
    // The permissive wording is what left every group empty.
    expect(ROUTE).not.toContain("CHECKBOXES YOU MAY TICK");
    expect(ROUTE).toMatch(/Tick the options that match what the manager described/);
  });

  it("pairs the Other option with its write-in, and names Punctuality", () => {
    /*
     * Ticking "other" without naming the topic prints a ticked box with no
     * label beside it, which is worse than an untouched group.
     */
    expect(ROUTE).toMatch(/tick "other" AND name the topic in the matching write-in field/);
    expect(ROUTE).toContain("Punctuality");
  });

  it("offers the Other instruction only to templates that have that option", () => {
    // Generic, not coaching-specific: a template with no `other` option is not
    // told about one.
    expect(ROUTE).toMatch(/groups\.some\(\(group\) => group\.options\.some\(\(option\) => option\.key === "other"\)\)/);
  });
});

describe("what auto-completion still may not invent", () => {
  it("forbids policy citation, consequences and manufactured specifics", () => {
    expect(SYSTEM).toMatch(/NOT a quotation of any written rule/i);
    expect(SYSTEM).toMatch(/never cite a policy section or attendance points/i);
    expect(SYSTEM).toMatch(
      /Never add a disciplinary level, a verbal or written warning, a suspension, a termination, an amount, a count of prior incidents, or a date the manager did not give you/,
    );
  });

  it("keeps the manager's own specifics", () => {
    expect(SYSTEM).toMatch(/Keep every specific the manager gave/);
  });

  it("keeps Going Forward about behaviour, never a meeting", () => {
    expect(SYSTEM).toMatch(/never about arranging a meeting: no follow-up, no check-in, no review date/);
    expect(SYSTEM).toMatch(/Never write a placeholder such as \[Follow-Up Date\]/);
  });
});

describe("the guard chain still runs on what comes back", () => {
  it("cleans placeholders, then narrative, then stores", () => {
    const handler = ROUTE.slice(ROUTE.indexOf("export async function POST"));

    expect(handler).toContain("stripPlaceholdersFromDraft(drafted.values");
    expect(handler).toContain("guardNarrativeDraft(cleaned.values");
    expect(handler.indexOf("stripPlaceholdersFromDraft")).toBeLessThan(
      handler.indexOf("guardNarrativeDraft"),
    );
    expect(handler.indexOf("guardNarrativeDraft")).toBeLessThan(
      handler.indexOf("applyAssistantDraft("),
    );
    // The chain continues past the narrative guard now — timeframe, then
    // responsibilities, then policy — and its END is what is stored.
    expect(handler).toContain("guardFollowUpTimeframe(narrated.values");
    expect(handler).toContain("values: policyChecked.values");
  });

  it("passes the MANAGER'S notes as the grounding source", () => {
    // Not the model's own output, and not the assistant's earlier turns.
    expect(ROUTE).toMatch(/guardNarrativeDraft\(cleaned\.values, fields, notes\)/);
  });

  it("does not send a narrative field's stored help alongside the contract", () => {
    // A version published before the contract changed still carries the older
    // wording; sending both would put two instructions on one field.
    expect(ROUTE).toMatch(/field\.help && !field\.narrative/);
  });
});

describe("the fields auto-completion is expected to fill", () => {
  const document = coachingDocument();

  it("are the four the Coaching Form marks as Ask Sunny's", () => {
    const fieldKeys = draftableFields(document, null).map((field) => field.key);
    const groupKeys = draftableCheckboxGroups(document, null).map((group) => group.key);

    expect(groupKeys).toEqual(["coaching_type", "coaching_topics"]);
    expect(fieldKeys).toContain("other_topic");
    expect(fieldKeys).toContain("coaching_details");
  });

  it("include an Other option to carry a write-in like Punctuality", () => {
    const topics = draftableCheckboxGroups(document, null).find(
      (group) => group.key === "coaching_topics",
    );
    expect(topics?.options.some((option) => option.key === "other")).toBe(true);
    // Still not a permanent checkbox.
    expect(topics?.options.some((option) => /punctual/i.test(option.label))).toBe(false);
  });
});
