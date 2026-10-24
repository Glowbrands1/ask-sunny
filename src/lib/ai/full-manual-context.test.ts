import { afterEach, describe, expect, it } from "vitest";

import { fullManualContextEnabled } from "@/lib/config/chat-quality-flags";

import { JBA_MANUAL_CHUNKS } from "./__fixtures__/jba-policy-manual";
import { noteModelCall } from "./model-failure";
import { runChatTrace, runWithRequestClock, type ChatTraceDraft } from "./chat-trace-store";
import { systemWithCachedManual } from "./prompt-cache";
import {
  applyFullManualAnswer,
  assembleManual,
  choosePolicyManuals,
  dropUnknownSourceMarkers,
  estimateTokens,
  FULL_MANUAL_TOKEN_BUDGET,
  isPolicyAnswerQuestion,
  needsRetrievalFallback,
  type FullManualDocument,
} from "./full-manual-context";

const SAVED = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in SAVED)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(SAVED)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function manual(
  title: string,
  chunks: FullManualDocument["chunks"],
  id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
): FullManualDocument {
  return { id, title, category: "policies_compliance", chunks };
}

function chunk(
  chunkIndex: number,
  page: number | null,
  section: string | null,
  content: string,
  printedPage?: number | null,
): FullManualDocument["chunks"][number] {
  return { chunkIndex, page, printedPage: printedPage ?? null, section, content };
}

function occurrences(text: string, needle: string): number {
  return needle ? text.split(needle).length - 1 : 0;
}

const JBA = manual("JBA Policy Manual Edited 5.2025", [
  chunk(2, 20, "Dress Code for The Company", "Black shoes."),
  chunk(0, 19, "Attendance", "Be on time."),
  chunk(1, 19, "Attendance", "Call two hours ahead."),
]);

const OLDER_JBA = manual("JBA Policy Manual Edited 10.2024", [
  chunk(0, 12, "Attendance", "Older wording."),
]);

const BUFF = manual("Buff City Soap Policy Manual 2026", [
  chunk(0, 4, "Breaks", "A paid break is 10 minutes."),
]);

const CRUNCH = manual("Crunch Fitness Policy Manual 2026", [
  chunk(0, 2, "Dress Code", "Crunch-only manual shirt rule."),
]);

const TRAINING = manual("DM Training Manual 10.2026", [
  chunk(0, 3, "Opening", "Open at 9."),
]);

