import { afterEach, describe, expect, it, vi } from "vitest";

import manual151 from "@/test/fixtures/jba-manual-production-151.json";
import { remapCitations } from "@/lib/ai/remap-incident";

import { excerptTextForDisplay, withoutBrandLines } from "./excerpt-brand-filter";
import { rowToCitation, type MatchedChunkRow } from "./mappers";

/**
 * Ported from Ask Bubbles (QA, 25 Oct 2026, B22-4): a cited source excerpt
 * showed the sibling company's wording. Bubbles' p.42 PTO excerpt read
 * "Sun Tan City – February 1 and June 1 o Buff…". The same production chunk
 * (byte-identical in both apps) is a retrieved row here, and its text was the
 * excerpt whole — the soap brand's peak-season bullet included
 * (EXCERPT_BRAND_FILTER_ENABLED).
 */

const FLAG = "EXCERPT_BRAND_FILTER_ENABLED";
const TITLE = "2025 JBA Policy Manual - Edited 5-2025";
const SIBLING = /Buff\s+City|\bBCS\b/i;

// QA's B22-4 excerpt text, with the soap brand's bullet the excerpt cut off at "o Buff…" read to its end.
const B22_4_EXCERPT =
  "Qualified salaried Employees must schedule PTO in half day (4 hours), or full day (8 hours) increments only. No PTO is permitted during peak business seasons as listed below: o Sun Tan City – February 1 and June 1 o Buff City Soap – November 1 and December 31";

const CHUNK_PTO = (manual151.chunks as { content: string }[]).find((chunk) =>
  chunk.content.includes("o Buff City Soap – November 1 and December 31"),
)!.content;

function row(content: string, title = TITLE): MatchedChunkRow {
  return {
    chunk_id: "chunk-pto",
    document_id: "doc-jba",
    document_title: title,
    category: "policies_compliance",
    locator: "Page 42 — Usage",
    page: 42,
    section: "Usage",
    content,
    similarity: 0.8,
  };
}

