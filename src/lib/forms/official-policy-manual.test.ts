import { describe, expect, it } from "vitest";

import {
  OFFENSE_MANUAL_SECTIONS,
  OFFICIAL_POLICY_MANUAL,
  findManualSection,
  isManagementTitle,
  manualSectionFor,
  manualSectionsFor,
  officialManualReference,
  pageHeadingOf,
  resolvePolicyManual,
  type ManualCandidateDocument,
  type ManualChunk,
} from "./official-policy-manual";

/**
 * ============================================================================
 * THE FIXTURES ARE THE REAL MANUAL'S SHAPES
 * ============================================================================
 *
 * Every chunk below is the opening of an actual indexed chunk of the Driven to
 * Shine Policy Manual, with its real chunk index and its real extracted text —
 * the running title, the printed page footer, the heading, and enough of the
 * body to be the thing being matched against. Bodies are truncated; nothing is
 * reworded.
 *
 * THAT IS THE POINT OF THEM. A hand-written fixture in the shape this parser
 * happens to want would prove only that the parser parses itself. These are the
 * shapes that actually broke a naive match: the contents page that lists every
 * heading in the manual, the sentence in Schedule Requests that contains the
 * word "absenteeism", and the continuation chunk whose first line after the
 * footer is prose rather than a heading.
 */

const TABLE_OF_CONTENTS: ManualChunk = {
  chunkIndex: 1,
  page: 2,
  content:
    "Driven to Shine Policy Manual - 1 - Table of Contents Page Table of Contents 1 " +
    "Driven to Shine Introduction Statement 2 Mission Statement and Motto 3 " +
    "Sun Tan City Integrity Guide - Standards of Conduct 7 " +
    "Dress for Success - Store Management 11 Dress for Success - Tanning Consultant 12 " +
    "Personal Hygiene, Body Art, Piercings, Hair 13 " +
    "Salaried Manager Attendance, Schedule Requirements 13 " +
    "Hourly Employee Attendance, Schedule Requirements 14 " +
    "Schedule Requests - Trading Shifts 15 Absenteeism 15 " +
    "On-Call Shifts - Emergency Closings 16",
};

/** A sheet that opens with prose, not a heading. */
const CONTINUATION: ManualChunk = {
  chunkIndex: 13,
  page: 8,
  content:
    "Driven to Shine Policy Manual\n- 7 -\nemployment has ceased. Any information learned or" +
    " gained during employment is the property of THE COMPANY\nand is to be used solely for" +
    " the benefit of said company.",
};

const STORE_MANAGEMENT: ManualChunk = {
  chunkIndex: 25,
  page: 12,
  content:
    "Driven to Shine Policy Manual\n- 11 -\nDress for Success - Store Management\nTHE COMPANY" +
    " encourages all store management to distinguish their position through their professional" +
    " work\nappearance.",
};

/** The middle of the Store Management sheet. No footer, no heading. */
const UNIFORM_OPTIONS: ManualChunk = {
  chunkIndex: 26,
  page: 12,
  content:
    "• Is considered a part of dress code and failure to adhere will result in the" +
    " above-mentioned disciplinary\nprocess.\n\nUniform Options\n• Must be clean, with no rips" +
    " or holes, and wrinkle free.",
};

const TANNING_CONSULTANT: ManualChunk = {
  chunkIndex: 27,
  page: 13,
  content:
    "Driven to Shine Policy Manual\n- 12 -\nDress for Success - Tanning Consultant\nNo dress code" +
    " can cover all contingencies, so employees must exert a certain amount of judgment in their" +
    " choice\nof clothing to wear to work.",
};

/** The sentence that would answer a loose search for the Absenteeism section. */
const SCHEDULE_REQUESTS: ManualChunk = {
  chunkIndex: 35,
  page: 16,
  content:
    "§ Full-time managers, full-time non-mangers, and part-time non-managers will not clock out" +
    " more than half hour\nafter scheduled time without verbal consent from direct supervisor." +
    "\n\n§ Employees must know his/her own schedule and arrive on time. Lack of punctuality or" +
    " absenteeism has a\nnegative impact on everyone's schedule.",
};

