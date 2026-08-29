import { describe, expect, it } from "vitest";

import { extractFromString, extractTextFile } from "./txt";
import { splitHtmlByHeading } from "./docx";

describe("TXT extraction", () => {
  it("keeps a heading-less file as one segment", () => {
    const doc = extractFromString("First paragraph.\n\nSecond paragraph.");
    expect(doc.segments).toHaveLength(1);
    expect(doc.segments[0]!.locator).toBe("Text");
    expect(doc.segments[0]!.section).toBeNull();
    expect(doc.segments[0]!.text).toContain("Second paragraph.");
  });

  it("splits on Markdown headings and uses them as locators", () => {
    const doc = extractFromString(
      "# Attendance\n\nBe on time.\n\n## Dress code\n\nWear the badge.",
    );

    expect(doc.segments.map((segment) => segment.locator)).toEqual([
      "Attendance",
      "Dress code",
    ]);
    expect(doc.segments[1]!.section).toBe("Dress code");
    expect(doc.segments[1]!.text).toBe("Wear the badge.");
  });

  it("splits on setext underlines", () => {
    const doc = extractFromString("Coaching Standards\n===\n\nCoach in private.");
    expect(doc.segments[0]!.locator).toBe("Coaching Standards");
    expect(doc.segments[0]!.text).toBe("Coach in private.");
  });

  it("treats a standalone shouting line as a section heading", () => {
    const doc = extractFromString(
      "SECTION ONE OVERVIEW\n\nThe body of the section follows here.",
    );
    expect(doc.segments[0]!.section).toBe("SECTION ONE OVERVIEW");
  });

  it("normalizes line endings and collapses blank runs", () => {
    const doc = extractFromString("a\r\n\r\n\r\n\r\nb");
    expect(doc.segments[0]!.text).toBe("a\n\nb");
  });

  it("strips a UTF-8 byte order mark", () => {
    const bytes = new TextEncoder().encode("﻿Hello there.");
    const doc = extractTextFile(bytes);
    expect(doc.segments[0]!.text).toBe("Hello there.");
  });

  it("reports the extracted character count", () => {
    const doc = extractFromString("abcde");
    expect(doc.characterCount).toBe(5);
  });

  it("yields no segments for whitespace only", () => {
    expect(extractFromString("   \n\n  ").segments).toEqual([]);
  });
});

describe("DOCX heading splitting", () => {
  it("uses headings as section locators", () => {
    const segments = splitHtmlByHeading(
      "<h1>Attendance</h1><p>Be on time.</p><h2>Dress code</h2><p>Wear the badge.</p>",
    );

    expect(segments.map((segment) => segment.locator)).toEqual([
      "Attendance",
      "Dress code",
    ]);
    expect(segments[0]!.page).toBeNull();
    expect(segments[0]!.text).toBe("Be on time.");
  });

  it("labels content before the first heading rather than dropping it", () => {
    const segments = splitHtmlByHeading("<p>Intro text.</p><h1>Body</h1><p>More.</p>");
    expect(segments[0]!.locator).toBe("Document body");
    expect(segments[0]!.text).toBe("Intro text.");
  });

  it("keeps list items and table cells as separate paragraphs", () => {
    const segments = splitHtmlByHeading(
      "<h1>Steps</h1><ul><li>First step.</li><li>Second step.</li></ul>",
    );
    expect(segments[0]!.text).toBe("First step.\n\nSecond step.");
  });

  it("decodes entities and strips markup", () => {
    const segments = splitHtmlByHeading("<h1>Policy &amp; Rules</h1><p>Use &quot;this&quot;.</p>");
    expect(segments[0]!.locator).toBe("Policy & Rules");
    expect(segments[0]!.text).toBe('Use "this".');
  });

  it("returns nothing for empty markup", () => {
    expect(splitHtmlByHeading("<p></p>")).toEqual([]);
  });
});
