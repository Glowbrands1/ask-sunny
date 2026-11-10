import { afterEach, describe, expect, it, vi } from "vitest";

import rows from "@/test/fixtures/jba-manual-production-151.json";
import { accountManualSections } from "@/lib/ai/account-manual-sections";
import { manualChunkFromRow, type ChunkRow } from "@/lib/ai/full-manual-load";

import type { ManualChunk } from "./official-policy-manual";

/**
 * NOT_FOLLOWING_IS_VIOLATION_ENABLED (QA's live report in the sibling app, 10 Nov 2026): "make it about not following the dress code" wrote no
 * Dress Code reference: "not" + up to two words before a policy topic (NEGATED_BEFORE) set the policy aside. QA's ruling:
 * not following / not wearing / not in dress code is that policy broken. The manager's and coding 4's probe wordings,
 * read against the production manual rows.
 */
const CHUNKS: readonly ManualChunk[] = (rows.chunks as ChunkRow[]).map(manualChunkFromRow);
const cited = (text: string) => accountManualSections(text, CHUNKS).map((section) => section.heading);
const DRESS = /Dress Code/i;

const BROKEN = [
  "make it about not following the dress code",
  "she did not follow the dress code on 10/14/26",
  "she failed to follow the dress code on 10/14/26",
  "she was not in dress code on 10/14/26",
  "she was not wearing the proper uniform under our dress code on 10/14/26",
  // QA, 10 Nov 2026: "out of dress code" / "out of uniform" break the policy too.
  "she was out of dress code on 10/14/26",
  "she was out of uniform on 10/14/26",
];

afterEach(() => vi.unstubAllEnvs());

describe("not following a policy topic names it as broken (NOT_FOLLOWING_IS_VIOLATION_ENABLED)", () => {
  for (const said of BROKEN) {
    it(`on: "${said}" cites the Dress Code`, () => {
      vi.stubEnv("NOT_FOLLOWING_IS_VIOLATION_ENABLED", "true");
      expect(cited(said).some((heading) => DRESS.test(heading)), said).toBe(true);
    });
  }

  it('off: "make it about not following the dress code" names no policy, as before', () => {
    vi.stubEnv("NOT_FOLLOWING_IS_VIOLATION_ENABLED", "");
    expect(cited("make it about not following the dress code").some((heading) => DRESS.test(heading))).toBe(false);
  });

  it('on: "violated the dress code" still cites it (unchanged)', () => {
    vi.stubEnv("NOT_FOLLOWING_IS_VIOLATION_ENABLED", "true");
    expect(cited("she violated the dress code on 10/14/26").some((heading) => DRESS.test(heading))).toBe(true);
  });

  it("on: a plain negation still sets the policy aside (\"this is not about the dress code\")", () => {
    vi.stubEnv("NOT_FOLLOWING_IS_VIOLATION_ENABLED", "true");
    expect(cited("this is not about the dress code, she was late on 10/14/26").some((heading) => DRESS.test(heading))).toBe(false);
  });
});
