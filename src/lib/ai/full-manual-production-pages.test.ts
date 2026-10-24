import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import rows from "@/test/fixtures/jba-manual-production-chunks-sunny.json";
import { manualChunkFromRow, type ChunkRow } from "@/lib/ai/full-manual-load";

import { applyFullManualAnswer, choosePolicyManuals, type FullManualDocument } from "./full-manual-context";

/**
 * Production rows of the JBA Policy Manual (chunks 44-64, 133-141, 151-152)
 * read through the loader's own row mapping, and replies production saved on
 * 24 Oct 2026.
 *
 * Printed pages are the uploaded PDF's (2025-JBA-Policy-Manual-Edited-5-2025,
 * printed page = PDF sheet - 1), which the manual's contents page and footers
 * agree with: Name tags, Shoes, Belts and Hair 15; Facial Hair, Make-up,
 * Jewelry and Tattoos 16; Sun Tan City shirts, pants and tanning 17; Cell
 * Phone and Company Email 19; Point of Sale and Alarm Passwords 20; Important
 * Notes 40; Paid time Off, Eligibility and Provisions 41; the rest of
 * Provisions and Usage 42; Bereavement Leave 46.
 */

function manual(): FullManualDocument {
  return {
    id: rows.document_id,
    title: rows.title,
    category: "policies_compliance",
    chunks: (rows.chunks as ChunkRow[]).map(manualChunkFromRow),
  };
}

function assembled() {
  const assembly = choosePolicyManuals("What is the dress code?", [manual()]);
  if (!assembly.ok) throw new Error("manual did not assemble");
  return assembly;
}

function cite(content: string) {
  return applyFullManualAnswer({ content, manuals: assembled().manuals, sourceCount: 0 });
}

function liveReply(conversationId: string): string {
  return readFileSync(join(__dirname, "__fixtures__", "live-answers", `${conversationId}.txt`), "utf8").replace(
    /\n$/,
    "",
  );
}

function markerBefore(text: string, snippet: string): number | null {
  const at = text.indexOf(snippet);
  expect(at, snippet).toBeGreaterThan(-1);
  const markers = [...text.slice(0, at).matchAll(/\[p\.(\d{1,3})\]/g)];
  const last = markers[markers.length - 1];
  return last ? Number(last[1]) : null;
}

/** Words in order, without [p.N] / [S#] markers and without the page digits of a "…Manual p.N" label. */
function wordsInOrder(text: string): string[] {
  return text
    .replace(/\[(?:p\.\d{1,3}|S\d{1,2})\]/g, " ")
    .replace(/(\bManual\s+p\.)\d{1,3}/g, "$1")
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
}

function pagesIn(text: string): Set<number> {
  return new Set([...text.matchAll(/\[p\.(\d{1,3})\]/g)].map((match) => Number(match[1])));
}

function lineWith(text: string, snippet: string): string {
  const line = text.split("\n").find((part) => part.includes(snippet));
  expect(line, snippet).toBeTruthy();
  return line!;
}

/** Every "…JBA Policy Manual p.N" label followed by a marker names the same page as that marker. */
function expectLabelsMatchMarkers(text: string) {
  for (const match of text.matchAll(/JBA Policy Manual p\.(\d{1,3})\s*\[p\.(\d{1,3})\]/g)) {
    expect(match[2], match[0]).toBe(match[1]);
  }
}

function expectSameWordsAndLines(input: string, output: string) {
  expect(wordsInOrder(output)).toEqual(wordsInOrder(input));
  expect(output.split("\n").length).toBe(input.split("\n").length);
}

describe("production manual rows", () => {
  it("carry the per-heading pages ingestion recorded", () => {
    const chunk = (index: number) => manual().chunks.find((item) => item.chunkIndex === index)!;
    expect(chunk(46).sections).toEqual([
      { heading: "Hair", page: 15 },
      { heading: "Facial Hair", page: 16 },
      { heading: "Make-up", page: 16 },
    ]);
    expect(chunk(62).sections).toEqual([
      { heading: "Company Email Account", page: 19 },
      { heading: "Point of Sale and Alarm Passwords", page: 20 },
    ]);
  });

  it("marks every Sun Tan City and shared section on the page the PDF prints it", () => {
    const text = assembled().block;
    expect(markerBefore(text, "Dress Code for The Company")).toBe(15);
    expect(markerBefore(text, "## Hair")).toBe(15);
    expect(markerBefore(text, "## Facial Hair")).toBe(16);
    expect(markerBefore(text, "## Make-up")).toBe(16);
    expect(markerBefore(text, "## Jewelry/Accessories")).toBe(16);
    expect(markerBefore(text, "## Tattoos")).toBe(16);
    expect(markerBefore(text, "Any STC Employee can wear any Branded top")).toBe(17);
    expect(markerBefore(text, "## Cell Phone/Smart Watch Policy")).toBe(19);
    expect(markerBefore(text, "## Company Email Account")).toBe(19);
    expect(markerBefore(text, "## Point of Sale and Alarm Passwords")).toBe(20);
    expect(markerBefore(text, "## Paid time Off (PTO)")).toBe(41);
    expect(markerBefore(text, "## Eligibility")).toBe(41);
    expect(markerBefore(text, "o 5-9 years of service")).toBe(42);
    expect(markerBefore(text, "## Usage")).toBe(42);
    expect(text).not.toContain("Any BCS Employee");
    expect(text).not.toContain("Two uniform shirts");
  });
});