/** The real Absenteeism section — introduced mid-sheet, mid-line. */
const ABSENTEEISM: ManualChunk = {
  chunkIndex: 36,
  page: 16,
  content:
    "§ The employee must speak to their supervisor directly.\n\nCommunication through text or" +
    " other employees are not\nvalid means to relay information and are strictly prohibited." +
    " Absenteeism\n§ An absent employee may be asked to provide a Doctor's note by direct" +
    " supervisor.",
};

const MANUAL: ManualChunk[] = [
  TABLE_OF_CONTENTS,
  CONTINUATION,
  STORE_MANAGEMENT,
  UNIFORM_OPTIONS,
  TANNING_CONSULTANT,
  SCHEDULE_REQUESTS,
  ABSENTEEISM,
];

const TITLE = "Driven to Shine Policy Manual 2.2025";

describe("1. reading a sheet's own heading and page", () => {
  it("reads the page the MANUAL prints, not the page of the PDF", () => {
    /*
     * THE WHOLE CITATION, IN ONE ASSERTION. This chunk is the PDF's thirteenth
     * sheet and the manual prints "- 12 -" at the top of it. The business cites
     * page 12, so the printed number is the one that is read.
     */
    expect(pageHeadingOf(TANNING_CONSULTANT.content)).toEqual({
      page: 12,
      heading: "Dress for Success - Tanning Consultant",
    });
    expect(TANNING_CONSULTANT.page).toBe(13);
  });

  it("offers nothing a section could be matched against on a continued sheet", () => {
    /*
     * The line after this footer is a continued sentence. It is far too long to
     * be a heading and is rejected outright — but the guarantee does not rest
     * on its length: `findManualSection` compares for EQUALITY against the
     * heading it was asked for, so no sentence can ever be mistaken for one.
     */
    expect(pageHeadingOf(CONTINUATION.content)).toBeNull();
    expect(findManualSection([CONTINUATION], ["Confidentiality and Non-Disclosure Policy"]))
      .toBeNull();
  });

  it("will not accept a short prose line as a section either", () => {
    const shortProse: ManualChunk = {
      chunkIndex: 99,
      page: 40,
      content: "Driven to Shine Policy Manual\n- 39 -\nand must be worn at all times.\nCovid-19\n",
    };

    // A heading is only ever matched by EQUALITY, so the fragment cannot stand
    // in for the section that follows it.
    expect(findManualSection([shortProse], ["Covid-19"])).toBeNull();
  });

  it("says nothing for a chunk in the middle of a sheet", () => {
    expect(pageHeadingOf(UNIFORM_OPTIONS.content)).toBeNull();
    expect(pageHeadingOf(ABSENTEEISM.content)).toBeNull();
  });

  it("says nothing for the contents page", () => {
    // One long line with no newlines at all — there is no heading shape in it.
    expect(pageHeadingOf(TABLE_OF_CONTENTS.content)).toBeNull();
  });
});

