import { describe, expect, it } from "vitest";

import { fuseRankings, KEYWORD_SLOTS, keywordQuery, MIN_KEYWORD_UNITS, type KeywordChunkRow } from "./hybrid";
import type { MatchedChunkRow } from "./mappers";

const CHECKING_ACCOUNTS =
  "generate me a coaching worksheet for team memebers about getting checking accounts put onto client profiles";
const PASSWORD_QUESTION = "How can I change the password on this platform";

function vectorRow(id: string, similarity = 0.9): MatchedChunkRow {
  return {
    chunk_id: id,
    document_id: `doc-${id}`,
    document_title: `Vector ${id}`,
    category: "other",
    locator: "Text",
    page: null,
    section: null,
    content: `vector ${id}`,
    similarity,
  };
}

function keywordRow(id: string, matched = 3): KeywordChunkRow {
  return {
    chunk_id: id,
    document_id: `doc-${id}`,
    document_title: `Keyword ${id}`,
    category: "other",
    locator: "Text",
    page: null,
    section: null,
    content: `keyword ${id}`,
    keyword_score: 10,
    matched_units: matched,
  };
}

describe("keywordQuery", () => {
  it("sends the words the checking-account question is about, not the words it asks with", () => {
    const { terms, phrases } = keywordQuery(CHECKING_ACCOUNTS);
    expect(terms).toEqual(expect.arrayContaining(["checking", "accounts", "client", "profiles", "coaching"]));
    for (const noise of ["generate", "getting", "put", "onto", "about", "for"]) {
      expect(terms).not.toContain(noise);
    }
    expect(phrases).toContain("checking accounts");
    expect(phrases).toContain("client profiles");
    // Not adjacent in the question, so not a phrase.
    expect(phrases).not.toContain("accounts client");
  });

  it("reads the 1★ password question", () => {
    // "the" sits between "change" and "password", so they are not a pair.
    expect(keywordQuery(PASSWORD_QUESTION)).toEqual({ terms: ["change", "password", "platform"], phrases: [] });
  });

  it("sends nothing for a question made only of request words", () => {
    expect(keywordQuery("can you help me with this please?")).toEqual({ terms: [], phrases: [] });
  });

  it("caps what it sends", () => {
    const long = Array.from({ length: 60 }, (_, index) => `word${String.fromCharCode(97 + (index % 26))}${index}`).join(" ");
    const { terms, phrases } = keywordQuery(long);
    expect(terms.length).toBeLessThanOrEqual(24);
    expect(phrases.length).toBeLessThanOrEqual(16);
  });
});

describe("fuseRankings", () => {
  it("gives an off-topic question no keyword evidence either", () => {
    expect(fuseRankings([], [keywordRow("k1")], 14)).toEqual([]);
  });

  it("needs more than one matched word before a keyword row counts", () => {
    const fused = fuseRankings([vectorRow("v1")], [keywordRow("k1", MIN_KEYWORD_UNITS - 1)], 14);
    expect(fused.map((row) => row.chunk_id)).toEqual(["v1"]);
  });

  it("keeps the vector order and places a keyword row after every second vector row", () => {
    const fused = fuseRankings(
      [vectorRow("v1"), vectorRow("v2"), vectorRow("v3"), vectorRow("v4")],
      [keywordRow("k1"), keywordRow("k2")],
      14,
    );
    expect(fused.map((row) => row.chunk_id)).toEqual(["v1", "v2", "k1", "v3", "v4", "k2"]);
  });

  it("appends keyword rows when the vector leg found only a few", () => {
    const fused = fuseRankings([vectorRow("v1")], [keywordRow("k1"), keywordRow("k2")], 14);
    expect(fused.map((row) => row.chunk_id)).toEqual(["v1", "k1", "k2"]);
  });

  it("leaves a chunk both legs found where the vector leg put it, once", () => {
    const fused = fuseRankings(
      [vectorRow("v1"), vectorRow("both")],
      [keywordRow("both"), keywordRow("k1")],
      14,
    );
    expect(fused.map((row) => row.chunk_id)).toEqual(["v1", "both", "k1"]);
    expect(fused.find((row) => row.chunk_id === "both")!.similarity).toBe(0.9);
  });

  it("never displaces more than the keyword share of the evidence budget", () => {
    const vector = Array.from({ length: 14 }, (_, index) => vectorRow(`v${index}`));
    const fused = fuseRankings(
      vector,
      Array.from({ length: 14 }, (_, index) => keywordRow(`k${index}`)),
      14,
    );
    const evidence = fused.slice(0, 12);
    expect(evidence.filter((row) => row.chunk_id.startsWith("k"))).toHaveLength(KEYWORD_SLOTS);
    // The vector rows that remain are the strongest ones, in their own order.
    expect(evidence.filter((row) => row.chunk_id.startsWith("v")).map((row) => row.chunk_id)).toEqual(
      vector.slice(0, 12 - KEYWORD_SLOTS).map((row) => row.chunk_id),
    );
  });

  it("keeps a vector row's measured similarity and gives a keyword-only row none", () => {
    const fused = fuseRankings([vectorRow("v1", 0.88)], [keywordRow("k1")], 14);
    expect(fused.find((row) => row.chunk_id === "v1")!.similarity).toBe(0.88);
    const keywordOnly = fused.find((row) => row.chunk_id === "k1")!;
    expect(keywordOnly.similarity).toBe(0);
    expect(keywordOnly).not.toHaveProperty("keyword_score");
  });

  it("respects the limit", () => {
    const fused = fuseRankings(
      Array.from({ length: 10 }, (_, index) => vectorRow(`v${index}`)),
      Array.from({ length: 10 }, (_, index) => keywordRow(`k${index}`)),
      12,
    );
    expect(fused).toHaveLength(12);
  });
});