describe("live replies from 24 Oct 2026", () => {
  it("conv_mvmnwgmq2y3usjb keeps every word in order and puts each label on its printed page", () => {
    const raw = liveReply("conv_mvmnwgmq2y3usjb");
    const out = cite(raw);
    expectSameWordsAndLines(raw, out.content);
    expectLabelsMatchMarkers(out.content);
    expect(pagesIn(out.content).has(1)).toBe(false);
    for (const page of pagesIn(out.content)) expect([15, 16, 17]).toContain(page);
    for (const label of ["All Locations Dress Code", "Shoes", "Belts", "Hair"]) {
      expect(out.content).toContain(`${label}, JBA Policy Manual p.15 [p.15]`);
    }
    for (const label of ["Facial Hair", "Make-up", "Jewelry/Accessories", "Tattoos"]) {
      expect(out.content).toContain(`${label}, JBA Policy Manual p.16 [p.16]`);
    }
    for (const label of ["Shirts", "Pants", "Tanning"]) {
      expect(out.content).toContain(`${label}, JBA Policy Manual p.17 [p.17]`);
    }
    for (const citation of out.citations) {
      expect(pagesIn(out.content).has(Number(citation.locator.replace("Page ", "")))).toBe(true);
    }
  });

  it("conv_mvmnvara2iixygm keeps every word in order, cites PTO on its pages, and drops 1 and 22", () => {
    const raw = liveReply("conv_mvmnvara2iixygm");
    const out = cite(raw);
    expectSameWordsAndLines(raw, out.content);
    expectLabelsMatchMarkers(out.content);
    for (const page of [1, 22]) {
      expect(pagesIn(out.content).has(page)).toBe(false);
      expect(out.citations.some((citation) => citation.locator === `Page ${page}`)).toBe(false);
    }
    expect(pagesIn(lineWith(out.content, "PTO is paid time away from work"))).toEqual(new Set([41]));
    expect(pagesIn(lineWith(out.content, "half-day (4 hour) or full-day"))).toEqual(new Set([42]));
    expect(pagesIn(lineWith(out.content, "10+ years"))).toEqual(new Set([42]));
    expect(lineWith(out.content, "Payout of accrued PTO")).not.toMatch(/\[p\.22\]/);
    // "This will not deduct from your PTO balance" is chunk 152, the top of
    // sheet 48 (printed 47, with Military Leave), so the model's p.47 for
    // that sentence is the page it is printed on.
    expect(pagesIn(lineWith(out.content, "do **not** deduct from the PTO balance"))).toEqual(new Set([47]));
  });

  it("conv_mvmtp0qe2pc7mzf (retrieval path reply) keeps every word and cites the dress code on 15-17", () => {
    const raw = liveReply("conv_mvmtp0qe2pc7mzf");
    const out = cite(raw);
    expectSameWordsAndLines(raw, out.content);
    expect(out.content).not.toMatch(/\[S\d/);
    for (const page of pagesIn(out.content)) expect([15, 16, 17]).toContain(page);
    expect(pagesIn(lineWith(out.content, "Tennis shoes or other full-coverage"))).toEqual(new Set([15]));
    expect(pagesIn(lineWith(out.content, "Dark brown or black"))).toEqual(new Set([15]));
    expect(out.citations.some((citation) => citation.locator === "Page 6")).toBe(false);
  });
});

describe("labels", () => {
  it("keeps the words before a label and puts it on the printed page (QA, 24 Oct 2026)", () => {
    const raw =
      "- Jewelry that does not interfere with work is acceptable; no dangling earrings or chains, and no pins or buttons, Jewelry/Accessories, JBA Policy Manual p.15 [p.15].\n" +
      "- Belts are dark brown or black, with no cell phones, pagers, chains, or keys hanging from them, Belts, JBA Policy Manual p.16 [p.16].";
    const out = cite(raw);
    expect(out.content).toContain(
      "no dangling earrings or chains, and no pins or buttons, Jewelry/Accessories, JBA Policy Manual p.16 [p.16].",
    );
    expect(out.content).toContain("with no cell phones, pagers, chains, or keys hanging from them, Belts, JBA Policy Manual p.15 [p.15].");
    expectSameWordsAndLines(raw, out.content);
  });

  it("moves a Sun Tan City shirts label to 17 and leaves a Buff City Soap or Crunch one as written", () => {
    const stc = cite("Any STC employee can wear any branded top or black collared or black t-shirt, Shirts, JBA Policy Manual p.16.");
    expect(stc.content).toContain("Shirts, JBA Policy Manual p.17 [p.17].");
    const bcs = cite("Buff City Soap employees can wear any plain black, white, or gray t-shirt, Shirts, JBA Policy Manual p.16.");
    expect(bcs.content).toBe("Buff City Soap employees can wear any plain black, white, or gray t-shirt, Shirts, JBA Policy Manual p.16.");
    const crunch = cite("Crunch Fitness gives two uniform shirts at hire, Shirts, JBA Policy Manual p.16.");
    expect(crunch.content).toBe("Crunch Fitness gives two uniform shirts at hire, Shirts, JBA Policy Manual p.16.");
  });

  it("does not change a page outside a JBA label or in another manual's label", () => {
    const raw = "See page 99 for more. Cell phones stay off the floor, see the DM manual p.6.";
    const out = cite(raw);
    expect(out.content).toContain("See page 99 for more.");
    expect(out.content).toContain("see the DM manual p.6.");
    expect(pagesIn(out.content).has(99)).toBe(false);
    expect(pagesIn(out.content).has(6)).toBe(false);
  });
});
