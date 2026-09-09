import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { extractFromString } from "@/lib/ingestion/extract/txt";

import {
  PERFORMANCE_MANAGEMENT_FRAMEWORK,
  headingKey,
  selectMandatoryChunks,
} from "./document-roles";

/**
 * ============================================================================
 * THE ROLE'S REQUIRED GROUPS, CHECKED AGAINST THE REAL DOCUMENT
 * ============================================================================
 *
 * Not against a fixture of what the document is believed to contain. The
 * uploaded framework is run through `extractFromString` — the same extractor
 * the ingestion pipeline uses — and the locators it really produces are what
 * the groups are matched against.
 *
 * WHY THAT DISTINCTION IS THE POINT OF THIS FILE. A fixture asserts that the
 * code agrees with itself. Running the extractor found something no fixture
 * would have: SIX of the ten `## SECTION n` headings produce NO CHUNK AT ALL,
 * because a section heading followed immediately by its first `### n.1`
 * sub-heading flushes an empty buffer and emits nothing.
 *
 * So "SECTION 3 – COACHING FRAMEWORK", "SECTION 5 – EPP FRAMEWORK",
 * "SECTION 6 – DPOA FRAMEWORK" and "SECTION 8 – FOLLOW-UP DOCUMENTATION
 * FRAMEWORK" are locators that DO NOT EXIST in the index. An earlier version of
 * this role led four of its groups with them. Every group still resolved,
 * through the sub-section alternatives beside them, so the role reported healthy
 * and the mistake was invisible — which is exactly the failure the group
 * mechanism exists to catch, surviving by luck.
 *
 * These tests are skipped rather than failed when the source file is not
 * present, because it is an uploaded artifact rather than a repository fixture,
 * and a suite that fails on a developer machine for want of it would be
 * disabled rather than fixed.
 */

const SOURCE =
  "/root/.claude/uploads/de482e4e-5b32-520c-adba-2ad4b5a95ac5/3878839a-ASK_SUNNY_PERFORMANCE_MANAGEMENT_FRAMEWORK_KB_TEXT.txt";

const available = existsSync(SOURCE);
const describeSource = available ? describe : describe.skip;

/** Every locator the extractor really produces, in document order. */
function realLocators(): { chunk_index: number; locator: string }[] {
  const doc = extractFromString(readFileSync(SOURCE, "utf8"));
  return doc.segments.map((segment, index) => ({
    chunk_index: index,
    locator: segment.locator,
  }));
}

describeSource("the required groups resolve against the real extracted corpus", () => {
  const chunks = realLocators();

  it("extracts a document of the expected shape", () => {
    // The guard on the guard: an empty or tiny extraction would make every
    // assertion below pass without reading the framework at all.
    expect(chunks.length).toBeGreaterThan(80);
  });

  it("is complete — every one of the twelve groups is represented", () => {
    const selection = selectMandatoryChunks(chunks, PERFORMANCE_MANAGEMENT_FRAMEWORK);

    expect(selection.missingGroups).toEqual([]);
    expect(selection.complete).toBe(true);
    expect(selection.presentGroups).toHaveLength(
      PERFORMANCE_MANAGEMENT_FRAMEWORK.ruleGroups.length,
    );
  });

  it("stays inside its own ceiling", () => {
    const selection = selectMandatoryChunks(chunks, PERFORMANCE_MANAGEMENT_FRAMEWORK);
    expect(selection.chunks.length).toBeLessThanOrEqual(
      PERFORMANCE_MANAGEMENT_FRAMEWORK.maxMandatoryChunks,
    );
    // And the ceiling has to be big enough for one chunk per group, or the
    // round-robin would report a group missing that the document contains.
    expect(PERFORMANCE_MANAGEMENT_FRAMEWORK.maxMandatoryChunks).toBeGreaterThanOrEqual(
      PERFORMANCE_MANAGEMENT_FRAMEWORK.ruleGroups.length,
    );
  });

  /**
   * ==========================================================================
   * EVERY DECLARED HEADING IS A HEADING THE EXTRACTOR REALLY PRODUCES
   * ==========================================================================
   *
   * The assertion that would have caught the absent `SECTION n` locators. A
   * group is allowed several spellings, and a spelling that matches nothing is
   * dead weight that makes the group look better protected than it is.
   */
  it("declares no heading that the document does not contain", () => {
    const present = new Set(chunks.map((chunk) => headingKey(chunk.locator)));

    const dead: string[] = [];
    for (const group of PERFORMANCE_MANAGEMENT_FRAMEWORK.ruleGroups) {
      for (const heading of group.headings) {
        if (!present.has(headingKey(heading))) dead.push(`${group.id}: ${heading}`);
      }
    }

    expect(dead, `headings matching no chunk:\n${dead.join("\n")}`).toEqual([]);
  });

  it("names the rules the rest of the system depends on", () => {
    const ids = PERFORMANCE_MANAGEMENT_FRAMEWORK.ruleGroups.map((group) => group.id);

    // Each of these is relied on somewhere else, so losing one silently would
    // make another part of the product unsafe rather than merely less good.
    expect(ids).toEqual(
      expect.arrayContaining([
        "escalation_authority",
        "escalation_ladder",
        "lowest_appropriate_rung",
        "issue_classification",
        "management_diamond",
        "coaching_framework",
        "epp_routing",
        "dpoa_routing",
        "exact_policy_verification",
        "follow_up_documentation",
        "manager_self_check",
        "final_operating_rule",
      ]),
    );
  });

  /**
   * ==========================================================================
   * EACH GROUP FAILS ON ITS OWN
   * ==========================================================================
   *
   * The property that makes twelve groups worth more than one flat list: a
   * re-upload that loses ONE rule is reported as incomplete rather than passing
   * because eleven others matched. Run per group, by removing exactly the chunks
   * that group accepts and asserting it — and only it — goes missing.
   */
  for (const group of PERFORMANCE_MANAGEMENT_FRAMEWORK.ruleGroups) {
    it(`reports "${group.id}" missing when the document loses it`, () => {
      const accepted = new Set(group.headings.map(headingKey));
      const without = chunks.filter((chunk) => !accepted.has(headingKey(chunk.locator)));

      const selection = selectMandatoryChunks(without, PERFORMANCE_MANAGEMENT_FRAMEWORK);

      expect(selection.complete).toBe(false);
      expect(selection.missingGroups).toContain(group.id);
    });
  }
});

describe("the role's identity", () => {
  it("prefers the durable tag, with the filename only as a bridge", () => {
    expect(PERFORMANCE_MANAGEMENT_FRAMEWORK.tag).toBe("performance-management-framework");
    expect(PERFORMANCE_MANAGEMENT_FRAMEWORK.fallbackFilenames).toContain(
      "ASK_SUNNY_PERFORMANCE_MANAGEMENT_FRAMEWORK_KB_TEXT.txt",
    );
  });

  it("absorbs the numbering and the en dash the real headings use", () => {
    expect(headingKey("SECTION 2 – PERFORMANCE MANAGEMENT LADDER")).toBe(
      "performance management ladder",
    );
    // And keeps genuinely different rules apart, which is what stops a document
    // satisfying a group it does not contain.
    expect(headingKey("10.6 Manager self-check before sending or saying anything")).not.toBe(
      headingKey("10.7 Final operating rule for Ask Sunny"),
    );
  });
});
