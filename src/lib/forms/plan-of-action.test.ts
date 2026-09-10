import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseFormDocument } from "./document";
import { correctiveActionDocument, policyReviewDocument, TEMPLATE_SEEDS } from "./library";
import {
  EXPECTATION_LABEL,
  GOING_FORWARD_LABEL,
  OBSERVED_EXPECTATION,
  OBSERVED_LABEL,
  PLAN_OF_ACTION,
  guardNarrative,
  guardNarrativeDraft,
} from "./narrative-draft";
import { draftableFields } from "./responsibility";

/**
 * ============================================================================
 * THE PLAN OF ACTION SAYS WHAT IS BEING DONE — NOT WHAT NOBODY DECIDED
 * ============================================================================
 *
 * The Policy Review came back with its two policy fields correctly empty, which
 * is the fail-closed behaviour working: nothing approved was retrieved, so
 * nothing was quoted. And then the Plan of Action — the one prose field with no
 * shape asked of it — filled that silence with a policy recalled from memory, a
 * formal review date nobody set, and a consequence nobody decided.
 *
 * So the field now asks for a shape, the same way the observation does. These
 * tests hold the two halves of that: the PARAGRAPH the manager approved
 * survives untouched, and each of the three inventions does not.
 */

/** The wording the manager asked for, as it should print. */
const APPROVED_PLAN = [
  "This is being addressed as a policy review of salon appearance standards.",
  "Jane is expected to arrive for each shift in attire that meets the salon's dress and",
  "appearance standards, and to confirm with a manager beforehand if she is uncertain",
  "whether an item of clothing is appropriate. The specific dress code language should be",
  "reviewed with Jane from the current applicable company manual, and the manager should",
  "confirm she understands the standard.",
].join(" ");

/** What the manager actually typed. No dates, no policy, no consequences. */
const NOTES = "Today, at the salon, Jane was wearing a short skirt while on shift.";

/** The observation beside it, as the manager approved it. */
const APPROVED_OBSERVATION = [
  OBSERVED_LABEL,
  "Today, at the salon, Jane was wearing a short skirt while on shift.",
  "",
  EXPECTATION_LABEL,
  "Employees are expected to report to work in attire that meets the salon's appearance and" +
    " dress standards, including appropriate skirt and short length, so that presentation is" +
    " professional in front of clients.",
  "",
  GOING_FORWARD_LABEL,
  "Jane should choose work attire that meets the salon's appearance standards before reporting" +
    " for a shift, and ask a manager in advance if she is unsure whether a specific item is" +
    " acceptable.",
].join("\n");

describe("the approved wording survives the guard", () => {
  it("keeps the whole Details block, both fields, word for word", () => {
    /*
     * THE WHOLE POINT, IN ONE ASSERTION. Two shaped fields drafted from four
     * words of manager notes — and every sentence of both is guidance the
     * assistant is meant to write, so nothing here is the guard's to remove.
     * A guard that trimmed any of this would be refusing the coaching rather
     * than the invention.
     */
    const result = guardNarrativeDraft(
      { observation: APPROVED_OBSERVATION, plan_of_action: APPROVED_PLAN },
      [
        { key: "observation", narrative: OBSERVED_EXPECTATION },
        { key: "plan_of_action", narrative: PLAN_OF_ACTION },
      ],
      NOTES,
    );

    expect(result.values.observation).toBe(APPROVED_OBSERVATION);
    expect(result.values.plan_of_action).toBe(APPROVED_PLAN);
    expect(result.adjusted).toEqual([]);
    expect(result.emptied).toEqual([]);
  });
});

describe("the approved paragraph survives the guard", () => {
  it("is kept word for word", () => {
    const result = guardNarrative(APPROVED_PLAN, NOTES);

    expect(result.text).toBe(APPROVED_PLAN);
    expect(result.removed).toEqual([]);
  });

  it("keeps the sentence that sends the manager to the manual", () => {
    /*
     * The one sentence most at risk from a guard that reads "manual" as a
     * citation. It is the opposite of a citation: it says the wording has NOT
     * been quoted and must be read from the approved source with the employee.
     */
    expect(guardNarrative(APPROVED_PLAN, NOTES).text).toContain(
      "reviewed with Jane from the current applicable company manual",
    );
  });
});

describe("the three inventions do not survive", () => {
  it("drops a follow-up cadence and a review date nobody set", () => {
    const result = guardNarrative(
      "Follow-up observations will be conducted regularly, with a formal review scheduled to confirm compliance.",
      NOTES,
    );

    expect(result.text).toBe("");
    expect(result.removed).toHaveLength(1);
  });

  it("drops a consequence quoted from a policy nobody retrieved", () => {
    const result = guardNarrative(
      "Continued non-compliance will result in further action as outlined in company policy.",
      NOTES,
    );

    expect(result.text).toBe("");
    expect(result.removed).toHaveLength(1);
  });

  it("drops a disciplinary step the manager never chose", () => {
    const result = guardNarrative(
      "A written warning will be issued if this happens again.",
      NOTES,
    );

    expect(result.text).toBe("");
  });

  it("keeps the rest of the paragraph when one sentence goes", () => {
    // An HR record is not silently shortened to nothing: what was grounded
    // stays, and what went is reported.
    const result = guardNarrative(
      `${APPROVED_PLAN} Continued non-compliance will result in further action as outlined in company policy.`,
      NOTES,
    );

    expect(result.text).toBe(APPROVED_PLAN);
    expect(result.removed).toHaveLength(1);
  });
});

