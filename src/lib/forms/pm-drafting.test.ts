import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseFormDocument } from "./document";
import {
  PERFORMANCE_MANAGEMENT_DRAFT_RULES,
  SENSITIVE_ACTION_OPTION_KEYS,
  refuseSensitiveSelections,
} from "./escalation-guard";
import { guardFollowUpTimeframe, notesCarryATimeframe } from "./follow-up-timeframe";
import { TEMPLATE_SEEDS } from "./library";
import { performanceManagementGovernance } from "./pm-governance";

/**
 * ============================================================================
 * THE PROGRESSION GOVERNS THE FORMS THAT RECORD IT
 * ============================================================================
 *
 * Three guards, each on a decision the model was previously allowed to make on
 * its own:
 *
 *   WHICH FORMS NEED THE FRAMEWORK. Derived from the stored version — never
 *   from a template key list, and never from the request.
 *
 *   WHICH RUNG. Reasoned, with §10.7's order and the framework's own text; left
 *   unset where the manager's account does not support a choice.
 *
 *   WHETHER A TERMINATION IS TICKED. Never by the assistant, whatever the
 *   reasoning, because the framework reserves that decision to the leadership
 *   process.
 */

const seed = (key: string) => TEMPLATE_SEEDS.find((entry) => entry.key === key)!;

function governanceFor(key: string) {
  const template = seed(key);
  return performanceManagementGovernance({
    layoutFamily: template.layoutFamily,
    document: parseFormDocument(template.document),
    variantKey: template.variants[0]?.key ?? null,
  });
}

/* ==================================================================== */
/*  WHICH FORMS ARE GOVERNED                                            */
/* ==================================================================== */

