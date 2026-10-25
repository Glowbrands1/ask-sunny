import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import rows from "@/test/fixtures/jba-manual-production-151.json";
import sweep from "@/test/fixtures/sunny-live-policy-answers-oct25-sweep.json";
import { manualChunkFromRow, type ChunkRow } from "@/lib/ai/full-manual-load";

import {
  applyFullManualAnswer,
  asksAboutManual,
  choosePolicyManuals,
  citeRetrievedAnswer,
  isPolicyAnswerQuestion,
  retrievedLocatorPages,
  type FullManualDocument,
} from "./full-manual-context";
import { stripMarkers } from "./prompts";

/**
 * QA policy sweep, 25 Oct 2026 (Sunny 69/71, and the sibling app's findings
 * checked here in this app's wording). The replies are the stored ones,
 * byte for byte (md5 checked).
 *
 *   A3  the immigration answer cited p.9; Immigration Law Compliance is
 *       printed on p.8 and runs onto p.9.
 *   E1  "Who is eligible for PTO and when does it start?" kept an old "[S6]"
 *       and had no [p.N]: the manual was not loaded for that turn.
 *   And, from the sibling app: the jury-duty summons cited on Witness Duty
 *   (48), a sentence left reading "at, so", the first PTO tier cited on 42,
 *   and short replies answered from retrieval with a source and no [p.N].
 */

function manual(): FullManualDocument {
  return {
    id: rows.document_ids["ask-sunny"],
    title: rows.title,
    category: "policies_compliance",
    chunks: (rows.chunks as ChunkRow[]).map(manualChunkFromRow),
  };
}

function manuals() {
  const assembly = choosePolicyManuals("What is the dress code?", [manual()]);
  if (!assembly.ok) throw new Error("manual did not assemble");
  return assembly.manuals;
}

function cite(content: string) {
  return applyFullManualAnswer({ content, manuals: manuals(), sourceCount: 0 });
}

function recorded(conversationId: string) {
  const found = sweep.answers.find((answer) => answer.conversationId === conversationId);
  if (!found) throw new Error(`missing live reply ${conversationId}`);
  return found;
}

function pagesIn(text: string): Set<number> {
  return new Set([...text.matchAll(/\[p\.(\d{1,3})\]/g)].map((match) => Number(match[1])));
}

function lineWith(text: string, snippet: string): string {
  const line = text.split("\n").find((part) => part.includes(snippet));
  expect(line, snippet).toBeTruthy();
  return line!;
}

/** Words in order, without [p.N] / [S#] markers and without the page digits of a "…Manual p.N" label. */
function wordsInOrder(text: string): string[] {
  return text
    .replace(/\[(?:p\.\d{1,3}(?:-\d{1,3})?|S\d{1,2})\]/g, " ")
    .replace(/(\bManual\s+p\.)\d{1,3}/g, "$1")
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
}

describe("the stored replies", () => {
  it.each(sweep.answers.map((answer) => [answer.conversationId, answer] as const))("%s is the reply production saved", (_id, answer) => {
    expect(createHash("md5").update(answer.content).digest("hex")).toBe(answer.md5);
  });
});

/*
 * A3. Chunks 24-26 all store the section "Immigration Law Compliance".
 * Chunk 24 only continues that section on p.9, and Disability Accommodation
 * starts inside chunk 25, so chunk 26 is Disability Accommodation text. The
 * stored label made p.9 a page that "prints" Immigration Law Compliance, and
 * the model's "JBA Policy Manual p.9" label was kept.
 */
describe("A3: Who are we allowed to hire under immigration law?", () => {
  const live = recorded("conv_mvnq26ts2mccxc4");

  it("the sentences from the p.8 text cite p.8; the contact-HR sentence printed on p.9 cites p.9", () => {
    const out = cite(live.content);
    expect(wordsInOrder(out.content)).toEqual(wordsInOrder(live.content));
    const first = lineWith(out.content, "hires only United States citizens");
    expect(first).toContain("(Immigration Law Compliance, JBA Policy Manual p.8 [p.8])");
    expect(pagesIn(lineWith(out.content, "Employment Eligibility Verification Form I-9"))).toEqual(new Set([8]));
    expect(pagesIn(lineWith(out.content, "encouraged to contact Human Resources"))).toEqual(new Set([9]));
    expect(pagesIn(lineWith(out.content, "voided check or direct deposit"))).toEqual(new Set([33]));
    expect(out.citations.map((citation) => `${citation.locator} ${citation.excerpt}`)).toContain("Page 8 Immigration Law Compliance");
  }, 20_000);

  it("Disability Accommodation text on p.9 is not labelled Immigration Law Compliance", () => {
    const out = cite(
      "It is the employee's responsibility to inform HR of any need for an accommodation, and the Company may ask for input on the type of accommodation believed necessary.",
    );
    expect(pagesIn(out.content)).toEqual(new Set([9]));
    expect(out.citations.map((citation) => citation.excerpt)).toEqual(["Disability Accommodation-Americans with Disability Act"]);
  }, 20_000);

  it("p.9 no longer lists Immigration Law Compliance among its headings", () => {
    const page9 = manuals()[0]!.pages.find((entry) => entry.page === 9)!;
    expect(page9.headings).not.toContain("Immigration Law Compliance");
    const page8 = manuals()[0]!.pages.find((entry) => entry.page === 8)!;
    expect(page8.headings).toContain("Immigration Law Compliance");
  });
});

