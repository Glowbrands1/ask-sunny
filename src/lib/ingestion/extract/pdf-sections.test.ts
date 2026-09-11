import { describe, expect, it } from "vitest";

import { headingOf, pageLocator, pdfSegments, splitPageIntoSections } from "./pdf-sections";
import { chunkSegments } from "../chunking";

/**
 * The shapes below are taken from a real employment policy manual: a Word
 * footer on every page, Title Case headings, "o" bullets, body text that wraps
 * near the page width, and a table of contents built from dot leaders. The
 * wording is paraphrased — what is being tested is the SHAPE a line has, which
 * is the only thing the detector reads.
 */

describe("headingOf", () => {
  it("accepts a Title Case heading", () => {
    expect(headingOf("Disciplinary Action")).toBe("Disciplinary Action");
    expect(headingOf("Dress Code for The Company")).toBe("Dress Code for The Company");
  });

  it("accepts a single word heading", () => {
    expect(headingOf("Attendance")).toBe("Attendance");
  });

  it("drops a trailing colon, because that is how a manual writes a heading", () => {
    expect(headingOf("All Locations Dress Code:")).toBe("All Locations Dress Code");
    expect(headingOf("Sun Tan City:")).toBe("Sun Tan City");
  });

  it("ignores small words when judging Title Case", () => {
    expect(headingOf("Texting as General Work communications")).toBe(
      "Texting as General Work communications",
    );
    expect(headingOf("Employment and Supervision of Relatives")).toBe(
      "Employment and Supervision of Relatives",
    );
  });

  it("refuses a sentence, however short", () => {
    expect(headingOf("Employees must speak with their manager directly.")).toBeNull();
    expect(headingOf("expense.")).toBeNull();
    expect(headingOf("Excessive absenteeism will result in termination.")).toBeNull();
  });

  it("refuses body text that wraps near the page width", () => {
    expect(
      headingOf(
        "The Company Employees are to keep a neat, clean, professional appearance at all times",
      ),
    ).toBeNull();
  });

  it("refuses a wrapped clause that happens to be short", () => {
    // Ends mid-sentence, so it is not capitalised like a title.
    expect(headingOf("Crunch Fitness) teaching classes that are not")).toBeNull();
  });

  it("refuses a bullet", () => {
    expect(headingOf("o Name tags are to be worn and visible")).toBeNull();
    expect(headingOf("▪ Unnecessary touching")).toBeNull();
    expect(headingOf("• Be accountable to your results")).toBeNull();
  });

  it("refuses the page footer", () => {
    expect(headingOf("15 | P a g e")).toBeNull();
  });

  it("refuses a table of contents row", () => {
    expect(headingOf("Late Opening ......................... 15")).toBeNull();
  });

  it("refuses a signature rule", () => {
    expect(headingOf("Employee Signature: _______________________")).toBeNull();
  });

  it("refuses a contact row from a reference list", () => {
    expect(headingOf("Dana Whitfield Owner dana.whitfield@example.com")).toBeNull();
  });

  it("refuses a wrapped line that closes a bracket it never opened", () => {
    // "(See\nSeminar/Webinar Attendance section)" wraps into a tidy phrase.
    expect(headingOf("Seminar/Webinar Attendance section)")).toBeNull();
  });

  it("refuses a line with no letters", () => {
    expect(headingOf("2025")).toBeNull();
    expect(headingOf("   ")).toBeNull();
  });
});

describe("pageLocator", () => {
  it("names the page and the policy", () => {
    expect(pageLocator(16, "Dress Code for The Company")).toBe(
      "Page 16 — Dress Code for The Company",
    );
  });

  it("falls back to the page alone when nothing was recognised", () => {
    expect(pageLocator(16, null)).toBe("Page 16");
  });
});

describe("splitPageIntoSections", () => {
  const page = [
    "15 | P a g e",
    "Late Opening",
    "When an employee assigned to open a location is unable to open it at the",
    "proper time, the employee must notify the manager as soon as possible.",
    "Dress Code for The Company",
    "Employees are to keep a neat, clean, professional appearance at all times.",
  ].join("\n");

  it("splits a page at each heading", () => {
    const { segments } = splitPageIntoSections(page, 15, null);

    expect(segments.map((segment) => segment.locator)).toEqual([
      "Page 15 — Late Opening",
      "Page 15 — Dress Code for The Company",
    ]);
    expect(segments[1]!.section).toBe("Dress Code for The Company");
    expect(segments[1]!.page).toBe(15);
  });

  it("keeps the heading inside the text it introduces", () => {
    const { segments } = splitPageIntoSections(page, 15, null);
    expect(segments[0]!.text).toContain("Late Opening");
  });

  it("drops the page footer", () => {
    const { segments } = splitPageIntoSections(page, 15, null);
    expect(segments.map((segment) => segment.text).join("\n")).not.toContain("P a g e");
  });

  it("carries the section across a page break", () => {
    const continued = splitPageIntoSections(
      "may be subject to disciplinary action, up to and including termination.",
      16,
      "Dress Code for The Company",
    );

    expect(continued.segments[0]!.locator).toBe("Page 16 — Dress Code for The Company");
    expect(continued.section).toBe("Dress Code for The Company");
  });

  it("leaves a page with no heading as a plain page locator", () => {
    const { segments } = splitPageIntoSections("some continuing text", 4, null);
    expect(segments[0]!.locator).toBe("Page 4");
    expect(segments[0]!.section).toBeNull();
  });
});

describe("pdfSegments", () => {
  it("numbers pages from one and carries sections between them", () => {
    const segments = pdfSegments([
      "Attendance\nIt is the responsibility of each employee to know their schedule.",
      "Employees who are late must call their manager before the shift.",
      "Discounting\nThe only discounting allowed is a pre-approved promotional offer.",
    ]);

    expect(segments.map((segment) => segment.locator)).toEqual([
      "Page 1 — Attendance",
      "Page 2 — Attendance",
      "Page 3 — Discounting",
    ]);
  });
});

/**
 * The property that actually reaches a disciplinary form: after chunking, the
 * citation still names the policy. Chunking merges undersized segments and can
 * span a page break, and both paths used to drop back to a bare page number.
 */
describe("locators that survive chunking", () => {
  it("keeps the section on a merged chunk", () => {
    const body = "The company requires the badge to be worn and visible. ".repeat(20);
    const chunks = chunkSegments(pdfSegments([`Dress Code for The Company\n${body}`]));

    expect(chunks[0]!.locator).toBe("Page 1 — Dress Code for The Company");
    expect(chunks[0]!.section).toBe("Dress Code for The Company");
  });

  it("keeps the section on a chunk that spans two pages", () => {
    const chunks = chunkSegments(
      pdfSegments(["Dress Code for The Company\nShort opening line.", "A continuing line."]),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.locator).toBe("Pages 1–2 — Dress Code for The Company");
  });
});