const SECTION = [{ heading: "Usage", page: 42, chunkIndex: 91, foundBy: "page_heading" as const }];
const MANUAL = {
  documentId: "doc-jba",
  documentTitle: TITLE,
  chunks: [{ chunkIndex: 91, page: 42, section: "Usage", content: CHUNK_PTO }],
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("B22-4 (ported): the p.42 PTO excerpt never quotes the sibling company", () => {
  it("on, the retrieved chunk's excerpt drops the soap brand's bullet and keeps every other line verbatim", () => {
    vi.stubEnv(FLAG, "true");
    const citation = rowToCitation(row(CHUNK_PTO));
    expect(citation.excerpt).not.toMatch(SIBLING);
    expect(citation.excerpt).toBe(CHUNK_PTO.replace("o Buff City Soap – November 1 and December 31\n", ""));
    expect(citation.excerpt).toContain("o Sun Tan City – February 1 and June 1");
    expect(citation.locator).toBe("Page 42 — Usage");
    expect(citation.documentTitle).toBe(TITLE);
  });

  it("on, QA's exact excerpt text loses its trailing soap-brand bullet", () => {
    vi.stubEnv(FLAG, "true");
    expect(excerptTextForDisplay(B22_4_EXCERPT, TITLE)).toBe(
      "Qualified salaried Employees must schedule PTO in half day (4 hours), or full day (8 hours) increments only. No PTO is permitted during peak business seasons as listed below: o Sun Tan City – February 1 and June 1",
    );
  });

  it("on, the remap path's source card drops the bullet too", () => {
    vi.stubEnv(FLAG, "true");
    expect(remapCitations(MANUAL, SECTION)[0]!.excerpt).not.toMatch(SIBLING);
  });

  it("on, a brand label and its block, and an inline bullet with its wrapped line, are dropped", () => {
    vi.stubEnv(FLAG, "true");
    expect(
      excerptTextForDisplay("Dress Code\nBuff City Soap:\nShirts\nCompany t-shirt.\nSun Tan City:\nShirts\nBlack tops only.", TITLE),
    ).toBe("Dress Code\nSun Tan City:\nShirts\nBlack tops only.");
    expect(
      withoutBrandLines("Employee discounts: o Buff City Soap: 30% off all non-\nsoap products.\no Sun Tan City: 50% off.", [
        String.raw`Buff\s+City(?:\s+Soap)?`,
      ]),
    ).toBe("Employee discounts:\no Sun Tan City: 50% off.");
  });

  it("off, the excerpts are the chunk exactly as before", () => {
    vi.stubEnv(FLAG, "");
    expect(rowToCitation(row(CHUNK_PTO)).excerpt).toBe(CHUNK_PTO);
    expect(remapCitations(MANUAL, SECTION)[0]!.excerpt).toBe(`Usage. ${CHUNK_PTO}`.slice(0, 500));
    expect(excerptTextForDisplay(B22_4_EXCERPT, TITLE)).toBe(B22_4_EXCERPT);
  });
});

describe("a normal excerpt is untouched", () => {
  it("on, text that names no sibling brand comes back identical", () => {
    vi.stubEnv(FLAG, "true");
    const text = "Employees must clock in at the start of every shift.\no Sun Tan City – February 1 and June 1";
    expect(rowToCitation(row(text)).excerpt).toBe(text);
  });

  it("on, a document that is not the JBA Policy Manual is not read", () => {
    vi.stubEnv(FLAG, "true");
    const text = "o Buff City Soap – November 1 and December 31";
    expect(excerptTextForDisplay(text, "Salon Opening Checklist")).toBe(text);
  });
});

/*
 * Register rule (Pau): the excerpt text all lowercase, and in sentence case
 * with the brand names typed lowercase or Capitalized. The hidden brand is
 * left out in every one, and this company's own lines are kept.
 */
describe("the sibling brand is left out in any case", () => {
  const lower = (text: string) => text.toLowerCase();
  const sentenceCase = (text: string) =>
    text.toLowerCase().replace(/(^|[.!?]\s+)(?!o\s)(\p{Ll})/gu, (_m, lead: string, first: string) => `${lead}${first.toUpperCase()}`);
  const brandsCapitalized = (text: string) =>
    sentenceCase(text)
      .replace(/buff(\s+)city(\s+)soap/gi, "Buff$1City$2Soap")
      .replace(/\bbcs\b/gi, "BCS")
      .replace(/sun(\s+)tan(\s+)city/gi, "Sun$1Tan$2City");
  const REGISTERS = [
    ["all lowercase", lower],
    ["sentence case, brands lowercase", sentenceCase],
    ["sentence case, brands Capitalized", brandsCapitalized],
  ] as const;

  it.each(REGISTERS)("%s: QA's B22-4 excerpt loses its trailing sibling bullet", (_label, recase) => {
    vi.stubEnv(FLAG, "true");
    const out = excerptTextForDisplay(recase(B22_4_EXCERPT), TITLE);
    expect(out).not.toMatch(SIBLING);
    expect(out).toBe(
      recase(
        "Qualified salaried Employees must schedule PTO in half day (4 hours), or full day (8 hours) increments only. No PTO is permitted during peak business seasons as listed below: o Sun Tan City – February 1 and June 1",
      ),
    );
  });

  it.each(REGISTERS)("%s: the retrieved p.42 chunk drops the sibling bullet line only", (_label, recase) => {
    vi.stubEnv(FLAG, "true");
    const excerpt = rowToCitation(row(recase(CHUNK_PTO))).excerpt;
    expect(excerpt).not.toMatch(SIBLING);
    expect(excerpt).toBe(recase(CHUNK_PTO).replace(/o buff city soap – november 1 and december 31\n/i, ""));
    expect(excerpt).toMatch(/o sun tan city – february 1 and june 1/i);
  });

  it.each(REGISTERS)("%s: an inline bullet and its wrapped line go; this company's bullets stay", (_label, recase) => {
    vi.stubEnv(FLAG, "true");
    const text = recase(
      "No PTO is permitted during peak business seasons as listed below: o Buff City Soap – November 1 and\ndecember 31 o Sun Tan City – February 1 and June 1\nEmployee discounts: o Buff City Soap: 30% off all non-\nsoap products.\no Sun Tan City: 50% off.",
    );
    const out = excerptTextForDisplay(text, TITLE);
    expect(out).not.toMatch(SIBLING);
    expect(out).not.toMatch(/november 1 and|soap products/i);
    expect(out).toMatch(
      /^no pto is permitted during peak business seasons as listed below:\no sun tan city – february 1 and june 1\nemployee discounts:\no sun tan city: 50% off\.$/i,
    );
  });

  it.each(REGISTERS)("%s: a brand label's block goes up to the next label", (_label, recase) => {
    vi.stubEnv(FLAG, "true");
    const out = excerptTextForDisplay(
      recase("Dress Code\nBuff City Soap:\nShirts\nCompany t-shirt.\nSun Tan City:\nShirts\nBlack tops only."),
      TITLE,
    );
    expect(out).not.toMatch(SIBLING);
    expect(out).toMatch(/^dress code\nsun tan city:\nshirts\nblack tops only\.$/i);
  });

  it.each(REGISTERS)("%s: a sentence naming the initials goes and the next sentence stays", (_label, recase) => {
    vi.stubEnv(FLAG, "true");
    expect(excerptTextForDisplay(recase("Product rules apply at BCS locations. Employees must clock in on time."), TITLE)).toBe(
      recase("Employees must clock in on time."),
    );
  });

  it.each(REGISTERS)("%s: text that names no hidden brand comes back identical", (_label, recase) => {
    vi.stubEnv(FLAG, "true");
    const text = recase("Employees must clock in at the start of every shift.\no Sun Tan City – February 1 and June 1");
    expect(rowToCitation(row(text)).excerpt).toBe(text);
  });

  it.each(REGISTERS)("%s: off, the text is returned as it came", (_label, recase) => {
    vi.stubEnv(FLAG, "");
    expect(excerptTextForDisplay(recase(B22_4_EXCERPT), TITLE)).toBe(recase(B22_4_EXCERPT));
  });
});
