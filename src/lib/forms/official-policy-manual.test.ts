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
 * Every chunk below is an actual indexed chunk of the JB & Associates
 * Employment Policy Manual, with its real chunk index, its real PDF page and
 * its real extracted text — the Word footer, the heading, and enough of the
 * body to be the thing being matched against. Bodies are truncated; nothing is
 * reworded.
 *
 * THAT IS THE POINT OF THEM. A hand-written fixture in the shape this parser
 * happens to want would prove only that the parser parses itself. These are the
 * shapes that actually break a naive match: the contents page that lists every
 * heading in the manual, the sentence in Attendance that contains the word
 * "absenteeism", the bullet list that continues a section across a sheet, and
 * the older chunk whose heading was packed onto the end of a sentence.
 *
 * ============================================================================
 * TWO GENERATIONS OF CHUNK, AND BOTH ARE HERE ON PURPOSE
 * ============================================================================
 *
 * PDF extraction used to emit one segment per sheet, so an oversized page was
 * split by sentence and rejoined — which packed a heading onto the end of the
 * sentence before it ("...at its discretion. Attendance"). Those rows are still
 * in the corpus until the document is re-indexed, and a heading buried mid-line
 * is NOT citable: it resolves to nothing and the manager fills the line, which
 * is the safe failure.
 *
 * Extraction now splits a sheet at its headings, so the heading opens its own
 * chunk and `section` carries it outright. Both generations are asserted below,
 * because "what the corpus holds today" and "what it holds after a re-index"
 * are different questions and both have to be answered honestly.
 */

/* ------------------------------------------------ re-indexed chunks (new) --- */

const STANDARDS_OF_CONDUCT: ManualChunk = {
  chunkIndex: 29,
  page: 13,
  section: "Standards of Conduct",
  content:
    "Standards of Conduct\nThe Company expects Employees to follow rules of conduct that will" +
    " protect the interests and\nsafety of all customers, Employees, and The Company.\n\nThe" +
    " following are examples (non-inclusive list) of infractions that may result in disciplinary" +
    "\naction, up to and including transfer, suspension with or without pay, demotion, or" +
    " immediate\ntermination of employment",
};

/**
 * The section both attendance boxes cite. Note the word "absenteeism" sitting
 * in its prose — the thing a loose search would answer from.
 */
const ATTENDANCE: ManualChunk = {
  chunkIndex: 33,
  page: 15,
  section: "Attendance",
  content:
    "Attendance\nIt is the responsibility of each employee to know his or her work schedule and to" +
    " always be on\ntime. Lack of punctuality or absenteeism has a negative impact on everyone's" +
    " schedule and\ncreates a lack of service for the client.",
};

const DRESS_CODE: ManualChunk = {
  chunkIndex: 36,
  page: 16,
  section: "Dress Code for The Company",
  content:
    "Dress Code for The Company\nThe Company Employees are to keep a neat, clean, professional" +
    " appearance at all times. Anyone\nviolating their Brand's Dress code policy will be sent home" +
    " to change into proper work attire and\nmay be subject to disciplinary action, up to and" +
    " potentially including termination.",
};

/** A brand sub-section of the dress code. Deliberately never cited. */
const SUN_TAN_CITY_SHIRTS: ManualChunk = {
  chunkIndex: 40,
  page: 18,
  section: "Shirts",
  content:
    "Shirts\no Any STC Employee can wear any Branded top or black collared or black t-shirt.\no ASD" +
    " and above can wear any colored collared shirt.",
};

/** A sheet that continues a section: bullets, no heading of its own. */
const CONDUCT_CONTINUED: ManualChunk = {
  chunkIndex: 31,
  page: 14,
  section: "Standards of Conduct",
  content:
    "o Fighting or threatening violence in the workplace\no Boisterous or disruptive activity in the" +
    " workplace\no Threatened or actual injury of another Employee or customer\no Insubordination" +
    " -the refusal to follow the directions of the manager.",
};

