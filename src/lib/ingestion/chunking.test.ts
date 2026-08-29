import { describe, expect, it } from "vitest";

import {
  chunkSegments,
  estimateTokens,
  mergeUndersizedSegments,
  sentencesOf,
  tailForOverlap,
} from "./chunking";
import type { ExtractedSegment } from "./extract/types";

const CHARS_PER_TOKEN = 4;

function paragraph(tokens: number, marker: string): string {
  // Deterministic filler of a known token size: "word " is ~5 chars.
  const words = Math.max(1, Math.round((tokens * CHARS_PER_TOKEN) / 5));
  return `${marker} ${Array.from({ length: words }, () => "word").join(" ")} end.`;
}

function segment(text: string, over: Partial<ExtractedSegment> = {}): ExtractedSegment {
  return { text, locator: "Page 1", page: 1, section: null, ...over };
}

describe("chunkSegments", () => {
  it("is deterministic: identical input produces identical chunks", () => {
    const input = [segment(`${paragraph(400, "a")}\n\n${paragraph(600, "b")}`)];
    expect(chunkSegments(input)).toEqual(chunkSegments(input));
  });

  it("keeps chunks near the target size and under the ceiling", () => {
    const body = Array.from({ length: 8 }, (_, i) => paragraph(300, `p${i}`)).join("\n\n");
    const chunks = chunkSegments([segment(body)]);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // 1000-token ceiling plus the overlap carried in from the prior chunk.
      expect(chunk.tokenEstimate).toBeLessThanOrEqual(1000 + 96 + 20);
    }
  });

  it("carries overlap forward as whole sentences, never mid-sentence", () => {
    const body = Array.from({ length: 6 }, (_, i) => paragraph(300, `p${i}`)).join("\n\n");
    const chunks = chunkSegments([segment(body)]);

    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk after the first opens with a complete sentence repeated from
    // its predecessor, so a retrieved chunk never starts mid-thought.
    const firstSentence = sentencesOf(chunks[1]!.content)[0]!;
    expect(firstSentence.trim().endsWith(".")).toBe(true);
    expect(chunks[0]!.content).toContain(firstSentence);
  });

  it("does not carry overlap across a page boundary", () => {
    const chunks = chunkSegments([
      segment(paragraph(400, "PAGE-ONE-BODY"), { locator: "Page 1", page: 1 }),
      segment(paragraph(400, "PAGE-TWO-BODY"), { locator: "Page 2", page: 2 }),
    ]);

    const pageTwo = chunks.filter((chunk) => chunk.page === 2);
    expect(pageTwo.length).toBeGreaterThan(0);
    // Page 2's chunks must not contain page 1's text, or the citation lies.
    for (const chunk of pageTwo) {
      expect(chunk.content).not.toContain("PAGE-ONE-BODY");
    }
  });

  it("retains locator, page and section metadata on every chunk", () => {
    const chunks = chunkSegments([
      segment(paragraph(500, "x"), {
        locator: "Coaching Standards",
        page: null,
        section: "Coaching Standards",
      }),
    ]);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.locator).toBe("Coaching Standards");
      expect(chunk.section).toBe("Coaching Standards");
      expect(chunk.page).toBeNull();
    }
  });

  it("assigns contiguous zero-based indexes", () => {
    const body = Array.from({ length: 5 }, (_, i) => paragraph(400, `p${i}`)).join("\n\n");
    const chunks = chunkSegments([segment(body)]);
    expect(chunks.map((chunk) => chunk.index)).toEqual(
      chunks.map((_, index) => index),
    );
  });

  it("splits a paragraph with no blank lines on sentence boundaries", () => {
    const long = Array.from(
      { length: 250 },
      (_, i) => `Sentence number ${i} carries some policy text.`,
    ).join(" ");
    const chunks = chunkSegments([segment(long)]);

    expect(chunks.length).toBeGreaterThan(1);
    // No chunk ends mid-sentence.
    for (const chunk of chunks) {
      expect(/[.!?]$/.test(chunk.content.trim())).toBe(true);
    }
  });

  it("force-splits a single sentence longer than the ceiling", () => {
    const runOn = Array.from({ length: 3000 }, (_, i) => `token${i}`).join(" ");
    const chunks = chunkSegments([segment(runOn)]);
    expect(chunks.length).toBeGreaterThan(1);
    // Nothing is dropped: the last token survives somewhere.
    expect(chunks.map((c) => c.content).join(" ")).toContain("token2999");
  });

  it("returns nothing for empty input", () => {
    expect(chunkSegments([])).toEqual([]);
    expect(chunkSegments([segment("   ")])).toEqual([]);
  });
});

describe("mergeUndersizedSegments", () => {
  it("merges tiny consecutive pages and widens the locator to a range", () => {
    const merged = mergeUndersizedSegments(
      [
        segment("Short one.", { locator: "Page 3", page: 3 }),
        segment("Short two.", { locator: "Page 4", page: 4 }),
        segment(paragraph(400, "big"), { locator: "Page 5", page: 5 }),
      ],
      120,
      CHARS_PER_TOKEN,
    );

    // Both tiny pages join the next page that carries real content, and the
    // locator widens to cover every page the merged text actually came from.
    expect(merged).toHaveLength(1);
    expect(merged[0]!.locator).toBe("Pages 3–5");
    expect(merged[0]!.text).toContain("Short one.");
    expect(merged[0]!.text).toContain("Short two.");
  });

  it("emits a run of tiny segments as one merged segment", () => {
    const merged = mergeUndersizedSegments(
      [
        segment("A.", { locator: "Page 1", page: 1 }),
        segment("B.", { locator: "Page 2", page: 2 }),
      ],
      120,
      CHARS_PER_TOKEN,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.locator).toBe("Pages 1–2");
  });

  it("leaves a segment that already clears the minimum alone", () => {
    const merged = mergeUndersizedSegments(
      [segment(paragraph(400, "big"), { locator: "Page 1", page: 1 })],
      120,
      CHARS_PER_TOKEN,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.locator).toBe("Page 1");
  });
});

describe("sentencesOf", () => {
  it("splits on terminal punctuation", () => {
    expect(sentencesOf("One. Two! Three?")).toEqual(["One.", "Two!", "Three?"]);
  });

  it("does not split on common abbreviations or decimals", () => {
    expect(sentencesOf("Contact Dr. Smith today.")).toEqual([
      "Contact Dr. Smith today.",
    ]);
    expect(sentencesOf("The rate is 3.5 percent overall.")).toEqual([
      "The rate is 3.5 percent overall.",
    ]);
  });

  it("still splits a sentence that ends in a number", () => {
    expect(sentencesOf("Follow up within 14. Then review it.")).toEqual([
      "Follow up within 14.",
      "Then review it.",
    ]);
  });
});

describe("tailForOverlap", () => {
  it("returns whole trailing sentences within the budget", () => {
    const tail = tailForOverlap("Alpha one. Beta two. Gamma three.", 5, 4);
    expect(tail).toBe("Gamma three.");
  });

  it("returns nothing when the whole piece would be carried", () => {
    expect(tailForOverlap("Only one sentence here.", 500, 4)).toBe("");
  });

  it("returns nothing when overlap is disabled", () => {
    expect(tailForOverlap("A. B. C.", 0, 4)).toBe("");
  });
});

describe("estimateTokens", () => {
  it("is a stable characters-per-token estimate", () => {
    expect(estimateTokens("", 4)).toBe(0);
    expect(estimateTokens("abcd", 4)).toBe(1);
    expect(estimateTokens("abcde", 4)).toBe(2);
  });
});