describe("full manual assembly", () => {
  it("rebuilds chunks in order with page markers and section headings", () => {
    const assembled = assembleManual(JBA);
    expect(assembled.displayTitle).toBe("JBA Policy Manual");
    expect(assembled.text.indexOf("[p.19]")).toBeLessThan(assembled.text.indexOf("[p.20]"));
    expect(assembled.text.indexOf("Be on time.")).toBeLessThan(assembled.text.indexOf("Call two hours ahead."));
    expect(assembled.text.indexOf("Call two hours ahead.")).toBeLessThan(assembled.text.indexOf("[p.20]"));
    expect(assembled.text).toContain("## Attendance");
    expect(assembled.text).toContain("## Dress Code for The Company");
    expect(assembled.text.match(/## Attendance/g)).toHaveLength(1);
    expect(assembled.pages.map((page) => page.page)).toEqual([19, 20]);
    expect(assembled.pages[0]?.headings).toEqual(["Attendance"]);
    expect(estimateTokens(assembled.text)).toBe(Math.ceil(assembled.text.length / 4));
  });

  it("loads only the JBA Policy Manual when the question names JBA", () => {
    const result = choosePolicyManuals("What does the JBA policy manual say about attendance?", [
      JBA,
      OLDER_JBA,
      BUFF,
      TRAINING,
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manuals.map((item) => item.title)).toEqual(["JBA Policy Manual Edited 5.2025"]);
    expect(result.block).toContain("[p.19]");
    expect(result.block).toContain("Cite as: JBA Policy Manual");
    expect(result.block).not.toContain("Buff City");
    expect(result.block).not.toContain("Open at 9");
    expect(result.tokens).toBeLessThan(FULL_MANUAL_TOKEN_BUDGET);
  });

  it("answers an unbranded HR question from the JBA Policy Manual only", () => {
    const result = choosePolicyManuals("What is the attendance policy?", [TRAINING, BUFF, CRUNCH, OLDER_JBA, JBA]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manuals.map((item) => item.title)).toEqual(["JBA Policy Manual Edited 5.2025"]);
    expect(result.block).toContain("Be on time.");
    expect(result.block).not.toMatch(/buff city|crunch/i);
    expect(result.block).not.toContain("Open at 9");
    expect(result.block).not.toContain("Older wording");
    expect(result.tokens).toBeLessThanOrEqual(FULL_MANUAL_TOKEN_BUDGET);
  });

  it("keeps shared JBA policy and Sun Tan City sections, and leaves out Buff City Soap and Crunch", () => {
    const branded = manual("JBA Policy Manual Edited 5.2025", [
      chunk(
        0,
        3,
        "Table of Contents",
        [
          "Table of Contents",
          "Attendance ................................................................ 14",
          "Crunch Fitness Specific Dress Code ............................................... 16",
          "Buff City Soap ......................................................................... 16",
          "Sun Tan City .......................................................................... 17",
          "Employee Parking .................................................................... 19",
        ].join("\n"),
      ),
      chunk(1, 14, "Attendance", "Be on time for every scheduled shift."),
      chunk(2, 15, "All Locations Dress Code", "Every salon follows the company dress code."),
      chunk(3, 15, "Dress Code for The Company", "A neat, clean, professional appearance."),
      chunk(4, 15, "Shoes", "Black shoes are required."),
      chunk(5, 16, "Crunch Fitness Specific Dress Code", "Crunch-only shirt rule."),
      chunk(6, 16, "Shirts", "Crunch shirt color."),
      chunk(7, 16, null, "More crunch shirt detail."),
      chunk(8, 16, "Buff City Soap", "Buff apron rule."),
      chunk(9, 17, "Sun Tan City", "Wear the salon uniform shirt."),
      chunk(10, 17, "Shirts", "Sun Tan City shirt is the salon uniform."),
      chunk(11, 18, "JBA Office", "Office staff wear business casual."),
      chunk(12, 19, "Employee Parking", "Park in the employee lot."),
      chunk(
        13,
        20,
        "Dress Code for The Company",
        [
          "Company dress code applies at every salon.",
          "Crunch Fitness Specific Dress Code",
          "Crunch-only pants rule.",
          "Sun Tan City",
          "STC name tag is required.",
        ].join("\n"),
      ),
    ]);
    const result = choosePolicyManuals("What is the dress code?", [branded, BUFF, CRUNCH]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manuals.map((item) => item.title)).toEqual(["JBA Policy Manual Edited 5.2025"]);
    expect(result.block).toContain("## Attendance");
    expect(result.block).toContain("Be on time for every scheduled shift.");
    expect(result.block).toContain("## All Locations Dress Code");
    expect(result.block).toContain("Every salon follows the company dress code.");
    expect(result.block).toContain("## Dress Code for The Company");
    expect(result.block).toContain("A neat, clean, professional appearance.");
    expect(result.block).toContain("Black shoes are required.");
    expect(result.block).toContain("## Sun Tan City");
    expect(result.block).toContain("Wear the salon uniform shirt.");
    expect(result.block).toContain("Sun Tan City shirt is the salon uniform.");
    expect(result.block).toContain("Park in the employee lot.");
    expect(result.block).toContain("Company dress code applies at every salon.");
    expect(result.block).toContain("STC name tag is required.");
    expect(result.block).not.toContain("Table of Contents");
    expect(result.block).not.toContain("Attendance ................................................................ 14");
    expect(result.block).not.toContain("Sun Tan City .......................................................................... 17");
    expect(result.block).not.toContain("[p.3]");
    expect(result.block).not.toMatch(/crunch|buff/i);
    expect(result.block).not.toContain("JBA Office");
    expect(result.block).not.toContain("Office staff wear business casual.");
    expect(result.block).not.toContain("More crunch shirt detail.");

    const checked = applyFullManualAnswer({
      content: "See Buff City Soap, JBA Policy Manual p.16. Wear the uniform. Sun Tan City, JBA Policy Manual p.17.",
      manuals: result.manuals,
      sourceCount: 0,
    });
    expect(checked.content).not.toContain("Buff");
    expect(checked.content).toContain("Sun Tan City, JBA Policy Manual p.17");
  });
});

describe("conv_mvmjem0c2wzftv2, conv_mvmjfgcv573j1oz, conv_mvmjfwnx8psm0nx", () => {
  const BLACKOUT = "Blackout dates are the week of Thanksgiving and the week of Christmas.";
  const NOTICE = "A request needs two weeks of notice.";
  const TATTOOS = "Tattoos must be covered while on the clock.";
  const JEWELRY = "Jewelry is limited to a wedding band and stud earrings.";

  it("conv_mvmjem0c2wzftv2 leaves the table of contents out and cites PTO on printed page 42", () => {
    const result = choosePolicyManuals("What is the PTO policy?", [
      manual("JBA Policy Manual Edited 5.2025", [
        chunk(
          2,
          3,
          "Table of Contents",
          "Table of Contents\nPaid time Off (PTO) .............................................................................. 42",
          2,
        ),
        chunk(
          8,
          6,
          null,
          "Paid time Off (PTO) ................................................................................ 42\nHoliday Benefits .................................................................................... 43",
          5,
        ),
        chunk(17, 7, "Reference List", "6 | P a g e\nReference List\nThe leadership roster is printed here.", 6),
        chunk(
          136,
          43,
          "Paid time Off (PTO)",
          `42 | P a g e\nPaid time Off (PTO)\nPaid time off accrues each pay period. ${BLACKOUT}`,
          42,
        ),
        chunk(
          137,
          43,
          "Paid time Off (PTO)",
          `Paid time off accrues each pay period. ${BLACKOUT}\n\n${NOTICE}`,
          42,
        ),
      ]),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.block).not.toContain("Table of Contents");
    expect(result.block).not.toContain("Holiday Benefits");
    expect(result.block).not.toContain("[p.43]");
    expect(result.block).not.toContain("[p.5]");
    expect(result.block).not.toContain("P a g e");
    expect(result.block).toContain("[p.42]");
    expect(result.block).toContain("## Paid time Off (PTO)");
    expect(result.block).toContain("## Reference List");
    expect(result.block).toContain("[p.6]");
    expect(result.block.indexOf("[p.6]")).toBeLessThan(result.block.indexOf("## Reference List"));
    expect(occurrences(result.block, BLACKOUT)).toBe(1);
    expect(occurrences(result.block, NOTICE)).toBe(1);

    const checked = applyFullManualAnswer({
      content: [
        `Paid time off accrues each pay period. ${BLACKOUT}`,
        "Paid time Off (PTO), JBA Policy Manual p.42 and p.6 [p.42][p.6][S9][S11].",
        "See the DM manual p.6 and the Salon Director manual pp.3-5.",
        "See Table of Contents, JBA Policy Manual p.6.",
      ].join(" "),
      manuals: result.manuals,
      sourceCount: 0,
    });
    expect(checked.content).toContain(BLACKOUT);
    expect(checked.content).toContain("Paid time Off (PTO), JBA Policy Manual p.42 [p.42]");
    expect(checked.content).not.toContain("p.6");
    expect(checked.content).not.toContain("[S");
    expect(checked.content).not.toMatch(/DM manual|Salon Director|Table of Contents/i);
    expect(checked.content.match(/\[p\.\d+\]/g)).toEqual(["[p.42]"]);
    expect(checked.citations).toEqual([
      expect.objectContaining({
        documentTitle: "JBA Policy Manual",
        excerpt: "Paid time Off (PTO)",
        locator: "Page 42",
      }),
    ]);
  });

  it("conv_mvmjfgcv573j1oz cites Cell Phone/Smart Watch on the printed page", () => {
    const paired = JBA_MANUAL_CHUNKS.filter((item) => item.page != null && item.printedPage != null);
    expect(paired.length).toBeGreaterThanOrEqual(109);
    expect(new Set(paired.map((item) => (item.page ?? 0) - (item.printedPage ?? 0)))).toEqual(new Set([1]));
    const cover = JBA_MANUAL_CHUNKS.filter((item) => item.page === 1);
    expect(cover.length).toBeGreaterThan(0);
    expect(cover.every((item) => item.printedPage == null)).toBe(true);
    const phone = JBA_MANUAL_CHUNKS.find((item) => item.section === "Cell Phone/Smart Watch Policy");
    const sibling = JBA_MANUAL_CHUNKS.find((item) => item.chunkIndex === 42);
    expect(phone).toMatchObject({ chunkIndex: 43, page: 20, printedPage: 19 });
    expect(sibling).toMatchObject({ page: 20, printedPage: 19 });
    expect(sibling?.content.startsWith("19 | P a g e")).toBe(true);
    expect(phone?.content.includes("P a g e")).toBe(false);

    const result = choosePolicyManuals("What is the cell phone policy?", [
      manual("JBA Policy Manual Edited 5.2025", [
        chunk(42, 20, "Discounting", "19 | P a g e\nAsk a manager before a discount."),
        chunk(43, 20, "Cell Phone/Smart Watch Policy", "Phones stay off the sales floor during a shift."),
      ]),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.block).toContain("[p.19]");
    expect(result.block).not.toContain("[p.20]");
    expect(result.block).not.toContain("P a g e");
    expect(result.block).toContain("## Cell Phone/Smart Watch Policy");
    expect(result.block).toContain("Phones stay off the sales floor during a shift.");
    const checked = applyFullManualAnswer({
      content:
        "Phones stay off the sales floor during a shift. Cell Phone/Smart Watch Policy, JBA Policy Manual p.20 [p.20][S9]. See the DM manual p.6.",
      manuals: result.manuals,
      sourceCount: 0,
    });
    expect(checked.content).toContain("Phones stay off the sales floor during a shift.");
    expect(checked.content).toContain("Cell Phone/Smart Watch Policy, JBA Policy Manual p.19 [p.19]");
    expect(checked.content).not.toContain("p.20");
    expect(checked.content).not.toContain("[S");
    expect(checked.content).not.toMatch(/DM manual/i);
    expect(checked.content.match(/\[p\.\d+\]/g)).toEqual(["[p.19]"]);
    expect(checked.citations).toEqual([
      expect.objectContaining({
        documentTitle: "JBA Policy Manual",
        excerpt: "Cell Phone/Smart Watch Policy",
        locator: "Page 19",
      }),
    ]);
  });

  it("conv_mvmjfwnx8psm0nx rebuilds Tattoos and Jewelry without a repeated or broken line", () => {
    const result = choosePolicyManuals("What is the dress code?", [
      manual("JBA Policy Manual Edited 5.2025", [
        chunk(60, 16, "Dress Code for The Company", `A neat appearance is required.\n\n${TATTOOS}`, 15),
        chunk(61, 16, "Tattoos", `${TATTOOS}\n\n${JEWELRY}`, 15),
        chunk(62, 16, "Jewelry", `${JEWELRY}\n\nNo facial piercings.`, 15),
        chunk(63, 16, "Tattoos", "Visible tattoos", 15),
        chunk(64, 16, "Tattoos", "must be covered on the arms.", 15),
      ]),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.block).toContain("[p.15]");
    expect(result.block).not.toContain("[p.16]");
    expect(result.block).toContain("## Tattoos");
    expect(result.block).toContain("## Jewelry");
    expect(occurrences(result.block, TATTOOS)).toBe(1);
    expect(occurrences(result.block, JEWELRY)).toBe(1);
    expect(occurrences(result.block, "No facial piercings.")).toBe(1);
    expect(occurrences(result.block, "Visible tattoos must be covered on the arms.")).toBe(1);
    expect(result.block).not.toContain("Visible tattoos\n");
  });

  it("conv_mvmjfwnx8psm0nx cites Tattoos and Jewelry on printed page 16, Sun Tan City only", () => {
    const result = choosePolicyManuals("What is the dress code for tattoos and jewelry?", [
      manual("JBA Policy Manual Edited 5.2025", [
        chunk(60, 17, "Dress Code for The Company", `A neat appearance is required.\n\n${TATTOOS}`, 16),
        chunk(61, 17, "Tattoos", `${TATTOOS}\n\n${JEWELRY}`, 16),
        chunk(62, 17, "Jewelry/Accessories", `${JEWELRY}\n\nNo facial piercings.`, 16),
        chunk(63, 17, "Buff City Soap", "Buff apron rule.", 16),
        chunk(64, 17, "Crunch Fitness Specific Dress Code", "Crunch-only shirt rule.", 16),
        chunk(65, 17, "Sun Tan City", "Wear the salon uniform shirt.", 16),
        chunk(66, 6, null, "Tattoos ................................................................ 16", 5),
      ]),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.block).toContain("[p.16]");
    expect(result.block).not.toContain("[p.17]");
    expect(result.block).toContain("## Tattoos");
    expect(result.block).toContain("## Jewelry/Accessories");
    expect(result.block).toContain("## Sun Tan City");
    expect(result.block).toContain("Wear the salon uniform shirt.");
    expect(occurrences(result.block, TATTOOS)).toBe(1);
    expect(occurrences(result.block, JEWELRY)).toBe(1);
    expect(result.block).not.toMatch(/buff|crunch|table of contents/i);
    expect(result.block).not.toContain("Tattoos ................................................................ 16");

    const checked = applyFullManualAnswer({
      content: [
        `${TATTOOS} Tattoos, JBA Policy Manual p.17 [p.17].`,
        `${JEWELRY} Jewelry/Accessories, JBA Policy Manual p.17 [S11].`,
        "See Buff City Soap p.16 and the Crunch policy manual p.16.",
        "Salon Director manual pp.3-5.",
      ].join(" "),
      manuals: result.manuals,
      sourceCount: 0,
    });
    expect(checked.content).toContain(TATTOOS);
    expect(checked.content).toContain(JEWELRY);
    expect(checked.content).toContain("Tattoos, JBA Policy Manual p.16 [p.16]");
    expect(checked.content).toContain("Jewelry/Accessories, JBA Policy Manual p.16 [p.16]");
    expect(checked.content).not.toContain("p.17");
    expect(checked.content).not.toContain("[S");
    expect(checked.content).not.toMatch(/Buff|Crunch|Salon Director/i);
    expect(checked.content.match(/\[p\.\d+\]/g)).toEqual(["[p.16]", "[p.16]"]);
    expect(checked.citations).toEqual([
      expect.objectContaining({
        documentTitle: "JBA Policy Manual",
        excerpt: "Tattoos",
        locator: "Page 16",
      }),
      expect.objectContaining({
        documentTitle: "JBA Policy Manual",
        excerpt: "Jewelry/Accessories",
        locator: "Page 16",
      }),
    ]);
  });

  it("does not shift a cover sheet that has no printed page", () => {
    const assembled = assembleManual(
      manual("JBA Policy Manual Edited 5.2025", [
        chunk(0, 1, null, "Cover sheet."),
        chunk(1, 1, null, "1 | P a g e\nOpening line."),
      ]),
    );
    expect(assembled.text).toContain("[p.1]");
    expect(assembled.text).not.toContain("[p.0]");
    expect(assembled.text).not.toContain("P a g e");
    expect(assembled.text.indexOf("Cover sheet.")).toBeLessThan(assembled.text.indexOf("Opening line."));
  });
});

describe("citation validation", () => {
  it("keeps a real page, fixes a heading that is on another page, and drops an invented one", () => {
    const result = choosePolicyManuals("What is the attendance policy?", [JBA]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const checked = applyFullManualAnswer({
      content: [
        "Be on time. See Attendance, JBA Policy Manual p.19.",
        "Dress Code, JBA Policy Manual p.99.",
        "Also Unicorn Policy, JBA Policy Manual p.19.",
      ].join("\n"),
      manuals: result.manuals,
      sourceCount: 0,
    });
    expect(checked.content).toContain("Attendance, JBA Policy Manual p.19");
    expect(checked.content).toContain("Dress Code for The Company, JBA Policy Manual p.20");
    expect(checked.content).not.toContain("p.99");
    expect(checked.content).not.toContain("Unicorn");
    expect(checked.citations.map((citation) => citation.locator)).toEqual(["Page 19", "Page 20"]);
    expect(checked.citations.every((citation) => citation.documentTitle === "JBA Policy Manual")).toBe(true);
  });

  it("drops an out-of-range [S11] when only 8 sources exist", () => {
    const text = "Attendance is required [S11]. Call ahead [S8]. See [S3]. Not [S9].";
    expect(dropUnknownSourceMarkers(text, 8)).toBe("Attendance is required. Call ahead [S8]. See [S3]. Not.");
    const checked = applyFullManualAnswer({ content: text, manuals: [], sourceCount: 8 });
    expect(checked.content).not.toContain("[S11]");
    expect(checked.content).not.toContain("[S9]");
    expect(checked.content).toContain("[S8]");
    expect(checked.content).toContain("[S3]");
    expect(checked.citations).toEqual([]);
  });
});

describe("fallback", () => {
  it("keeps retrieval when no policy manual is in scope", () => {
    const result = choosePolicyManuals("What is the attendance policy?", [TRAINING]);
    expect(result).toEqual({ ok: false, reason: "missing" });
    expect(needsRetrievalFallback(result)).toBe(true);
  });

  it("keeps retrieval when the manual is over the token budget", () => {
    const huge = manual("JBA Policy Manual Edited 5.2025", [
      chunk(0, 14, "Attendance", "x".repeat(2_000)),
    ]);
    const result = choosePolicyManuals("What does JBA policy say about attendance?", [huge], { budgetTokens: 30 });
    expect(result).toEqual({ ok: false, reason: "over_budget" });
    expect(needsRetrievalFallback(result)).toBe(true);
  });

  it("does not treat a DM manual question as a policy-manual answer", () => {
    expect(isPolicyAnswerQuestion("What does the STC DM manual say about opening?", null)).toBe(false);
    expect(isPolicyAnswerQuestion("create a corrective action for attendance", null)).toBe(false);
    expect(isPolicyAnswerQuestion("What is the attendance policy?", "search")).toBe(true);
    expect(isPolicyAnswerQuestion("hello", "policy")).toBe(true);
  });
});

describe("cached system block and end-to-end latency", () => {
  it("defaults the flag off and caches the manual ahead of the system prompt", () => {
    delete process.env.FULL_MANUAL_CONTEXT_ENABLED;
    delete process.env.PROMPT_CACHE_ENABLED;
    expect(fullManualContextEnabled()).toBe(false);
    expect(systemWithCachedManual("You are Sunny.", null)).toBe("You are Sunny.");
    expect(systemWithCachedManual("You are Sunny.", "FULL POLICY MANUAL\n\n[p.19]")).toEqual([
      { type: "text", text: "FULL POLICY MANUAL\n\n[p.19]", cache_control: { type: "ephemeral" } },
      { type: "text", text: "You are Sunny." },
    ]);
  });

  it("records request-to-last-token separately from the model call", async () => {
    const trace: ChatTraceDraft = {
      startedAt: Date.now(),
      conversationId: null,
      messageId: null,
      userId: null,
      originalQuery: "What is the attendance policy?",
      rewrittenQuery: null,
      intent: "policy",
      retrievalCount: null,
      retrieved: [],
      prompt: null,
      formInProgress: false,
      modelCall: null,
      errorSubtype: null,
      errorClass: null,
      errorStatus: null,
      succeeded: null,
    };
    const received = Date.now() - 40;
    await runWithRequestClock(async () => {
      await runChatTrace(trace, async () => {
        noteModelCall({
          model: "claude-opus-5",
          maxTokens: 1024,
          stopReason: "end_turn",
          latencyMs: 12,
          usage: { cache_read_input_tokens: 34872, cache_creation_input_tokens: 0 },
        });
      });
    }, received);
    expect(trace.modelCall?.latencyMs).toBe(12);
    expect(trace.modelCall?.e2eLatencyMs).toBeGreaterThanOrEqual(40);
    expect(trace.modelCall?.cacheReadInputTokens).toBe(34872);
  });
});