/**
 * The contents page. It lists EVERY heading in the manual against the printed
 * page numbers, which are one less than the PDF's throughout this document —
 * so it is both the classic false-positive and a source of wrong numbers.
 */
const TABLE_OF_CONTENTS: ManualChunk = {
  chunkIndex: 2,
  page: 3,
  section: "Table of Contents",
  content:
    "2 | P a g e\nTable of Contents\nThe Company Employment Policy Manual ................ 1\n" +
    "Standards of Conduct .................................. 12\n" +
    "Disciplinary Action ................................... 14\n" +
    "Attendance ............................................ 14\n" +
    "Late Opening .......................................... 15\n" +
    "Dress Code for The Company ............................ 15\n" +
    "All Locations Dress Code: ............................. 15\n",
};

const MANUAL: ManualChunk[] = [
  TABLE_OF_CONTENTS,
  STANDARDS_OF_CONDUCT,
  CONDUCT_CONTINUED,
  ATTENDANCE,
  DRESS_CODE,
  SUN_TAN_CITY_SHIRTS,
];

/* ------------------------------------------------- chunks as indexed today --- */

/**
 * The same manual as the corpus holds it BEFORE a re-index: no `section`, the
 * footer still in the text, and — where the old extractor had to sentence-split
 * an oversized page — the heading packed onto the end of the sentence before.
 */
const LEGACY_STANDARDS: ManualChunk = {
  chunkIndex: 29,
  page: 13,
  section: null,
  content: STANDARDS_OF_CONDUCT.content,
};

const LEGACY_ATTENDANCE: ManualChunk = {
  chunkIndex: 33,
  page: 15,
  section: null,
  content:
    "Employment with The Company is based on mutual\nconsent and both the employee, and The Company" +
    " have the right to terminate employment as\nwill, with or without cause or advance notice." +
    "\n\nThe Company may use progressive discipline at its\ndiscretion. Attendance\nIt is the" +
    " responsibility of each employee to know his or her work schedule",
};

const LEGACY_LATE_OPENING: ManualChunk = {
  chunkIndex: 34,
  page: 16,
  section: null,
  content:
    "15 | P a g e\nLate Opening\nWhen an employee assigned to open a location is unable to open the" +
    " location at the proper\ntime, the employee must notify the manager as soon as possible.",
};

const TITLE = "JBA Policy Manual Edited 5.2025";

describe("1. reading a section off the sheet it is printed on", () => {
  it("cites the PDF sheet, which is the page a manager turns to", () => {
    /*
     * THE WHOLE CITATION, IN ONE ASSERTION. The dress code is on the PDF's
     * sixteenth sheet; that same sheet prints "15 | P a g e" in its footer,
     * because the cover is unnumbered. The business cites the PDF's number.
     */
    expect(findManualSection(MANUAL, ["Dress Code for The Company"])).toEqual({
      heading: "Dress Code for The Company",
      page: 16,
      chunkIndex: 36,
      foundBy: "sheet_heading",
    });
  });

  it("reads the heading the extractor kept, when it kept one", () => {
    expect(findManualSection([DRESS_CODE], ["Dress Code for The Company"])?.foundBy).toBe(
      "sheet_heading",
    );
  });

  it("reads a heading out of the text when the chunk predates the extractor", () => {
    // No `section` column, and the heading opens the chunk's own lines.
    expect(findManualSection([LEGACY_STANDARDS], ["Standards of Conduct"])).toMatchObject({
      heading: "Standards of Conduct",
      page: 13,
    });
  });

  it("says nothing for a sheet that only continues a section", () => {
    expect(findManualSection([CONDUCT_CONTINUED], ["Insubordination"])).toBeNull();
  });

  it("does not read the other manual's layout for a PDF-paginated one", () => {
    // `pageHeadingOf` still parses a "- 12 -" sheet, and is simply not the tier
    // this manual is read with. Kept so the two layouts stay separable.
    expect(pageHeadingOf("Some Manual\n- 12 -\nDress for Success\nbody")).toEqual({
      page: 12,
      heading: "Dress for Success",
    });
  });
});