describe("2. finding the section a ticked offense points at", () => {
  it("finds Dress for Success — Tanning Consultant at page 12", () => {
    expect(findManualSection(MANUAL, ["Dress for Success - Tanning Consultant"])).toEqual({
      heading: "Dress for Success - Tanning Consultant",
      page: 12,
      chunkIndex: 27,
      foundBy: "page_heading",
    });
  });

  /*
   * THE TWO TIERS AGREE WHERE BOTH APPLY, which is the check that the contents
   * page is a sound second source rather than a convenient one: the sheet's own
   * heading says page 12, and so does the manual's index.
   */
  it("reads the same page from the sheet and from the contents", () => {
    const fromSheet = findManualSection(MANUAL, ["Dress for Success - Tanning Consultant"]);
    const fromContents = findManualSection(
      [TABLE_OF_CONTENTS],
      ["Dress for Success - Tanning Consultant"],
    );

    expect(fromContents?.foundBy).toBe("contents");
    expect(fromContents?.page).toBe(fromSheet?.page);
  });

  it("finds the Store Management section separately, at its own page", () => {
    expect(findManualSection(MANUAL, ["Dress for Success - Store Management"])?.page).toBe(11);
  });

  it("absorbs punctuation drift in the heading it is asked for", () => {
    // An em dash where the manual prints a hyphen still resolves — a re-issue
    // that retypes the heading must not silently stop citing it.
    expect(
      findManualSection(MANUAL, ["Dress for Success — Tanning Consultant"])?.page,
    ).toBe(12);
  });

  it("prints the manual's own spelling, never the one it was asked for", () => {
    const section = findManualSection(MANUAL, ["dress for success — TANNING consultant"]);
    expect(section?.heading).toBe("Dress for Success - Tanning Consultant");
  });

  /*
   * ==========================================================================
   * THE TWO WAYS A LOOSE MATCH CITES THE WRONG PLACE
   * ==========================================================================
   *
   * Both of these are real chunks of the real manual, and both answered a
   * substring search. A citation of the contents page, or of a sentence in
   * Schedule Requests, is worse than a blank line: it looks checked.
   */
  it("never answers from prose that happens to contain the words", () => {
    /*
     * Both of these DO resolve — from the manual's own index, which is where
     * this document names them. What must never happen is that they resolve
     * from the sentence in Schedule Requests that contains the word
     * "absenteeism", or from the paragraph before the Standards of Conduct. So
     * the page each one comes back with is the index's, not the prose chunk's.
     */
    expect(findManualSection(MANUAL, ["Absenteeism"])).toEqual({
      heading: "Absenteeism",
      page: 15,
      chunkIndex: 1,
      foundBy: "contents",
    });
    expect(findManualSection(MANUAL, ["Standards of Conduct"])?.page).toBe(7);

    // The prose chunks sit on the PDF's sheet 16 and 8. Neither page was used.
    expect(SCHEDULE_REQUESTS.page).toBe(16);
  });

  it("resolves from the contents only when a sheet heading does not answer", () => {
    // Personal Hygiene opens a sheet in the real manual. In a corpus that has
    // only the contents page, the index still answers.
    expect(
      findManualSection([TABLE_OF_CONTENTS], ["Personal Hygiene, Body Art, Piercings, Hair"])?.page,
    ).toBe(13);
  });

  /*
   * ==========================================================================
   * A PARTIAL NAME RESOLVES TO NOTHING, AND THE PAGE NUMBER IS WHY
   * ==========================================================================
   *
   * A contents entry is its name followed immediately by its page, so a match
   * is only accepted when a number follows. "Attendance" is followed by
   * ", Schedule Requirements" in both attendance entries and therefore matches
   * neither — which is the difference between citing nothing and citing a
   * salaried manager's policy on a consultant's record.
   */
  it("refuses a partial section name rather than guessing which entry", () => {
    expect(findManualSection(MANUAL, ["Attendance"])).toBeNull();
    expect(findManualSection(MANUAL, ["Dress for Success"])).toBeNull();
  });

  it("refuses a name the contents page lists twice", () => {
    const twice: ManualChunk = {
      chunkIndex: 1,
      page: 2,
      content: "Table of Contents Page Break Policy 20 Break Policy 34",
    };

    expect(findManualSection([twice], ["Break Policy"])).toBeNull();
  });

  it("is null rather than approximate when the manual has no such heading", () => {
    expect(findManualSection(MANUAL, ["Footwear Policy"])).toBeNull();
    expect(findManualSection(MANUAL, [])).toBeNull();
  });
});

