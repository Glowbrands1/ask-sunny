import { describe, expect, it } from "vitest";

import { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } from "./__fixtures__/jba-policy-manual";
import {
  buildPolicyManualNote,
  isManualOverviewQuestion,
  namesOfficialPolicyManual,
  selectPolicyManualCoverage,
} from "./policy-manual-coverage";

/**
 * ============================================================================
 * WHICH PART OF THE JBA MANUAL A QUESTION IS GIVEN
 * ============================================================================
 *
 * Run against the manual's real chunk layout — all 110 chunks, with the pages
 * and headings ingestion recorded — so the selections asserted here are the
 * ones the live knowledge base would produce.
 *
 * The three questions are the ones asked of the live app:
 *
 *   "what's the smoking policy?"                                   worked
 *   "What policies and topics are in the JBA Policy Manual? ..."   failed
 *   "In the JBA Policy Manual Edited 5.2025, what does the
 *    attendance or tardiness policy say? Cite the section and page." failed
 */

const OVERVIEW =
  "What policies and topics are in the JBA Policy Manual? Give me an overview of its main sections, with citations from the manual.";
const ATTENDANCE =
  "In the JBA Policy Manual Edited 5.2025, what does the attendance or tardiness policy say? Cite the section and page.";
const SMOKING = "what's the smoking policy?";
const SMOKING_TYPO = "Does JCB policy have the smoking policy?";

function select(question: string) {
  return selectPolicyManualCoverage({
    question,
    documentId: JBA_MANUAL_DOCUMENT.id,
    documentTitle: JBA_MANUAL_DOCUMENT.title,
    documentCategory: JBA_MANUAL_DOCUMENT.category,
    chunks: JBA_MANUAL_CHUNKS,
  });
}

const chunk = (index: number) => JBA_MANUAL_CHUNKS.find((entry) => entry.chunkIndex === index)!;

/* ================================================== what the manual holds */

describe("0. what the manual actually contains", () => {
  it("has an Attendance section on printed page 14, and it governs tardiness", () => {
    /*
     * VERIFIED, NOT ASSUMED. The heading, its page and the tardiness rule are
     * all in the indexed text — so an answer that says the manual has no
     * attendance policy is wrong, and one that cites Attendance, page 14 is
     * right.
     */
    const attendance = chunk(33);
    expect(attendance.locator).toBe("Page 14 — Attendance");
    expect(attendance.sections).toEqual([{ heading: "Attendance", page: 14 }]);
    expect(attendance.content).toContain(
      "It is the responsibility of each employee to know his or her work schedule and to always be on\ntime.",
    );
    expect(attendance.content).toContain("If an employee is going to be tardy or absent");
  });

  it("has no section headed tardiness — the rule lives under Attendance", () => {
    const headings = JBA_MANUAL_CHUNKS.flatMap((entry) => entry.sections ?? []).map(
      (section) => section.heading.toLowerCase(),
    );
    expect(headings.some((heading) => /tard/.test(heading))).toBe(false);
    expect(headings).toContain("attendance");
  });

  it("prints its Smoking/Vaping rule on page 12", () => {
    expect(chunk(27).locator).toBe("Page 12 — Smoking/Vaping");
    expect(chunk(27).content).toContain("All locations,\nincluding but not limited to all facilities");
  });

  it("spreads its table of contents over fifteen chunks, printed pages 2 to 5", () => {
    const contents = JBA_MANUAL_CHUNKS.filter((entry) => entry.chunkIndex >= 2 && entry.chunkIndex <= 16);
    expect(contents).toHaveLength(15);
    expect(new Set(contents.map((entry) => entry.printedPage))).toEqual(new Set([2, 3, 4, 5]));
  });
});

/* ======================================================= the gate itself */

describe("1. only a question that names the JBA manual reads it by identity", () => {
  it.each([OVERVIEW, ATTENDANCE, "Does the JBA manual cover dress code?", "JB & Associates handbook PTO rules"])(
    "%s names it",
    (question) => {
      expect(namesOfficialPolicyManual(question)).toBe(true);
    },
  );

  it.each([SMOKING, SMOKING_TYPO, "What does JBA policy say about breaks?", "Open the policy manual"])(
    "%s does not, and keeps ordinary retrieval",
    (question) => {
      expect(namesOfficialPolicyManual(question)).toBe(false);
    },
  );

  it("tells a whole-manual question from a topic question", () => {
    expect(isManualOverviewQuestion(OVERVIEW)).toBe(true);
    expect(isManualOverviewQuestion("What's in the JBA manual?")).toBe(true);
    expect(isManualOverviewQuestion("What does the JBA manual cover?")).toBe(true);
    expect(isManualOverviewQuestion(ATTENDANCE)).toBe(false);
    expect(isManualOverviewQuestion("What does the JBA manual say about smoking?")).toBe(false);
  });
});

/* ======================================================= whole manual */