describe("2. the two ways a loose match cites the wrong place", () => {
  /*
   * ==========================================================================
   * Both hazards below are real chunks of the real manual.
   * ==========================================================================
   */

  it("never answers from prose that happens to contain the words", () => {
    /*
     * "Lack of punctuality or absenteeism has a negative impact" sits inside
     * the Attendance section. A substring search would return it as the
     * Absenteeism section; a line that is a sentence is not a heading, so it
     * cannot.
     */
    expect(findManualSection(MANUAL, ["Absenteeism"])).toBeNull();
  });

  it("never answers from the contents page, which lists every heading", () => {
    /*
     * THE CONTENTS PAGE IS THE SHARPEST HAZARD IN THIS DOCUMENT: it names every
     * section in the manual against the PRINTED page number, one less than the
     * PDF's. Answering from it would cite page 15 for the dress code — a real
     * page of this manual, and the wrong one.
     */
    const section = findManualSection([TABLE_OF_CONTENTS], ["Dress Code for The Company"]);
    expect(section).toBeNull();
  });

  it("matches a heading by equality, never by containment", () => {
    expect(findManualSection(MANUAL, ["Dress Code"])).toBeNull();
    expect(findManualSection(MANUAL, ["Conduct"])).toBeNull();
  });

  it("absorbs punctuation and case drift in the heading it is asked for", () => {
    // A re-issue that retypes the heading must not silently stop citing it.
    expect(findManualSection(MANUAL, ["dress code for the COMPANY"])?.page).toBe(16);
  });

  it("prints the manual's own spelling, never the one it was asked for", () => {
    const section = findManualSection(MANUAL, ["dress code for the COMPANY"]);
    expect(section?.heading).toBe("Dress Code for The Company");
  });

  it("is null rather than approximate when the manual has no such heading", () => {
    expect(findManualSection(MANUAL, ["Footwear Policy"])).toBeNull();
    expect(findManualSection(MANUAL, [])).toBeNull();
  });

  /*
   * ==========================================================================
   * THE HEADING BURIED MID-LINE IS NOT CITABLE, AND THAT IS DELIBERATE
   * ==========================================================================
   *
   * Until this document is re-indexed, "Attendance" sits at the end of the
   * sentence before it — "...progressive discipline at its discretion.
   * Attendance" — because the old extractor sentence-split an oversized page.
   * Accepting that would mean accepting any capitalised word at the end of any
   * sentence as a section heading.
   */
  it("refuses a heading the old chunking packed onto a sentence", () => {
    expect(findManualSection([LEGACY_ATTENDANCE], ["Attendance"])).toBeNull();
  });

  it("resolves the same section once the document is re-indexed", () => {
    expect(findManualSection([ATTENDANCE], ["Attendance"])).toMatchObject({
      heading: "Attendance",
      page: 15,
    });
  });
});

describe("3. the page belongs to the heading, not to the chunk", () => {
  /*
   * A chunk can span a sheet break and its `page` column is where it STARTED.
   * A heading printed after that break is on the next sheet, so citing the
   * chunk's page would be off by one — on an employment record.
   */
  it("ignores a heading printed after the next sheet begins", () => {
    const spanning: ManualChunk = {
      chunkIndex: 90,
      page: 21,
      section: null,
      content:
        "15 | P a g e\nSolicitation\nPersons not employed by The Company may not solicit.\n" +
        "21 | P a g e\nBusiness Ethics\nThe Company strives to maintain a reputation for honesty.",
    };

    // Solicitation opens the chunk's own sheet and is citable at its page.
    expect(findManualSection([spanning], ["Solicitation"])?.page).toBe(21);
    // Business Ethics is on the sheet after, whose number this chunk does not
    // carry, so it is not cited from here at all.
    expect(findManualSection([spanning], ["Business Ethics"])).toBeNull();
  });

  it("reads past a leading footer, which belongs to the chunk's own sheet", () => {
    expect(findManualSection([LEGACY_LATE_OPENING], ["Late Opening"])?.page).toBe(16);
  });
});