/*
 * E1. Every other sweep turn read the manual (39,290 cached tokens); this one
 * retrieved 16 rows instead. `isPolicyAnswerQuestion` read "when does it
 * start" as a form command ("start"), ahead of the heard intent "policy".
 * The retrieval reply's adjacent markers ("[S6][S#]:") then kept "[S6]".
 */
describe("E1: Who is eligible for PTO and when does it start?", () => {
  const live = recorded("conv_mvnqof6h2aa9pd8");

  it("was answered from retrieval", () => {
    expect(live.trace.cacheReadInputTokens).toBe(0);
    expect(live.trace.retrievalCount).toBe(16);
  });

  it("is a policy question, heard as policy or not", () => {
    expect(isPolicyAnswerQuestion(live.question, "policy")).toBe(true);
    expect(isPolicyAnswerQuestion(live.question, null)).toBe(true);
  });

  it("a form command that starts something is still a form command", () => {
    expect(isPolicyAnswerQuestion("start a coaching form for Test Employee", null)).toBe(false);
    expect(isPolicyAnswerQuestion("Start the CA for Test Employee at Lawrence", null)).toBe(false);
  });

  it('adjacent markers are both taken out ("[S6][S2]:" kept "[S6]")', () => {
    expect(stripMarkers("**What they accrue** [S6][S2]:\n- 90 days")).toBe("**What they accrue**:\n- 90 days");
  });

  it("with the manual loaded, the stored reply is cited on 41 and 42 and loses [S6]", () => {
    const out = cite(live.content);
    expect(out.content).not.toContain("[S6]");
    expect(wordsInOrder(out.content)).toEqual(wordsInOrder(live.content));
    expect(pagesIn(lineWith(out.content, "All salaried managers"))).toContain(41);
    expect(pagesIn(lineWith(out.content, "10+ years full-time"))).toEqual(new Set([42]));
  }, 20_000);
});

/*
 * The sibling app's findings, through this app's engine, in this app's
 * wording. Sunny's live replies cited these correctly (the model wrote the
 * page itself); the engine had the same faults.
 */
describe("jury duty, PTO tier, and a marker the sentence reads through", () => {
  it("the summons sentence cites Jury Duty on p.47, not Witness Duty on p.48", () => {
    const out = cite(
      "- If an employee is summoned for jury duty, they need to show the summons to their supervisor as soon as possible so the supervisor can adjust the schedule around it [p.48].",
    );
    expect(pagesIn(out.content)).toEqual(new Set([47]));
    expect(out.citations.map((citation) => citation.excerpt)).toEqual(["Jury Duty"]);
  }, 20_000);

  it('"at [p.47]" never becomes "at,"', () => {
    const out = cite(
      "- The Company pays normal salary or hourly compensation for up to the stated number of days of jury service [p.47]. (The manual gives a specific day limit — 15 days — at [p.47], so I'll note that number is in the sources.)",
    );
    expect(out.content).not.toMatch(/\bat,/);
    expect(out.content).toContain("(The manual gives a specific day limit — 15 days, so I'll note that number is in the sources.)");
  }, 20_000);

  it("a marker the sentence reads through is re-pointed in place", () => {
    const out = cite("You will be paid your normal salary or hourly compensation for up to 15 days, as printed at [p.12].");
    expect(out.content).toBe("You will be paid your normal salary or hourly compensation for up to 15 days, as printed at [p.47].");
  }, 20_000);

  it("the first PTO tier cites p.41", () => {
    const out = cite(
      "A full-time manager begins accruing PTO after 90 days of employment in that position, and in the first tier — 90 days through 4 years of service — they earn 2 weeks (80 hours) of PTO, with a maximum accrual cap of 120 hours [p.42].",
    );
    expect(pagesIn(out.content)).toEqual(new Set([41]));
  }, 20_000);
});

