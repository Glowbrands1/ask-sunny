import { describe, expect, it } from "vitest";

import type { ManualChunk } from "./official-policy-manual";
import { sectionWording } from "./policy-citation";

/*
 * QA's production audit (20 Nov 2026, item 18): a heading printed as the last line of its chunk saved a Direct policy with
 * only its Source line. Its wording is read from the next chunk, up to the manual's next titled section.
 */
const chunk = (chunkIndex: number, content: string, headings: string[]): ManualChunk => ({
  chunkIndex,
  page: 16,
  printedPage: 15,
  content,
  sections: headings.map((heading) => ({ heading, page: 15 })),
});

describe("sectionWording: a heading that ends its chunk", () => {
  const chunks = [
    chunk(44, "Dress Code for The Company\nKeep a neat, clean, professional appearance.\n\nAll Locations Dress Code:", ["Dress Code for The Company", "All Locations Dress Code"]),
    chunk(45, "Name tags\no Name tags are to be worn and visible at all times while working.\n\nCrunch Fitness Specific Dress Code:\nShirts", ["Name tags"]),
  ];

  it("reads the wording from the next chunk, up to the next titled section", () => {
    expect(sectionWording(chunks, { heading: "All Locations Dress Code", page: 15, chunkIndex: 44 } as never)).toBe(
      "Name tags\no Name tags are to be worn and visible at all times while working.",
    );
  });

  it("leaves a heading with wording in its own chunk as before", () => {
    expect(sectionWording(chunks, { heading: "Dress Code for The Company", page: 15, chunkIndex: 44 } as never)).toBe(
      "Keep a neat, clean, professional appearance.",
    );
  });
});
