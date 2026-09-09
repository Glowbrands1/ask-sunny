import { describe, expect, it } from "vitest";

import { isPerformanceManagementQuestion } from "./performance-management-gate";
import {
  PERFORMANCE_MANAGEMENT_FRAMEWORK,
  headingKey,
  selectMandatoryChunks,
} from "@/lib/knowledge/document-roles";

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
    "why is spa conversion down at Riverbend?",
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

/* ==================================================================== */
/*  THE ROLE'S REQUIRED SECTIONS                                        */
/* ==================================================================== */

/**
 * ============================================================================
 * IDENTITY AND CONTENT ARE CHECKED SEPARATELY, AND BOTH HAVE TO PASS
 * ============================================================================
 *
 * A correctly tagged document proves nothing about whether a re-upload kept the
 * headings the extractor turns into locators. These assert the CONTENT half:
 * that the rule groups match the framework's real heading texts, and that a
 * document missing one of them is not pinned.
 *
 * The locators used here are the ones `extractFromString` actually produces from
 * the supplied `.txt` — it splits on Markdown ATX headings and makes the heading
 * text the locator, so `## SECTION 2 – PERFORMANCE MANAGEMENT LADDER` becomes
 * exactly that string, en dash and all.
 */
function chunk(index: number, locator: string) {
  return { chunk_index: index, locator };
}

const REAL_LOCATORS = [
  "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK",
  "SECTION 2 – PERFORMANCE MANAGEMENT LADDER",
  "2.3 Role Play",
  "SECTION 3 – COACHING FRAMEWORK",
  "SECTION 5 – EPP FRAMEWORK",
  "SECTION 6 – DPOA FRAMEWORK",
  "SECTION 8 – FOLLOW-UP DOCUMENTATION FRAMEWORK",
  "SECTION 7 – COMMON PERFORMANCE ISSUES",
];

describe("the framework's required sections", () => {
  it("absorbs the SECTION prefix and the en dash the real headings use", () => {
    expect(headingKey("SECTION 2 – PERFORMANCE MANAGEMENT LADDER")).toBe(
      "performance management ladder",
    );
    expect(headingKey("## SECTION 6 – DPOA FRAMEWORK")).toBe("dpoa framework");
    // And keeps genuinely different headings apart.
    expect(headingKey("SECTION 5 – EPP FRAMEWORK")).not.toBe(
      headingKey("SECTION 6 – DPOA FRAMEWORK"),
    );
  });

  it("is complete against the document's real headings", () => {
    const selection = selectMandatoryChunks(
      REAL_LOCATORS.map((locator, index) => chunk(index, locator)),
      PERFORMANCE_MANAGEMENT_FRAMEWORK,
    );

    expect(selection.missingGroups).toEqual([]);
    expect(selection.complete).toBe(true);
    expect(selection.chunks.length).toBeLessThanOrEqual(
      PERFORMANCE_MANAGEMENT_FRAMEWORK.maxMandatoryChunks,
    );
  });

  it("pins nothing it was not asked for", () => {
    const selection = selectMandatoryChunks(
      REAL_LOCATORS.map((locator, index) => chunk(index, locator)),
      PERFORMANCE_MANAGEMENT_FRAMEWORK,
    );
    // "COMMON PERFORMANCE ISSUES" is question-dependent detail, which is what
    // retrieval is for — it is not a rule group and must not be pinned.
    expect(selection.chunks.map((entry) => entry.locator)).not.toContain(
      "SECTION 7 – COMMON PERFORMANCE ISSUES",
    );
  });

  it("is INCOMPLETE when the ladder is missing, which is what refuses the turn", () => {
    /*
     * The failure this guards: a re-export that demotes the ladder's heading
     * resolves as the right document while the sequence silently vanishes. A
     * flat list of headings would have reported that set as fine.
     */
    const withoutLadder = REAL_LOCATORS.filter(
      (locator) => !locator.includes("PERFORMANCE MANAGEMENT LADDER") && locator !== "2.3 Role Play",
    );
    const selection = selectMandatoryChunks(
      withoutLadder.map((locator, index) => chunk(index, locator)),
      PERFORMANCE_MANAGEMENT_FRAMEWORK,
    );

    expect(selection.complete).toBe(false);
    expect(selection.missingGroups).toContain("escalation_ladder");
  });

  it("is INCOMPLETE when the leadership escalation rule is missing", () => {
    const withoutPreamble = REAL_LOCATORS.filter(
      (locator) => locator !== "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK",
    );
    const selection = selectMandatoryChunks(
      withoutPreamble.map((locator, index) => chunk(index, locator)),
      PERFORMANCE_MANAGEMENT_FRAMEWORK,
    );

    expect(selection.complete).toBe(false);
    expect(selection.missingGroups).toContain("escalation_authority");
  });

  it("prefers the durable tag over the filename", () => {
    // The tag is the mechanism; the filename is a migration bridge. Asserted
    // here so the framework's identity survives a tidied re-upload.
    expect(PERFORMANCE_MANAGEMENT_FRAMEWORK.tag).toBe("performance-management-framework");
    expect(PERFORMANCE_MANAGEMENT_FRAMEWORK.fallbackFilenames).toContain(
      "ASK_SUNNY_PERFORMANCE_MANAGEMENT_FRAMEWORK_KB_TEXT.txt",
    );
  });
});