describe("2. a whole-manual question gets the complete table of contents", () => {
  it("pins every contents chunk, and nothing else", () => {
    const coverage = select(OVERVIEW);

    expect(coverage?.kind).toBe("contents");
    expect(coverage!.rows.map((row) => row.chunk_id)).toEqual(
      Array.from({ length: 15 }, (_, index) => `jba-${index + 2}`),
    );
  });

  it("does not hand the model the cover, the introduction or a stray page as the contents", () => {
    const ids = select(OVERVIEW)!.rows.map((row) => row.chunk_id);
    expect(ids).not.toContain("jba-0");
    expect(ids).not.toContain("jba-1");
    expect(ids).not.toContain("jba-64");
  });

  it("keeps each row's own document, locator and text, unscored", () => {
    const [first] = select(OVERVIEW)!.rows;
    expect(first).toMatchObject({
      document_id: JBA_MANUAL_DOCUMENT.id,
      document_title: "JBA Policy Manual Edited 5.2025",
      category: "operations",
      locator: "Page 2 — Table of Contents",
      similarity: 0,
    });
    expect(first!.content).toBe(chunk(2).content);
  });

  it("tells the model the contents are complete and an unretrieved section is not missing", () => {
    const coverage = select(OVERVIEW)!;
    const note = buildPolicyManualNote(coverage, [1, 2, 3])!;

    expect(note).toContain("COMPLETE TABLE OF CONTENTS");
    expect(note).toContain("Sources [S1], [S2], [S3] are the complete table of contents");
    expect(note).toContain("never call it missing, unavailable or not covered");
    expect(note).toContain("Do not state what a section requires unless that section's own text");
  });
});

/* ======================================================= topic question */

describe("3. a topic question gets the sections whose headings match it", () => {
  it("pins Attendance, page 14, for the attendance or tardiness question", () => {
    const coverage = select(ATTENDANCE);

    expect(coverage?.kind).toBe("sections");
    if (coverage?.kind !== "sections") return;
    expect(coverage.rows[0]).toMatchObject({
      chunk_id: "jba-33",
      locator: "Page 14 — Attendance",
      document_title: "JBA Policy Manual Edited 5.2025",
    });
    expect(coverage.sections).toContainEqual({ heading: "Attendance", page: 14 });
  });

  it("does not pin the title page, the introduction or any unrelated page", () => {
    const ids = select(ATTENDANCE)!.rows.map((row) => row.chunk_id);
    expect(ids).not.toContain("jba-0");
    expect(ids).not.toContain("jba-1");
    expect(ids).not.toContain("jba-64");
    // Only sections headed with the topic: Attendance and Seminar/Webinar Attendance.
    expect(ids).toEqual(["jba-33", "jba-82"]);
  });

  it("names the matched section and page for the model, and keeps other documents apart", () => {
    const note = buildPolicyManualNote(select(ATTENDANCE)!, [1, 2])!;

    expect(note).toContain("Attendance (page 14)");
    expect(note).toContain("They are sources [S1], [S2]");
    expect(note).toContain("Do not say the manual as a whole is silent");
    expect(note).toContain("never present it as the manual's policy");
  });

  it("finds the smoking rule on page 12 when the manual is named", () => {
    const coverage = select("What does the JBA Policy Manual say about smoking?");

    expect(coverage?.kind).toBe("sections");
    if (coverage?.kind !== "sections") return;
    expect(coverage.sections).toContainEqual({ heading: "Smoking/Vaping", page: 12 });
    expect(coverage.rows.map((row) => row.locator)).toContain("Page 12 — Smoking/Vaping");
  });

  it("never matches on prose: a word only the body uses falls back to the contents", () => {
    /*
     * "absenteeism" is in the Attendance text, not in any heading. Pinning
     * from prose is how a confident citation of the wrong section happens, so
     * the answer gets the contents instead, and is told no heading matched.
     */
    const coverage = select("Does the JBA manual have an absenteeism policy?");

    expect(coverage).toMatchObject({ kind: "contents", unmatchedTopic: true });
    expect(buildPolicyManualNote(coverage!, [1])).toContain("none matched it");
  });
});

/* ======================================================= failing closed */

describe("4. nothing is claimed that was not pinned", () => {
  it("writes no note when no row reached the prompt", () => {
    expect(buildPolicyManualNote(select(OVERVIEW)!, [])).toBeNull();
  });

  it("pins nothing for rows it cannot cite", () => {
    const uncitable = JBA_MANUAL_CHUNKS.map((entry) => ({
      ...entry,
      chunkId: undefined,
      locator: undefined,
    }));
    expect(
      selectPolicyManualCoverage({
        question: OVERVIEW,
        documentId: JBA_MANUAL_DOCUMENT.id,
        documentTitle: JBA_MANUAL_DOCUMENT.title,
        chunks: uncitable,
      }),
    ).toBeNull();
  });
});