describe("the guard reaches the plan field at all", () => {
  it("runs on a field marked plan_of_action", () => {
    /*
     * THE DEFECT IN ONE ASSERTION. `guardNarrativeDraft` used to compare
     * against one shape, so a plan field was passed through byte for byte
     * however it was marked.
     */
    const result = guardNarrativeDraft(
      { plan_of_action: "Continued non-compliance will result in further action as outlined in company policy." },
      [{ key: "plan_of_action", narrative: PLAN_OF_ACTION }],
      NOTES,
    );

    // Dropped rather than blanked: an emptied field carries no value to the
    // write at all, which is how the manager gets a blank line to fill in
    // rather than a stored empty string.
    expect(result.values).not.toHaveProperty("plan_of_action");
    expect(result.emptied).toEqual(["plan_of_action"]);
  });

  it("still leaves an unmarked field alone", () => {
    const untouched = "Continued non-compliance will result in further action as outlined in company policy.";
    const result = guardNarrativeDraft({ notes: untouched }, [{ key: "notes" }], NOTES);

    expect(result.values.notes).toBe(untouched);
    expect(result.adjusted).toEqual([]);
  });
});

describe("both corrective forms ask for the shapes", () => {
  const shapes = (document: ReturnType<typeof policyReviewDocument>) =>
    Object.fromEntries(
      draftableFields(document, null)
        .filter((field) => field.narrative)
        .map((field) => [field.key, field.narrative]),
    );

  it("marks the Policy Review's observation and plan, and nothing else", () => {
    expect(shapes(policyReviewDocument())).toEqual({
      observation: "observed_expectation",
      plan_of_action: PLAN_OF_ACTION,
    });
  });

  it("marks the Corrective Action Form's observation and action plan, and nothing else", () => {
    expect(shapes(correctiveActionDocument())).toEqual({
      observation: "observed_expectation",
      action_plan: PLAN_OF_ACTION,
    });
  });

  it("leaves the policy fields quoting the manual, not narrating it", () => {
    // The shapes are additions BESIDE the policy trio, not a replacement for
    // it: a plan that describes the manual must never become the place the
    // manual is quoted.
    const grounded = draftableFields(policyReviewDocument(), null)
      .filter((field) => field.policyGrounded)
      .map((field) => field.key);

    expect(grounded).toEqual(["policy_violated", "policy_language"]);
    expect(grounded.some((key) => key === "plan_of_action")).toBe(false);
  });

  it("survives storage, so a published version still carries them", () => {
    const stored = parseFormDocument(JSON.parse(JSON.stringify(policyReviewDocument())));

    expect(shapes(stored)).toEqual({
      observation: "observed_expectation",
      plan_of_action: PLAN_OF_ACTION,
    });
  });

  it("publishes as a new revision, or no database ever sees it", () => {
    // A document changed in this file reaches a running app only by its seed
    // revision moving. Both were revision 1.
    for (const key of ["dpoa", "policy-review"]) {
      const seed = TEMPLATE_SEEDS.find((entry) => entry.key === key)!;
      expect(seed.revision).toBeGreaterThan(1);
    }
  });
});

/**
 * The prompt half. A guard can only refuse; what the paragraph SAYS is asked
 * for here, and asking has no behaviour to assert without calling the model —
 * so this reads the instructions the route sends, as `coaching-autocomplete`
 * does for the observation.
 */
const ROUTE = readFileSync("src/app/api/forms/instances/[id]/draft/route.ts", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

const SYSTEM = ROUTE.slice(ROUTE.indexOf("const system = ["), ROUTE.indexOf("const prompt = ["));

describe("the draft asks for the paragraph", () => {
  it("asks for one paragraph, not labelled sections", () => {
    expect(SYSTEM).toContain("PLAN_OF_ACTION");
    expect(SYSTEM).toMatch(/ONE PARAGRAPH — no labels, no bullets, no headings/);
  });

  it("names the three beats in order", () => {
    expect(SYSTEM).toMatch(/FIRST, name what is being done/);
    expect(SYSTEM).toMatch(/This is being addressed as a policy review of salon appearance standards/);
    expect(SYSTEM).toMatch(/SECOND, the standard the employee is expected to meet going forward/);
    expect(SYSTEM).toMatch(/THIRD, that the specific policy language should be reviewed with the employee/);
  });

  it("closes the paragraph to everything else", () => {
    expect(SYSTEM).toMatch(/NOTHING ELSE BELONGS IN THIS PARAGRAPH/);
    expect(SYSTEM).toMatch(/No date and no timeframe/);
    expect(SYSTEM).toMatch(/no consequence of a further occurrence/);
    expect(SYSTEM).toMatch(/no bracketed placeholder/);
  });

  it("never lets the plan quote a policy", () => {
    expect(SYSTEM).toMatch(/Never name, quote or paraphrase a policy here/);
  });

  it("sends the rules only to a form that declares the shape", () => {
    // Keyed on the stored version, never on a template name.
    expect(ROUTE).toMatch(/field\.narrative === PLAN_OF_ACTION/);
    expect(SYSTEM).toContain("...(hasPlanOfAction");
  });
});