describe("3. the offense box decides which section", () => {
  it("gives a tanning consultant the consultant section", () => {
    const section = manualSectionFor({
      chunks: MANUAL,
      offenseKeys: ["dress_code"],
      jobTitle: "TC",
    });

    expect(officialManualReference(TITLE, section!)).toBe(
      "Driven to Shine Policy Manual 2.2025 — Dress for Success - Tanning Consultant, page 12",
    );
  });

  it("gives store management the management section", () => {
    const section = manualSectionFor({
      chunks: MANUAL,
      offenseKeys: ["dress_code"],
      jobTitle: "Salon Director",
    });

    expect(section?.heading).toBe("Dress for Success - Store Management");
    expect(section?.page).toBe(11);
  });

  it("treats an unknown job title as front-line, which is the commoner case", () => {
    const section = manualSectionFor({ chunks: MANUAL, offenseKeys: ["dress_code"] });
    expect(section?.heading).toBe("Dress for Success - Tanning Consultant");
  });

  it.each(["SD", "ASD", "DM", "District Manager", "Assistant Salon Director"])(
    "reads %s as management",
    (title) => {
      expect(isManagementTitle(title)).toBe(true);
    },
  );

  it.each(["TC", "Tanning Consultant", "FTTC", "Manager in training", "", null])(
    "does not read %s as management",
    (title) => {
      expect(isManagementTitle(title)).toBe(false);
    },
  );

  /*
   * ==========================================================================
   * WHAT IS DELIBERATELY NOT MAPPED
   * ==========================================================================
   *
   * These boxes produce no citation, so the field stays blank, the manager
   * completes it, and finalizing still asks for the acknowledgement. Asserted
   * rather than left implicit: a future edit that adds one of them should have
   * to delete a test that says why it was left out.
   */
  it.each(["under_performance", "company_policies", "other"])(
    "cites nothing for %s",
    (key) => {
      expect(OFFENSE_MANUAL_SECTIONS[key]).toBeUndefined();
      expect(manualSectionFor({ chunks: MANUAL, offenseKeys: [key] })).toBeNull();
    },
  );

  /*
   * ==========================================================================
   * THE ATTENDANCE SPLIT, WHICH IS THE REASON THE ROLE IS READ AT ALL
   * ==========================================================================
   *
   * The manual states a salaried manager's attendance requirements separately
   * from an hourly employee's. Citing the wrong one puts a policy on somebody's
   * record that does not govern them — a manager's 15-minute rule on a tanning
   * consultant's file, or the reverse.
   */
  it("cites the hourly attendance section for a consultant", () => {
    const section = manualSectionFor({
      chunks: MANUAL,
      offenseKeys: ["tardiness"],
      jobTitle: "TC",
    });

    expect(section).toEqual({
      heading: "Hourly Employee Attendance, Schedule Requirements",
      page: 14,
      chunkIndex: 1,
      foundBy: "contents",
    });
  });

  it("cites the salaried attendance section for a manager", () => {
    const section = manualSectionFor({
      chunks: MANUAL,
      offenseKeys: ["tardiness"],
      jobTitle: "Salon Director",
    });

    expect(section?.heading).toBe("Salaried Manager Attendance, Schedule Requirements");
    expect(section?.page).toBe(13);
  });

  it("cites Absenteeism and the Standards of Conduct at the manual's own pages", () => {
    expect(manualSectionFor({ chunks: MANUAL, offenseKeys: ["absenteeism"] })).toMatchObject({
      heading: "Absenteeism",
      page: 15,
    });
    expect(
      manualSectionFor({ chunks: MANUAL, offenseKeys: ["standards_of_conduct"] }),
    ).toMatchObject({
      heading: "Sun Tan City Integrity Guide - Standards of Conduct",
      page: 7,
    });
  });

  /*
   * ==========================================================================
   * A DRESS CODE FORM SAYS NOTHING ABOUT ATTENDANCE
   * ==========================================================================
   *
   * The business's words: "of course you don't cite them if the violation is
   * only about dress code." The mapping is per ticked box, so this is already
   * how it behaves — asserted because it is the property that makes citing the
   * other sections safe at all.
   */
  it("cites only what was ticked", () => {
    const reference = officialManualReference(
      TITLE,
      manualSectionsFor({ chunks: MANUAL, offenseKeys: ["dress_code"] }),
    );

    expect(reference).toBe(
      "Driven to Shine Policy Manual 2.2025 — Dress for Success - Tanning Consultant, page 12",
    );
    expect(reference).not.toMatch(/attendance|absenteeism|conduct/i);
  });

  it("cites each section when several boxes were ticked", () => {
    const sections = manualSectionsFor({
      chunks: MANUAL,
      offenseKeys: ["dress_code", "absenteeism"],
    });

    expect(officialManualReference(TITLE, sections)).toBe(
      "Driven to Shine Policy Manual 2.2025 —" +
        " Dress for Success - Tanning Consultant, page 12; Absenteeism, page 15",
    );
  });

  it("skips a ticked box the manual does not state, and cites the rest", () => {
    const sections = manualSectionsFor({
      chunks: MANUAL,
      offenseKeys: ["under_performance", "dress_code"],
    });

    expect(sections).toHaveLength(1);
    expect(sections[0]!.heading).toBe("Dress for Success - Tanning Consultant");
  });
});