describe("the framework requirement is derived from the stored version", () => {
  it.each([
    // Its Next Step offers EPP, DPOA and Leadership Review.
    "follow-up-coaching",
    // Quotes policy, and its Type of Warning offers a final action.
    "dpoa",
    // Quotes policy, and its layout family is a rung.
    "policy-review",
    // Rungs by layout family — this is what covers EPP inline drafting the day
    // it is enabled, with no edit to the governance module.
    "sdit-epp",
    "tsd-epp",
    "asd-sdit-epp",
    "fttc-epp",
    "dmit-epp-tsd",
    "dmit-epp-dmit",
  ])("%s is governed", (key) => {
    const result = governanceFor(key);
    expect(result.governed, `${key}: ${result.reasons.join("; ")}`).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it.each([
    /*
     * THE PLAIN COACHING FORM IS NOT, and that exclusion matters as much as the
     * inclusions. The framework fails closed, so governing the form a Salon
     * Director reaches for most would mean a corpus missing one document could
     * not draft it. It is the FIRST documented rung and drafting one commits to
     * nothing further; its Type of Coaching options are kinds of coaching, not
     * rungs to escalate to.
     */
    "coaching",
    // The hiring forms: the subject is a candidate, and no signal fires.
    "prescreen-phone-interview",
    "tanning-consultant-interview",
    "management-interview-round-1",
    "management-interview-round-2",
  ])("%s is not governed", (key) => {
    expect(governanceFor(key).governed, key).toBe(false);
  });

  it("says WHY, so a refusal can be explained", () => {
    expect(governanceFor("follow-up-coaching").reasons.join(" ")).toContain("next_step");
    expect(governanceFor("dpoa").reasons.join(" ")).toContain("policy");
    expect(governanceFor("sdit-epp").reasons.join(" ")).toContain("layout family");
  });

  it("names the escalation groups it found", () => {
    expect(governanceFor("follow-up-coaching").escalationGroupKeys).toContain("next_step");
    expect(governanceFor("dpoa").escalationGroupKeys).toContain("warning_type");
    expect(governanceFor("coaching").escalationGroupKeys).toEqual([]);
  });
});

/* ==================================================================== */
/*  THE ROUTE'S WIRING                                                  */
/* ==================================================================== */

describe("the draft route resolves and enforces the framework itself", () => {
  const handler = readFileSync(
    "src/app/api/forms/instances/[id]/draft/route.ts",
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  const body = handler.slice(handler.indexOf("export async function POST"));

  it("derives the requirement from the stored version, not the request", () => {
    expect(body).toContain("performanceManagementGovernance({");
    expect(body).toContain("layoutFamily: loaded.instance.layoutFamily");
    expect(body).toContain("document,");
    // Nothing may arrive from the caller saying this form is exempt.
    expect(body).not.toMatch(/body\.(?:governed|framework|skipFramework|pm)/);
  });

  it("resolves the framework server-side before the model runs", () => {
    expect(body).toContain("fetchRoleGrounding(");
    expect(body).toContain("PERFORMANCE_MANAGEMENT_FRAMEWORK");
    expect(body.indexOf("fetchRoleGrounding")).toBeLessThan(body.indexOf("messages.create"));
  });

  it("blocks the AI draft when a governed form's framework is unhealthy", () => {
    expect(body).toContain("PM_DRAFT_UNAVAILABLE_NOTICE");
    // No values, no checks — and not an error, so the blank form stays usable.
    expect(body).toMatch(/governance\.governed && \(progression === null \|\| !progression\.ok\)/);
  });

  it("sends the framework's own rows, with their provenance", () => {
    expect(body).toContain("progression.grounding.rows");
    expect(body).toContain("row.document_title");
    expect(body).toContain("row.locator");
    expect(body).toContain("progressionBlock,");
  });

  it("adds the reasoning rules only for a governed form", () => {
    expect(body).toContain("governance.governed ? PERFORMANCE_MANAGEMENT_DRAFT_RULES : []");
  });

  it("refuses sensitive selections before anything is validated or stored", () => {
    expect(body).toContain("refuseSensitiveSelections({");
    expect(body.indexOf("refuseSensitiveSelections")).toBeLessThan(
      body.indexOf("enforceResponsibilities"),
    );
    expect(body.indexOf("refuseSensitiveSelections")).toBeLessThan(
      body.indexOf("applyAssistantDraft("),
    );
    // And the validated set is built from the FILTERED checks.
    expect(body).toContain("checked: sensitive.checked");
  });

  it("guards the follow-up timeframe on the way back", () => {
    expect(body).toContain("guardFollowUpTimeframe(narrated.values, fields, notes)");
    expect(body).toContain("values: timeframe.values");
  });
});

/* ==================================================================== */
/*  THE REASONING RULES                                                 */
/* ==================================================================== */

describe("the drafting rules carry the framework's own reasoning order", () => {
  const rules = PERFORMANCE_MANAGEMENT_DRAFT_RULES.join(" ");

  it("classifies before it chooses", () => {
    expect(rules).toMatch(/skill, knowledge, confidence, effort, policy or leadership/i);
    expect(rules.indexOf("classify")).toBeLessThan(rules.indexOf("LOWEST"));
  });

  it("chooses the lowest appropriate rung", () => {
    expect(rules).toMatch(/LOWEST rung that fits/);
  });

  it("keeps a skill or confidence gap off a warning on a first occurrence", () => {
    expect(rules).toMatch(/skill, knowledge or confidence gap is coached/i);
    expect(rules).toMatch(/does not go to a performance plan or a warning on a first occurrence/i);
  });

  it("requires history before a formal step", () => {
    expect(rules).toMatch(/already been coached and documented/i);
    expect(rules).toMatch(/Absent history is not evidence/i);
  });

  it("reserves the sensitive actions to leadership", () => {
    expect(rules).toMatch(/NEVER SELECT A TERMINATION, DEMOTION OR SUSPENSION/);
    expect(rules).toMatch(/leadership review/i);
  });

  it("permits leaving the step unset", () => {
    // The rule that stops an under-specified account producing a guessed rung.
    expect(rules).toMatch(/LEAVE THE STEP UNSET/);
    expect(rules).toMatch(/guessed rung on somebody's record is worse/i);
  });
});

/* ==================================================================== */
/*  THE SENSITIVE-ACTION GUARD                                          */
/* ==================================================================== */

describe("a termination is never AI-selected", () => {
  const dpoa = parseFormDocument(seed("dpoa").document);

  it("strips termination and demotion from the model's selections", () => {
    const result = refuseSensitiveSelections({
      document: dpoa,
      variantKey: null,
      checked: { warning_type: ["written", "termination"], offense_type: ["tardiness"] },
    });

    expect(result.checked.warning_type).toEqual(["written"]);
    expect(result.refused.warning_type).toEqual(["termination"]);
    expect(result.anyRefused).toBe(true);
    // An unrelated group is untouched.
    expect(result.checked.offense_type).toEqual(["tardiness"]);
  });

  it("drops the group entirely when a sensitive action was its only selection", () => {
    const result = refuseSensitiveSelections({
      document: dpoa,
      variantKey: null,
      checked: { warning_type: ["termination", "demotion"] },
    });

    // Not an empty array: no selection at all, so nothing prints as ticked.
    expect(result.checked.warning_type).toBeUndefined();
    expect(result.refused.warning_type).toEqual(["termination", "demotion"]);
  });

  it("leaves the legitimate warning levels alone", () => {
    const result = refuseSensitiveSelections({
      document: dpoa,
      variantKey: null,
      checked: { warning_type: ["verbal", "written"] },
    });

    expect(result.checked.warning_type).toEqual(["verbal", "written"]);
    expect(result.anyRefused).toBe(false);
  });

  it("does not remove the options from the template", () => {
    /*
     * The template keeps them. They are legitimate parts of the business form
     * and a manager acting on a leadership decision ticks them by hand; what is
     * refused is the ASSISTANT selecting one.
     */
    const groups = dpoa.blocks.filter((block) => block.kind === "checkbox_group");
    const warning = groups.find(
      (block) => block.kind === "checkbox_group" && block.key === "warning_type",
    );
    const keys =
      warning?.kind === "checkbox_group" ? warning.options.map((option) => option.key) : [];

    expect(keys).toEqual(["verbal", "written", "termination", "demotion"]);
  });

  it("treats a final written warning as a rung, not a separation", () => {
    // On the ladder rather than beyond it, so it is not in the sensitive set.
    expect(SENSITIVE_ACTION_OPTION_KEYS.has("final_warning")).toBe(false);
    expect(SENSITIVE_ACTION_OPTION_KEYS.has("written")).toBe(false);
    expect(SENSITIVE_ACTION_OPTION_KEYS.has("termination")).toBe(true);
    expect(SENSITIVE_ACTION_OPTION_KEYS.has("demotion")).toBe(true);
    expect(SENSITIVE_ACTION_OPTION_KEYS.has("suspension")).toBe(true);
  });

  it("cannot be reached on a template that offers no sensitive option", () => {
    const coaching = parseFormDocument(seed("coaching").document);
    const result = refuseSensitiveSelections({
      document: coaching,
      variantKey: null,
      checked: { coaching_type: ["retraining"] },
    });

    expect(result.anyRefused).toBe(false);
    expect(result.checked.coaching_type).toEqual(["retraining"]);
  });
});

/* ==================================================================== */
/*  THE FOLLOW-UP TIMEFRAME                                             */
/* ==================================================================== */

describe("the follow-up timeframe is the manager's, or it is empty", () => {
  const followUp = parseFormDocument(seed("follow-up-coaching").document);
  const fields = followUp.blocks.flatMap((block) =>
    block.kind === "field" ? [block.field] : block.kind === "field_row" ? block.fields : [],
  );

  it("marks the §9.2 field as a timeframe rather than a date", () => {
    const field = fields.find((entry) => entry.key === "next_follow_up");
    expect(field?.semantics).toBe("follow_up_timeframe");
    // A timeframe is text, not a calendar input: "on her next closing shift"
    // is not a date.
    expect(field?.input).toBe("text");
  });

  it.each([
    "We agreed to look at it again in two weeks.",
    "I will watch her next closing shift.",
    "Following up on Friday.",
    "Check again before the end of the month.",
    "Review on 2026-09-30.",
    "We said 30 days.",
    "I will look again later today.",
  ])("keeps a drafted timeframe when the manager said when: %s", (notes) => {
    const result = guardFollowUpTimeframe(
      { next_follow_up: "In two weeks, at her next one-to-one" },
      fields,
      notes,
    );

    expect(result.values.next_follow_up).toBe("In two weeks, at her next one-to-one");
    expect(result.emptied).toEqual([]);
  });

  it("empties an invented timeframe when the manager said nothing about when", () => {
    const notes =
      "She skipped the membership conversation with two eligible guests on the floor.";
    expect(notesCarryATimeframe(notes)).toBe(false);

    const result = guardFollowUpTimeframe(
      { next_follow_up: "In two weeks", original_topic: "Membership conversations" },
      fields,
      notes,
    );

    expect(result.values.next_follow_up).toBeUndefined();
    expect(result.emptied).toEqual(["next_follow_up"]);
    // Every other field is untouched: this guard is about one field.
    expect(result.values.original_topic).toBe("Membership conversations");
  });

  it("does not read a note about WHEN THE INCIDENT HAPPENED as a follow-up", () => {
    /*
     * The distinction a test found. Manager notes routinely end "...on the
     * floor today", which is when the thing happened. A follow-up points
     * forward, so a bare past-or-present word is not a timeframe to draft one
     * from — while an explicit "later today" is.
     */
    expect(notesCarryATimeframe("She skipped it twice on the floor today.")).toBe(false);
    expect(notesCarryATimeframe("It happened again tonight.")).toBe(false);
    expect(notesCarryATimeframe("I will check again later today.")).toBe(true);
    expect(notesCarryATimeframe("Follow up by tomorrow.")).toBe(true);
  });

  it("leaves the other templates alone — none declares a timeframe field", () => {
    for (const key of ["coaching", "dpoa", "policy-review", "sdit-epp"]) {
      const document = parseFormDocument(seed(key).document);
      const others = document.blocks.flatMap((block) =>
        block.kind === "field" ? [block.field] : block.kind === "field_row" ? block.fields : [],
      );
      expect(
        others.some((field) => field.semantics === "follow_up_timeframe"),
        key,
      ).toBe(false);

      const result = guardFollowUpTimeframe({ details: "x" }, others, "no time words here");
      expect(result.emptied, key).toEqual([]);
    }
  });
});