describe("4. the offense box decides which section", () => {
  it("cites the dress code section for a dress code violation", () => {
    const section = manualSectionFor({
      chunks: MANUAL,
      offenseKeys: ["dress_code"],
      jobTitle: "TC",
    });

    expect(officialManualReference(TITLE, section!)).toBe(
      "JBA Policy Manual Edited 5.2025 — Dress Code for The Company, page 16",
    );
  });

  /*
   * ==========================================================================
   * THIS MANUAL SPLITS THE DRESS CODE BY BRAND, NOT BY ROLE
   * ==========================================================================
   *
   * So a Salon Director and a tanning consultant cite the same section — the
   * company-wide one that states the rule and the consequence. The brand
   * sub-sections are headed "Shirts", "Pants" and "Sun Tan City", which name no
   * policy on their own and are never cited.
   */
  it("cites the same section whatever the employee's role", () => {
    const consultant = manualSectionFor({
      chunks: MANUAL,
      offenseKeys: ["dress_code"],
      jobTitle: "TC",
    });
    const director = manualSectionFor({
      chunks: MANUAL,
      offenseKeys: ["dress_code"],
      jobTitle: "Salon Director",
    });

    expect(director).toEqual(consultant);
  });

  it("never cites a brand sub-section of the dress code", () => {
    for (const entry of Object.values(OFFENSE_MANUAL_SECTIONS)) {
      expect(entry.headings).not.toContain("Shirts");
      expect(entry.headings).not.toContain("Pants");
      expect(entry.headings).not.toContain("Sun Tan City");
    }
  });

  it("cites the Attendance section for both lateness and absence", () => {
    for (const key of ["tardiness", "absenteeism"]) {
      expect(manualSectionFor({ chunks: MANUAL, offenseKeys: [key] })).toMatchObject({
        heading: "Attendance",
        page: 15,
      });
    }
  });

  it("cites the Standards of Conduct at its own page", () => {
    expect(
      manualSectionFor({ chunks: MANUAL, offenseKeys: ["standards_of_conduct"] }),
    ).toMatchObject({ heading: "Standards of Conduct", page: 13 });
  });

  it("declares no role split, because this manual states none", () => {
    for (const entry of Object.values(OFFENSE_MANUAL_SECTIONS)) {
      expect(entry.managementHeadings).toBeUndefined();
    }
  });

  it.each(["SD", "ASD", "DM", "District Manager", "Assistant Salon Director"])(
    "still reads %s as management, for a manual that does split",
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
  it.each(["under_performance", "company_policies", "other"])("cites nothing for %s", (key) => {
    expect(OFFENSE_MANUAL_SECTIONS[key]).toBeUndefined();
    expect(manualSectionFor({ chunks: MANUAL, offenseKeys: [key] })).toBeNull();
  });

  /*
   * A DRESS CODE FORM SAYS NOTHING ABOUT ATTENDANCE. The mapping is per ticked
   * box, which is the property that makes citing the other sections safe.
   */
  it("cites only what was ticked", () => {
    const reference = officialManualReference(
      TITLE,
      manualSectionsFor({ chunks: MANUAL, offenseKeys: ["dress_code"] }),
    );

    expect(reference).toBe(
      "JBA Policy Manual Edited 5.2025 — Dress Code for The Company, page 16",
    );
    expect(reference).not.toMatch(/attendance|conduct/i);
  });

  it("cites each section when several boxes were ticked", () => {
    const sections = manualSectionsFor({
      chunks: MANUAL,
      offenseKeys: ["dress_code", "standards_of_conduct"],
    });

    expect(officialManualReference(TITLE, sections)).toBe(
      "JBA Policy Manual Edited 5.2025 —" +
        " Dress Code for The Company, page 16; Standards of Conduct, page 13",
    );
  });

  it("cites one section once when two boxes point at it", () => {
    const sections = manualSectionsFor({
      chunks: MANUAL,
      offenseKeys: ["tardiness", "absenteeism"],
    });

    expect(officialManualReference(TITLE, sections)).toBe(
      "JBA Policy Manual Edited 5.2025 — Attendance, page 15",
    );
  });

  it("skips a ticked box the manual does not state, and cites the rest", () => {
    const sections = manualSectionsFor({
      chunks: MANUAL,
      offenseKeys: ["under_performance", "dress_code"],
    });

    expect(sections).toHaveLength(1);
    expect(sections[0]!.heading).toBe("Dress Code for The Company");
  });
});

describe("5. which document is the manual", () => {
  it("is identified by a tag, with the filename only as a fallback", () => {
    expect(OFFICIAL_POLICY_MANUAL.tag).toBe("official-policy-manual");
    expect(OFFICIAL_POLICY_MANUAL.fallbackTitles).toContain("JBA Policy Manual");
  });

  /*
   * THE FALLBACK IS A PREFIX, because the revision date is in the title.
   * "JBA Policy Manual Edited 5.2025" is this one; pinning the whole string
   * would mean the citation stopped working the day the manual was re-issued.
   */
  it("names the manual without pinning its revision", () => {
    for (const title of OFFICIAL_POLICY_MANUAL.fallbackTitles) {
      expect(title).not.toMatch(/\d\.\d{4}/);
    }
  });

  it("is read in PDF sheet numbers", () => {
    expect(OFFICIAL_POLICY_MANUAL.pagination).toBe("pdf_sheet");
  });
});

/**
 * ============================================================================
 * 6. RESOLVING THE MANUAL OUT OF THE REAL CORPUS
 * ============================================================================
 *
 * The candidates below are the live corpus's own rows — the manual and the
 * training manuals whose titles are the nearest misses. None of them is tagged
 * today, so the fallback is what is actually running, and the fallback is what
 * these exercise.
 */
describe("6. resolving the manual out of a real corpus", () => {
  const doc = (
    title: string,
    original_filename: string,
    tags: string[] = [],
  ): ManualCandidateDocument => ({ id: title, title, original_filename, tags });

  const CORPUS: ManualCandidateDocument[] = [
    doc("JBA Policy Manual Edited 5.2025", "JBA-Policy-Manual-Edited-5.2025.pdf"),
    doc("Salon Director Manual 3.2026", "Salon-Director-Manual-3.2026.pdf"),
    doc("Tanning Consultant Manual 4.22.2026", "Tanning-Consultant-Manual-4.22.2026.pdf"),
    doc("STC DM Manual 6.2025", "STC-DM-Manual-6.2025.pdf"),
    doc("Glow Brands Integrity Guide 12 2019", "Glow-Brands-Integrity-Guide-12-2019.pdf"),
    doc("Sun Tan City Safety Binder 2025 26   Franchise", "Sun-Tan-City-Safety-Binder.pdf"),
  ];

  it("finds it by title, past the revision in the name", () => {
    const resolution = resolvePolicyManual(CORPUS);

    expect(resolution.ok).toBe(true);
    expect(resolution.ok && resolution.document.title).toBe("JBA Policy Manual Edited 5.2025");
    expect(resolution.ok && resolution.matchedBy).toBe("fallback");
  });

  /*
   * THE REVISION IS THE REASON THE MATCH IS A PREFIX. An exact match would stop
   * citing the manual the day it was re-issued — the day a stale citation would
   * do the most harm.
   */
  it("keeps finding it when the manual is re-issued under a new date", () => {
    const reissued = [doc("JBA Policy Manual Edited 11.2027", "JBA-Policy-Manual-11.2027.pdf")];

    expect(resolvePolicyManual(reissued).ok).toBe(true);
  });

  it("does not mistake another manual for it", () => {
    const others = CORPUS.filter((entry) => !entry.title.startsWith("JBA Policy Manual"));

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
    const both = [...CORPUS, doc("JBA Policy Manual 3.2026", "JBA-Policy-Manual-3.2026.pdf")];

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