describe("a reply answered from retrieval carries its [p.N] inline", () => {
  it("a manual excerpt's [S#] becomes the page its sentence restates, with that section as the source", () => {
    const out = citeRetrievedAnswer({
      content:
        "Employees shouldn't park in the spots closest to the front of the location — those are reserved for customers [S1]. Facial hair is acceptable as long as it's clean, well-groomed, and trimmed [S2]. Check the salon binder [S3].",
      manuals: manuals(),
      manualPagesOfMarker: (marker) => (marker === 1 ? [18] : marker === 2 ? [15, 16] : null),
    });
    expect(out.ok).toBe(true);
    expect(out.content).toBe(
      "Employees shouldn't park in the spots closest to the front of the location — those are reserved for customers [p.18]. Facial hair is acceptable as long as it's clean, well-groomed, and trimmed [p.16]. Check the salon binder [S3].",
    );
    expect(out.citations.map((citation) => `${citation.locator} ${citation.excerpt}`)).toEqual([
      "Page 18 Employee Parking",
      "Page 16 Facial Hair",
    ]);
  }, 20_000);

  it("the E1 tier lines, cited to the manual excerpt, carry 41 and 42; a line that restates nothing has no marker", () => {
    const out = citeRetrievedAnswer({
      content:
        "- 90 days – 4 years full-time: 2 weeks (80 hours), accrual cap 120 hours [S1]\n- 10+ years full-time: 4 weeks (160 hours), cap 200 hours [S2]\nLet me know the role [S1].",
      manuals: manuals(),
      manualPagesOfMarker: (marker) => (marker === 1 ? [41] : marker === 2 ? [42] : null),
    });
    expect(pagesIn(lineWith(out.content, "90 days – 4 years"))).toEqual(new Set([41]));
    expect(pagesIn(lineWith(out.content, "10+ years"))).toEqual(new Set([42]));
    expect(lineWith(out.content, "Let me know")).toBe("Let me know the role.");
  }, 20_000);

  it("reads a stored locator as printed pages", () => {
    expect(retrievedLocatorPages({ locator: "Page 41 — Eligibility", page: 42 })).toEqual([41]);
    expect(retrievedLocatorPages({ locator: "Pages 15–16 — Hair", page: 16 })).toEqual([15, 16]);
  });
});

/* Sunny's live replies that were right stay as they are. */
describe("guards: the sweep replies that were right are unchanged", () => {
  it.each([
    ["conv_mvnqt75n2lvvtrb", [47]],
    ["conv_mvnqow6y2zn8pj5", [41, 42]],
    ["conv_mvnq8s5c2a990pj", [12, 18]],
    ["conv_mvnq7l7p2fbyqf5", [15, 16]],
  ] as const)("%s keeps its words and its pages %j", (id, pages) => {
    const live = recorded(id);
    const out = cite(live.content);
    expect(out.content).toBe(live.content);
    expect([...pagesIn(out.content)].sort((a, b) => a - b)).toEqual([...pages]);
  }, 20_000);
});

/*
 * QA Round 17, conv_mvo0ayai2x20aiy turn 3: "The NCR and Fitzpatrick Skin
 * Type Chart, EFT Agreements" was answered "nothing on … the Fitzpatrick
 * Skin Type Chart". The manual prints it on p.49 (Consent Forms: "Every
 * client must also fill out the skin typing chart"). The turn never had the
 * manual: the gate read intent "other", and the retrieval query was the
 * earlier turn's "Employment Verification", so p.49 was not retrieved either.
 * Not the model denying a page it had.
 */
describe("Round 17: The NCR and Fitzpatrick Skin Type Chart, EFT Agreements", () => {
  const live = recorded("conv_mvo0ayai2x20aiy");

  it("was answered from retrieval, without the manual", () => {
    expect(live.trace.cacheReadInputTokens).toBe(0);
    expect(live.trace.retrievalCount).toBe(49);
    expect(live.content).toContain("nothing on the NCR, the Fitzpatrick Skin Type Chart");
  });

  it("the gate does not take it (heard as 'other', or with no intent)", () => {
    expect(isPolicyAnswerQuestion(live.question, "other")).toBe(false);
    expect(isPolicyAnswerQuestion(live.question, null)).toBe(false);
  });

  it("the manual prints the skin typing chart on p.49, and the wide gate's heading check takes the question", () => {
    const block = choosePolicyManuals(live.question, [manual()]);
    if (!block.ok) throw new Error("manual did not assemble");
    expect(block.block).toMatch(/\[p\.49\][\s\S]*Every client must also fill out the skin typing chart/);
    // "skin" is a word of the p.49 heading "Tanning with Skin Cancer", printed on few pages.
    expect(asksAboutManual(live.question, manuals())).toBe(true);
  });
});
