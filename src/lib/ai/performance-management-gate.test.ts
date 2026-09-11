import { describe, expect, it } from "vitest";

import { isPerformanceManagementQuestion } from "./performance-management-gate";

/**
 * ============================================================================
 * A FAIL-CLOSED GATE IS JUDGED ON ITS FALSE POSITIVES
 * ============================================================================
 *
 * When this gate fires and the Performance Management Framework cannot be
 * validated, `answerQuestion` REFUSES without calling the model. That makes the
 * two errors asymmetric in the opposite direction from most keyword gates here:
 *
 *   A MISS costs a worse answer — a progression described from general
 *   knowledge rather than from Sun Tan City's.
 *
 *   A FALSE POSITIVE costs a REFUSAL — a question the corpus answers perfectly
 *   comes back as "the framework is unavailable".
 *
 * So the negative matrix below is the more important half of this file, and it
 * is deliberately full of the questions managers actually ask all day.
 */

describe("it fires on the framework's own subject", () => {
  it.each([
    "corrective action",
    "what is our corrective action process?",
    "walk me through corrective actions",
    "how does performance management work here?",
    "do we use progressive discipline?",
    "explain the Management Diamond",
    "what is the escalation path for a repeat issue?",
    "what is the coaching progression?",
  ])("%s", (question) => {
    expect(isPerformanceManagementQuestion(question)).toBe(true);
  });

  it("fires even when the sentence has the shape of a lookup", () => {
    /*
     * "Where do I find our corrective action process?" is a lookup by shape, and
     * the framework IS the document being looked for. Suppressing it there would
     * answer a question about the ladder without the ladder.
     */
    expect(isPerformanceManagementQuestion("where do I find our corrective action process?")).toBe(
      true,
    );
  });
});

describe("it fires on a rung plus a question about which rung applies", () => {
  it.each([
    "when should I put someone on an EPP?",
    "should I go straight to a written warning?",
    "what comes after a DPOA?",
    "do I need to coach her again before an EPP?",
    "how many warnings before termination?",
    "is it time for a DPOA?",
    "what is the next step after follow-up coaching?",
    "can I skip straight to a final warning?",
    "what are the steps for discipline?",
  ])("%s", (question) => {
    expect(isPerformanceManagementQuestion(question)).toBe(true);
  });

  it("needs BOTH halves — a rung alone is not enough", () => {
    // Named a rung, asked no decision: a lookup or a creation request, both of
    // which are answered elsewhere without the framework.
    expect(isPerformanceManagementQuestion("create a DPOA for Sarah")).toBe(false);
    expect(isPerformanceManagementQuestion("where is the coaching form?")).toBe(false);
    expect(isPerformanceManagementQuestion("print the EPP")).toBe(false);
  });

  it("needs BOTH halves — a decision alone is not enough", () => {
    expect(isPerformanceManagementQuestion("when should I order more lotion?")).toBe(false);
    expect(isPerformanceManagementQuestion("should I close early on Christmas Eve?")).toBe(false);
    expect(isPerformanceManagementQuestion("what comes after the opening checklist?")).toBe(
      false,
    );
  });
});

describe("it does NOT fire on ordinary work — the refusal matrix", () => {
  it.each([
    // Policy and document lookups. These are what retrieval is for, and a
    // refusal here would break a working answer.
    "what does the disciplinary policy say?",
    "where can I find the discipline policy?",
    "what is the attendance policy?",
    "what does the handbook say about dress code?",
    "show me the cash handling procedure",
    "which policy covers age verification?",
    // A lookup that names a rung AND asks a decision is still a lookup.
    "what does the policy say about when I should write someone up?",
    // Operations, reporting, sales, equipment — the rest of the product.
    "what should I focus on in today's Daily Stats?",
    "how do I replace a lamp?",
    "why is spa conversion down at KS Manhattan?",
    "what is the membership cancellation process?",
    "rank my team by conversion",
    "who should I recognise this week?",
    "how do I read the weekly scorecard?",
    "what time does the salon open on Sunday?",
  ])("%s", (question) => {
    expect(isPerformanceManagementQuestion(question)).toBe(false);
  });

  it("does not fire on an empty or whitespace question", () => {
    expect(isPerformanceManagementQuestion("")).toBe(false);
    expect(isPerformanceManagementQuestion("   ")).toBe(false);
  });
});

/*
 * ============================================================================
 * THE ROLE'S REQUIRED SECTIONS ARE TESTED AGAINST THE REAL DOCUMENT
 * ============================================================================
 *
 * They used to be tested here, against a hand-written list of locators called
 * REAL_LOCATORS. That list was not real: it contained "SECTION 3 – COACHING
 * FRAMEWORK", "SECTION 5 – EPP FRAMEWORK", "SECTION 6 – DPOA FRAMEWORK" and
 * "SECTION 8 – FOLLOW-UP DOCUMENTATION FRAMEWORK", none of which the extractor
 * produces — a section heading followed immediately by its first sub-heading
 * emits no chunk at all.
 *
 * So the assertions passed against a document that does not exist. They now live
 * in `knowledge/performance-management-role.test.ts`, which runs the uploaded
 * framework through `extractFromString` and matches the groups against the
 * locators it really emits — including a check that no declared heading matches
 * nothing, which is what would have caught the invented four.
 *
 * This file is about the GATE: which questions require the framework, and
 * — more importantly under fail-closed grounding — which do not.
 */
