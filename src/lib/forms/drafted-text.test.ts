import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  containsPlaceholder,
  stripPlaceholders,
  stripPlaceholdersFromDraft,
} from "./drafted-text";
import { TEMPLATE_SEEDS } from "./library";
import { fieldsForVariant } from "./document";

/**
 * ============================================================================
 * "[Follow-Up Date]" MUST NEVER REACH A CANONICAL FIELD
 * ============================================================================
 *
 * QA caught this on a real coaching form. Asked to draft Details, the model
 * wrote "I will check in with Sarah on [Follow-Up Date] to review her
 * attendance", and that string became a stored value, an editor row and a line
 * in the printed PDF — a sentence that reads as a commitment while naming no
 * date, in a field nobody proof-reads because the assistant filled it.
 */

describe("P4-1. an unresolved placeholder is detected whatever it is called", () => {
  it.each([
    "I will check in on [Follow-Up Date].",
    "Discussed with [Employee Name].",
    "At [Salon] on [Date].",
    "Reviewed with {{manager}}.",
  ])("%s", (text) => {
    expect(containsPlaceholder(text)).toBe(true);
  });

  it("leaves ordinary prose alone", () => {
    expect(containsPlaceholder("Sarah was late twice this week.")).toBe(false);
    // Not every bracket is a placeholder, but a shape-based rule is the right
    // trade here: the next token a model invents is on no known-token list.
    expect(containsPlaceholder("Arrived 10 minutes late (twice).")).toBe(false);
  });
});

describe("P4-1. the whole sentence goes, not just the bracket", () => {
  it("does not leave a broken commitment behind", () => {
    /*
     * Deleting only the token leaves "I will check in with Sarah on to review
     * her attendance" — still a commitment, now ungrammatical.
     */
    const drafted =
      "Observed: Sarah was late twice.\nFollow-Up: I will check in with Sarah on [Follow-Up Date] to review her attendance.";
    const cleaned = stripPlaceholders(drafted);

    expect(cleaned).toContain("Observed: Sarah was late twice.");
    expect(cleaned).not.toContain("[Follow-Up Date]");
    expect(cleaned).not.toContain("I will check in");
    expect(cleaned).not.toMatch(/\bon\s+to\b/);
  });

  it("keeps the surviving lines in order", () => {
    const cleaned = stripPlaceholders(
      "Observed: late twice.\nExpectation: arrive on time.\nFollow-Up: check in on [Date].",
    );
    expect(cleaned.split("\n")).toEqual([
      "Observed: late twice.",
      "Expectation: arrive on time.",
    ]);
  });

  it("empties a field whose every sentence was a placeholder", () => {
    // Empty is the outcome the drafting contract already promises for anything
    // the model cannot support. A half-sentence is not.
    expect(stripPlaceholders("Follow up on [Date].")).toBe("");
  });
});

describe("P4-1. the guard reports what it changed", () => {
  it("cleans, empties and passes through", () => {
    const result = stripPlaceholdersFromDraft({
      coaching_details: "Late twice. Check in on [Follow-Up Date].",
      other_topic: "Attendance",
      empty_one: "See [Employee Name].",
    });

    expect(result.values.coaching_details).toBe("Late twice.");
    expect(result.values.other_topic).toBe("Attendance");
    expect(result.values.empty_one).toBeUndefined();
    expect(result.cleaned.sort()).toEqual(["coaching_details", "empty_one"]);
    expect(result.emptied).toEqual(["empty_one"]);
  });

  it("touches nothing when there is nothing to touch", () => {
    const values = { coaching_details: "Sarah was late twice this week." };
    const result = stripPlaceholdersFromDraft(values);
    expect(result).toEqual({ values, cleaned: [], emptied: [] });
  });
});

describe("P4-1. the drafting route runs the guard before storing anything", () => {
  const route = readFileSync(
    "src/app/api/forms/instances/[id]/draft/route.ts",
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("cleans the model's values before applyAssistantDraft", () => {
    // Scoped to the HANDLER: both names appear in the import block too, where
    // their order says nothing about when they run.
    const handler = route.slice(route.indexOf("export async function POST"));

    expect(handler).toContain("stripPlaceholdersFromDraft(drafted.values");
    expect(handler.indexOf("stripPlaceholdersFromDraft")).toBeLessThan(
      handler.indexOf("applyAssistantDraft("),
    );
    // And what gets written is the output of the guard CHAIN, never the raw
    // set: the placeholder guard hands to the narrative guard, and that result
    // is what reaches the store.
    expect(handler).toContain("guardNarrativeDraft(cleaned.values");
    expect(handler.indexOf("guardNarrativeDraft")).toBeLessThan(
      handler.indexOf("applyAssistantDraft("),
    );
    expect(handler).toContain("values: narrated.values");
    expect(handler).not.toContain("values: drafted.values");
  });

  it("also tells the model not to, because both belong", () => {
    // A model instruction is a request; the guard is the boundary. Having only
    // one of the two is how the string got stored in the first place.
    expect(route).toContain("Never write a placeholder");
    expect(route).toContain("the follow-up date is recorded separately");
  });
});

describe("P4-1. follow-up is not a field on the Coaching Form", () => {
  it("has no follow-up field, so narrating one duplicates an authority", () => {
    /*
     * The reason the guard removes follow-up sentences rather than tidying
     * them: the published Coaching Form has nowhere to put a follow-up date.
     * It is instance metadata with its own route and its own control, and a
     * paragraph repeating it would disagree the moment a manager moved it.
     */
    const coaching = TEMPLATE_SEEDS.find((seed) => seed.key === "coaching")!;
    const keys = fieldsForVariant(coaching.document, null).map((field) => field.key);

    expect(keys.some((key) => key.includes("follow"))).toBe(false);
  });
});

describe("P4-1. no policy can reach a Coaching Form through the form path", () => {
  it("has no policy-grounded field at all", () => {
    /*
     * THE $25 ASSIGNED-OPENER PARAGRAPH QA SAW CAME FROM THE RAG PATH, NOT
     * FROM DRAFTING. `groundPolicy` runs only when some drafted field is marked
     * `policyGrounded`, and the Coaching Form marks none — so retrieval never
     * runs for it and no policy text can enter the record this way.
     *
     * Pinned here because it is load-bearing: a future template edit that
     * marked a coaching field policy-grounded would open that path, and should
     * have to come past this test to do it.
     */
    const coaching = TEMPLATE_SEEDS.find((seed) => seed.key === "coaching")!;
    const grounded = fieldsForVariant(coaching.document, null).filter(
      (field) => field.policyGrounded,
    );

    expect(grounded).toEqual([]);
  });
});