describe("4. which document is the manual", () => {
  it("is identified by a tag, with the filename only as a fallback", () => {
    expect(OFFICIAL_POLICY_MANUAL.tag).toBe("official-policy-manual");
    expect(OFFICIAL_POLICY_MANUAL.fallbackTitles).toContain("Driven to Shine Policy Manual");
  });

  /*
   * THE FALLBACK IS A PREFIX, because the version is in the title. "Driven to
   * Shine Policy Manual 2.2025" is this year's; pinning the whole string would
   * mean the citation stopped working the day the manual was re-issued.
   */
  it("names the manual without pinning its version", () => {
    for (const title of OFFICIAL_POLICY_MANUAL.fallbackTitles) {
      expect(title).not.toMatch(/\d\.\d{4}/);
    }
  });
});

/**
 * ============================================================================
 * 5. WHICH DOCUMENT IS THE MANUAL
 * ============================================================================
 *
 * The candidates below are the live corpus's own rows — the manual, the other
 * policy manual filed beside it, and the training manuals whose titles are the
 * nearest misses. None of them is tagged today, so the fallback is what is
 * actually running, and the fallback is what these exercise.
 */
describe("5. resolving the manual out of a real corpus", () => {
  const doc = (
    title: string,
    original_filename: string,
    tags: string[] = [],
  ): ManualCandidateDocument => ({ id: title, title, original_filename, tags });

  const CORPUS: ManualCandidateDocument[] = [
    doc("Driven to Shine Policy Manual 2.2025", "Driven-to-Shine-Policy-Manual-2.2025.pdf"),
    doc("JBA Policy Manual Edited 5.2025", "JBA-Policy-Manual-Edited-5.2025.pdf"),
    doc("Salon Director Manual 3.2026", "Salon-Director-Manual-3.2026.pdf"),
    doc("Tanning Consultant Manual 4.22.2026", "Tanning-Consultant-Manual-4.22.2026.pdf"),
    doc("Sun Tan City Safety Binder 2025 26   Franchise", "Sun-Tan-City-Safety-Binder.pdf"),
  ];

  it("finds it by title, past the version in the name", () => {
    const resolution = resolvePolicyManual(CORPUS);

    expect(resolution.ok).toBe(true);
    expect(resolution.ok && resolution.document.title).toBe("Driven to Shine Policy Manual 2.2025");
    expect(resolution.ok && resolution.matchedBy).toBe("fallback");
  });

  /*
   * THE VERSION IS THE REASON THE MATCH IS A PREFIX. An exact match would stop
   * citing the manual the day it was re-issued — the day a stale citation would
   * do the most harm.
   */
  it("keeps finding it when the manual is re-issued under a new number", () => {
    const reissued = [doc("Driven to Shine Policy Manual 1.2027", "Driven-to-Shine-Policy-Manual-1.2027.pdf")];

    expect(resolvePolicyManual(reissued).ok).toBe(true);
  });

  it("does not mistake another manual for it", () => {
    const others = CORPUS.filter((entry) => !entry.title.startsWith("Driven to Shine"));

    expect(resolvePolicyManual(others)).toEqual({ ok: false, problem: "not_found" });
  });

  it("prefers a tagged document outright, whatever it is called", () => {
    const tagged = [
      ...CORPUS,
      doc("Company Policy Manual 2027", "policy.pdf", ["official-policy-manual"]),
    ];
    const resolution = resolvePolicyManual(tagged);

    expect(resolution.ok && resolution.matchedBy).toBe("tag");
    expect(resolution.ok && resolution.document.title).toBe("Company Policy Manual 2027");
  });

  /*
   * AMBIGUITY IS A FAILURE, NOT A TIE TO BREAK. Two manuals means somebody
   * uploaded a replacement without retiring the original, and they will not
   * agree — quite possibly not on the page number. Citing whichever the
   * database returned first would put that on an employment record.
   */
  it("refuses rather than choosing between two candidates", () => {
    const both = [
      ...CORPUS,
      doc("Driven to Shine Policy Manual 3.2026", "Driven-to-Shine-Policy-Manual-3.2026.pdf"),
    ];

    expect(resolvePolicyManual(both)).toEqual({ ok: false, problem: "ambiguous" });
  });

  it("refuses two TAGGED candidates too, without falling through to the title", () => {
    const both = [
      doc("A", "a.pdf", ["official-policy-manual"]),
      doc("B", "b.pdf", ["official-policy-manual"]),
      ...CORPUS,
    ];

    expect(resolvePolicyManual(both)).toEqual({ ok: false, problem: "ambiguous" });
  });
});
