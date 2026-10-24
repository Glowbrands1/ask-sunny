import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { fullManualContextEnabled } from "@/lib/config/chat-quality-flags";

import { JBA_MANUAL_CHUNKS } from "./__fixtures__/jba-policy-manual";
import { collectModelResult } from "./call-claude";
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

/** Every page named in the answer or its Sources rows, so a stray page fails the check. */
function pagesIn(checked: {
  readonly content: string;
  readonly citations: readonly { readonly locator: string }[];
}): number[] {
  const pages = new Set<number>();
  for (const match of checked.content.matchAll(/\bpp?\.\s*(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?/gi)) {
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    const last = Number.isInteger(end) && end >= start && end - start <= 30 ? end : start;
    for (let page = start; page <= last; page += 1) pages.add(page);
  }
  for (const citation of checked.citations) {
    for (const match of citation.locator.matchAll(/\b(\d{1,4})\b/g)) pages.add(Number(match[1]));
  }
  return [...pages].sort((a, b) => a - b);
}

/**
 * Model words, in order, with `[p.N]` and `[S#]` ignored.
 *
 * Appending a marker or removing one whose page is not a Sources row does
 * not change this list. Deleting or splitting a word the model wrote does.
 */
function proseWords(text: string): string[] {
  return text.toLowerCase().replace(/\[(?:p\.\d+|s\d+)\]/gi, " ").match(/[a-z0-9]+/g) ?? [];
}

function wordsRemainInOrder(model: string, final: string): boolean {
  const source = proseWords(model);
  const out = proseWords(final);
  return source.length === out.length && source.every((word, index) => word === out[index]);
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

    // f44631a deleted the Buff City Soap sentence. The post-processor no longer
    // deletes model words. Page 16 is the excluded brand sheet, so it is not a
    // Sources row and no [p.16] is appended. Page 17 is, and the marker goes
    // after the sentence.
    const model = "See Buff City Soap, JBA Policy Manual p.16. Wear the uniform. Sun Tan City, JBA Policy Manual p.17.";
    const checked = applyFullManualAnswer({
      content: model,
      manuals: result.manuals,
      sourceCount: 0,
      question: "What is the dress code?",
    });
    expect(wordsRemainInOrder(model, checked.content)).toBe(true);
    expect(checked.content).toContain("See Buff City Soap, JBA Policy Manual p.16.");
    expect(checked.content).toContain("Sun Tan City, JBA Policy Manual p.17. [p.17]");
    expect(checked.content).not.toContain("[p.16]");
  });
});

describe("conv_mvmjem0c2wzftv2, conv_mvmjfgcv573j1oz, conv_mvmjfwnx8psm0nx", () => {
  const BLACKOUT = "Blackout dates are the week of Thanksgiving and the week of Christmas.";
  const NOTICE = "A request needs two weeks of notice.";
  const TATTOOS = "Tattoos must be covered while on the clock.";
  const JEWELRY = "Jewelry is limited to a wedding band and stud earrings.";

  it("conv_mvmjem0c2wzftv2 leaves the table of contents out and cites PTO on printed page 41", () => {
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
          42,
          "Paid time Off (PTO)",
          `41 | P a g e\nPaid time Off (PTO)\nPaid time off accrues each pay period. ${BLACKOUT}`,
          42,
        ),
        chunk(
          137,
          42,
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
    expect(result.block).not.toContain("[p.42]");
    expect(result.block).not.toContain("[p.43]");
    expect(result.block).not.toContain("[p.5]");
    expect(result.block).not.toContain("P a g e");
    expect(result.block).toContain("[p.41]");
    expect(result.block).toContain("## Paid time Off (PTO)");
    expect(result.block).toContain("## Reference List");
    expect(result.block).toContain("[p.6]");
    expect(result.block.indexOf("[p.6]")).toBeLessThan(result.block.indexOf("## Reference List"));
    expect(occurrences(result.block, BLACKOUT)).toBe(1);
    expect(occurrences(result.block, NOTICE)).toBe(1);

    // f44631a rewrote prose "p.42" to "p.41" and deleted the DM manual, Salon
    // Director, and Table of Contents sentences. Those words stay. The sheet
    // prints 41, so a [p.42] marker has no Sources row. Page 6 is the
    // Reference List and does not answer a PTO question, so its marker is
    // removed too. [p.41] is not invented from a sentence that said p.42.
    const model = [
      `Paid time off accrues each pay period. ${BLACKOUT}`,
      "Paid time Off (PTO), JBA Policy Manual p.42 and p.6 [p.42][p.6][S9][S11].",
      "See the DM manual p.6 and the Salon Director manual pp.3-5.",
      "See Table of Contents, JBA Policy Manual p.6.",
    ].join(" ");
    const checked = applyFullManualAnswer({
      content: model,
      manuals: result.manuals,
      sourceCount: 0,
      question: "What is the PTO policy?",
    });
    expect(wordsRemainInOrder(model, checked.content)).toBe(true);
    expect(checked.content).toContain(BLACKOUT);
    expect(checked.content).toContain("Paid time Off (PTO), JBA Policy Manual p.42 and p.6.");
    expect(checked.content).toContain("See the DM manual p.6 and the Salon Director manual pp.3-5.");
    expect(checked.content).toContain("See Table of Contents, JBA Policy Manual p.6.");
    expect(checked.content).not.toMatch(/\[p\.\d+\]/);
    expect(checked.content).not.toContain("[S");
    expect(checked.citations).toEqual([]);
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
        chunk(42, 20, "Discounting", "19 | P a g e\nAsk a manager before a discount.", 20),
        chunk(43, 20, "Cell Phone/Smart Watch Policy", "Phones stay off the sales floor during a shift.", 20),
      ]),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.block).toContain("[p.19]");
    expect(result.block).not.toContain("[p.20]");
    expect(result.block).not.toContain("P a g e");
    expect(result.block).toContain("## Cell Phone/Smart Watch Policy");
    expect(result.block).toContain("Phones stay off the sales floor during a shift.");
    // f44631a rewrote prose "p.20" to "p.19" and deleted the DM manual sentence.
    // The printed page is 19, so the model's [p.20] has no Sources row and is
    // removed. The words "p.20" and "DM manual" stay, and [p.19] is not invented.
    const model =
      "Phones stay off the sales floor during a shift. Cell Phone/Smart Watch Policy, JBA Policy Manual p.20 [p.20][S9]. See the DM manual p.6.";
    const checked = applyFullManualAnswer({
      content: model,
      manuals: result.manuals,
      sourceCount: 0,
      question: "What is the cell phone policy?",
    });
    expect(wordsRemainInOrder(model, checked.content)).toBe(true);
    expect(checked.content).toContain("Phones stay off the sales floor during a shift.");
    expect(checked.content).toContain("Cell Phone/Smart Watch Policy, JBA Policy Manual p.20.");
    expect(checked.content).toContain("See the DM manual p.6.");
    expect(checked.content).not.toMatch(/\[p\.\d+\]/);
    expect(checked.content).not.toContain("[S");
    expect(checked.citations).toEqual([]);
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

  it("conv_mvmjfwnx8psm0nx cites shared dress code on pages 15 and 16, and Sun Tan City items on page 17", () => {
    const stored = (heading: string) =>
      JBA_MANUAL_CHUNKS.find(
        (item) =>
          item.section === heading || (item.sections ?? []).some((section) => section.heading === heading),
      );
    const shoes = stored("Shoes");
    const tattoos = stored("Tattoos");
    const jewelry = stored("Jewelry/Accessories");
    const tanning = stored("Tanning");
    const sunTan = stored("Sun Tan City");
    const stcShirts = stored("Shirts");
    const stcPants = stored("Pants");
    expect(shoes).toMatchObject({ printedPage: 15, page: 16 });
    expect(tattoos).toMatchObject({ printedPage: 16, page: 17 });
    expect(jewelry).toMatchObject({ printedPage: 16, page: 17 });
    expect(sunTan).toMatchObject({ printedPage: 17, page: 18 });
    expect(stcShirts).toMatchObject({ printedPage: 17, page: 18 });
    expect(stcPants).toMatchObject({ printedPage: 17, page: 18 });
    expect(tanning).toMatchObject({ printedPage: 17, page: 18 });
    expect(sunTan?.content).toContain("Sun Tan City:");
    expect(sunTan?.content).toContain("\nShirts\n");
    expect(stcPants?.content).toContain("Pants");
    expect(tanning?.content).toContain("Tanning");
    expect((shoes?.sections ?? []).some((section) => section.heading === "Shoes" && section.page === 15)).toBe(true);
    expect((tattoos?.sections ?? []).some((section) => section.heading === "Tattoos" && section.page === 16)).toBe(
      true,
    );
    expect(
      (jewelry?.sections ?? []).some((section) => section.heading === "Jewelry/Accessories" && section.page === 16),
    ).toBe(true);
    expect((sunTan?.sections ?? []).some((section) => section.heading === "Shirts" && section.page === 17)).toBe(true);
    expect((stcPants?.sections ?? []).some((section) => section.heading === "Pants" && section.page === 17)).toBe(
      true,
    );
    expect((tanning?.sections ?? []).some((section) => section.heading === "Tanning" && section.page === 17)).toBe(
      true,
    );

    const result = choosePolicyManuals("What is the dress code for tattoos and jewelry?", [
      manual("JBA Policy Manual Edited 5.2025", [
        chunk(60, 16, "Dress Code for The Company", "15 | P a g e\nA neat appearance is required.", 16),
        chunk(61, 16, "All Locations Dress Code", "Every salon follows the company dress code.", 16),
        chunk(62, 16, "Name tags", "A name tag is worn on the shirt.", 16),
        chunk(63, 16, "Shoes", "No sandals, crocs.", 16),
        chunk(64, 16, "Belts", "A belt is worn with pants.", 16),
        chunk(65, 16, "Hair", "Hair is tied back.", 16),
        chunk(66, 16, "Facial Hair", "Facial hair is neatly trimmed.", 16),
        chunk(67, 16, "Make-up", "Make-up is simple.", 16),
        chunk(68, 17, "Jewelry/Accessories", `16 | P a g e\n${JEWELRY}`, 17),
        chunk(69, 17, "Tattoos", TATTOOS, 17),
        chunk(70, 17, "Crunch Fitness Specific Dress Code", "Crunch-only shirt rule.", 17),
        chunk(71, 17, "Shirts", "Crunch shirt color.", 17),
        chunk(72, 17, "Pants", "Crunch pants color.", 17),
        chunk(73, 17, "Buff City Soap", "Buff apron rule.", 17),
        chunk(74, 17, "Shirts", "Buff shirt color.", 17),
        chunk(75, 18, "Sun Tan City", "17 | P a g e\nWear the salon uniform shirt.", 18),
        chunk(76, 18, "Shirts", "Sun Tan City shirt is the salon uniform.", 18),
        chunk(77, 18, "Pants", "Black pants.", 18),
        chunk(78, 18, "Tanning", "Staff may tan.", 18),
        chunk(79, 6, null, "Tattoos ................................................................ 16", 5),
      ]),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.block).toContain("[p.15]");
    expect(result.block).toContain("[p.16]");
    expect(result.block).toContain("[p.17]");
    expect(result.block).not.toContain("[p.18]");
    expect(result.block).toContain("## Shoes");
    expect(result.block).toContain("## Name tags");
    expect(result.block).toContain("## Tattoos");
    expect(result.block).toContain("## Jewelry/Accessories");
    expect(result.block).toContain("## Sun Tan City");
    expect(result.block).toContain("## Shirts");
    expect(result.block).toContain("## Pants");
    expect(result.block).toContain("## Tanning");
    expect(result.block).toContain("Sun Tan City shirt is the salon uniform.");
    expect(result.block).toContain("Black pants.");
    expect(result.block).toContain("Staff may tan.");
    expect(result.block).toContain("No sandals, crocs.");
    expect(occurrences(result.block, TATTOOS)).toBe(1);
    expect(occurrences(result.block, JEWELRY)).toBe(1);
    expect(result.block).not.toMatch(/buff|crunch|table of contents/i);
    expect(result.block).not.toContain("Tattoos ................................................................ 16");

    // f44631a rewrote the model's page numbers onto the printed page and
    // deleted Crunch, Buff City Soap, and Salon Director sentences. Those
    // words stay. A marker is kept only when that page is in the loaded
    // manual and answers the question. p.18, p.20, and pp.3-5 are not pages
    // in this manual, so they get no marker. The model wrote p.16 and p.17,
    // and both pages answer a dress-code question, so those markers stay.
    // The processor does not invent p.15 from a sentence that said p.16.
    const model = [
      "No sandals, crocs. Shoes, JBA Policy Manual p.16 [p.16].",
      `${TATTOOS} Tattoos, JBA Policy Manual p.17 [p.17].`,
      `${JEWELRY} Jewelry/Accessories, JBA Policy Manual p.17 [S11].`,
      "Name tags are worn on the shirt. Name tags, JBA Policy Manual p.20.",
      "Sun Tan City shirts are the salon uniform. Shirts, JBA Policy Manual p.16.",
      "Pants are black. Pants, JBA Policy Manual p.18.",
      "Tanning is offered to staff. Tanning, JBA Policy Manual p.18.",
      "Crunch Shirts, JBA Policy Manual p.17.",
      "Crunch Pants, JBA Policy Manual p.17.",
      "See Buff City Soap p.16 and the Crunch policy manual p.16.",
      "Crunch Fitness Specific Dress Code, JBA Policy Manual p.16.",
      "Salon Director manual pp.3-5.",
    ].join(" ");
    const checked = applyFullManualAnswer({
      content: model,
      manuals: result.manuals,
      sourceCount: 0,
      question: "What is the dress code for tattoos and jewelry?",
    });
    expect(wordsRemainInOrder(model, checked.content)).toBe(true);
    expect(checked.content).toContain("No sandals, crocs.");
    expect(checked.content).toContain("Name tags are worn on the shirt.");
    expect(checked.content).toContain("Sun Tan City shirts are the salon uniform.");
    expect(checked.content).toContain("Pants are black.");
    expect(checked.content).toContain("Tanning is offered to staff.");
    expect(checked.content).toContain(TATTOOS);
    expect(checked.content).toContain(JEWELRY);
    expect(checked.content).toContain("Shoes, JBA Policy Manual p.16 [p.16].");
    expect(checked.content).toContain("Crunch Shirts, JBA Policy Manual p.17. [p.17]");
    expect(checked.content).toContain("Crunch Pants, JBA Policy Manual p.17. [p.17]");
    expect(checked.content).toContain("See Buff City Soap p.16 and the Crunch policy manual p.16. [p.16]");
    expect(checked.content).toContain("Crunch Fitness Specific Dress Code, JBA Policy Manual p.16. [p.16]");
    expect(checked.content).toContain("Salon Director manual pp.3-5.");
    expect(checked.content).toContain("JBA Policy Manual p.18.");
    expect(checked.content).toContain("JBA Policy Manual p.20.");
    expect(checked.content).not.toContain("[S");
    expect(checked.content).not.toMatch(/\[p\.(?:3|4|5|15|18|20)\]/);
    expect(checked.citations.every((citation) => citation.locator === "Page 16" || citation.locator === "Page 17")).toBe(
      true,
    );
    expect(checked.citations.some((citation) => citation.locator === "Page 16")).toBe(true);
    expect(checked.citations.some((citation) => citation.locator === "Page 17")).toBe(true);
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
  it("keeps the full sentence and the full source label on the three live citation strings", async () => {
    const live = [
      {
        sentence: "Tattoos — large",
        label: "Tattoos, JBA Policy Manual p.16",
        raw: "Tattoos — large,Tattoos, JBA Policy Manual p.16)",
        page: 16,
      },
      {
        sentence: "No sandals, crocs",
        label: "Shoes, JBA Policy Manual p.15",
        raw: "No sandals, crocs,Shoes, JBA Policy Manual p.15)",
        page: 15,
      },
      {
        sentence: "full-time Assistant Salon Dir",
        label: "Eligibility, JBA Policy Manual p.41",
        raw: "full-time Assistant Salon DirEligibility, JBA Policy Manual p.41)",
        page: 41,
      },
    ] as const;
    const result = choosePolicyManuals("What do the tattoos, shoes, and eligibility rules say?", [
      manual("JBA Policy Manual Edited 5.2025", [
        chunk(1, 16, "Shoes", "15 | P a g e\nNo sandals, crocs.", 16),
        chunk(2, 17, "Tattoos", "16 | P a g e\nTattoos — large designs stay covered.", 17),
        chunk(3, 42, "Eligibility", "41 | P a g e\nA full-time Assistant Salon Director may use paid time off.", 42),
      ]),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manuals[0]?.pages.map((page) => page.page)).toEqual([15, 16, 41]);

    // The marker is appended after the sentence. f44631a inserted it in front
    // of the closing paren by rewriting the citation, which cut the sentence
    // at the comma before the heading.
    const model = live.map((item) => item.raw).join("\n");
    const checked = applyFullManualAnswer({
      content: model,
      manuals: result.manuals,
      sourceCount: 0,
      question: "What do the tattoos, shoes, and eligibility rules say?",
    });
    expect(wordsRemainInOrder(model, checked.content)).toBe(true);
    for (const item of live) {
      const intact = `${item.raw} [p.${item.page}]`;
      expect(item.raw.endsWith(`p.${item.page})`)).toBe(true);
      expect(checked.content).toContain(intact);
      expect(checked.content).toContain(item.sentence);
      expect(checked.content).toContain(item.label);
      expect(intact.startsWith(item.sentence)).toBe(true);
      expect(intact).toContain(item.label);

      const streamed = await collectModelResult(
        {
          async *[Symbol.asyncIterator]() {
            yield {
              type: "content_block_delta",
              delta: { type: "text_delta", text: item.raw.slice(0, item.sentence.length) },
            };
            yield {
              type: "content_block_delta",
              delta: { type: "text_delta", text: item.raw.slice(item.sentence.length) },
            };
            yield { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } };
          },
        },
        Date.now(),
      );
      expect(streamed.text).toBe(item.raw);
      const fromStream = applyFullManualAnswer({
        content: streamed.text,
        manuals: result.manuals,
        sourceCount: 0,
        question: "What do the tattoos, shoes, and eligibility rules say?",
      });
      expect(wordsRemainInOrder(item.raw, fromStream.content)).toBe(true);
      expect(fromStream.content).toContain(intact);
      expect(fromStream.content).toContain(item.sentence);
      expect(fromStream.content).toContain(item.label);
      expect(pagesIn(fromStream)).toEqual([item.page]);
    }
    expect(pagesIn(checked)).toEqual([15, 16, 41]);
    expect(checked.citations).toEqual([
      expect.objectContaining({ excerpt: "Tattoos", locator: "Page 16" }),
      expect.objectContaining({ excerpt: "Shoes", locator: "Page 15" }),
      expect.objectContaining({ excerpt: "Eligibility", locator: "Page 41" }),
    ]);

    const written = [
      {
        sentence: "Tattoos — large designs stay covered.",
        label: "Tattoos, JBA Policy Manual p.16",
        raw: "Tattoos — large designs stay covered. (Tattoos, JBA Policy Manual p.16)",
        page: 16,
      },
      {
        sentence: "No sandals, crocs.",
        label: "Shoes, JBA Policy Manual p.15",
        raw: "No sandals, crocs. (Shoes, JBA Policy Manual p.15)",
        page: 15,
      },
      {
        sentence: "full-time Assistant Salon Director.",
        label: "Eligibility, JBA Policy Manual p.41",
        raw: "full-time Assistant Salon Director. (Eligibility, JBA Policy Manual p.41)",
        page: 41,
      },
    ] as const;
    for (const item of written) {
      const streamed = await collectModelResult(
        {
          async *[Symbol.asyncIterator]() {
            const splitAt = item.raw.indexOf(`(${item.label.split(",")[0]}`);
            yield { type: "content_block_delta", delta: { type: "text_delta", text: item.raw.slice(0, splitAt) } };
            yield { type: "content_block_delta", delta: { type: "text_delta", text: item.raw.slice(splitAt) } };
            yield { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } };
          },
        },
        Date.now(),
      );
      expect(streamed.text).toBe(item.raw);
      const fromStream = applyFullManualAnswer({
        content: streamed.text,
        manuals: result.manuals,
        sourceCount: 0,
        question: "What do the tattoos, shoes, and eligibility rules say?",
      });
      const intact = `${item.raw} [p.${item.page}]`;
      expect(wordsRemainInOrder(item.raw, fromStream.content)).toBe(true);
      expect(fromStream.content).toContain(intact);
      expect(fromStream.content).toContain(item.sentence);
      expect(fromStream.content).toContain(item.label);
      expect(pagesIn(fromStream)).toEqual([item.page]);
    }
  });


  it("keeps a real page and leaves an unknown heading and an unknown page in the sentence", () => {
    const result = choosePolicyManuals("What is the attendance policy?", [JBA]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // f44631a deleted "Unicorn" and rewrote "Dress Code ... p.99" onto the
    // Dress Code for The Company page. Neither sentence is rewritten. Page 19
    // is in the manual, so that sentence gains [p.19]. Page 99 is not, so it
    // gains no marker.
    const model = [
      "Be on time. See Attendance, JBA Policy Manual p.19.",
      "Dress Code, JBA Policy Manual p.99.",
      "Also Unicorn Policy, JBA Policy Manual p.19.",
    ].join("\n");
    const checked = applyFullManualAnswer({
      content: model,
      manuals: result.manuals,
      sourceCount: 0,
      question: "What is the attendance policy?",
    });
    expect(wordsRemainInOrder(model, checked.content)).toBe(true);
    expect(checked.content).toContain("See Attendance, JBA Policy Manual p.19. [p.19]");
    expect(checked.content).toContain("Dress Code, JBA Policy Manual p.99.");
    expect(checked.content).toContain("Also Unicorn Policy, JBA Policy Manual p.19. [p.19]");
    expect(checked.content).not.toContain("[p.99]");
    expect(checked.content).not.toContain("[p.20]");
    expect(checked.citations).toEqual([
      expect.objectContaining({ excerpt: "Attendance", locator: "Page 19", documentTitle: "JBA Policy Manual" }),
    ]);
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

describe("conv_mvmnwgmq2y3usjb and conv_mvmnvara2iixygm", () => {
  // Located by conversation_id in chat_traces. That table has no completion
  // column (its prompt is the system prompt). The files are chat_messages.content
  // for message_id msg_mvmnwgmq1i3955b (dress, conv_mvmnwgmq2y3usjb) and
  // msg_mvmnvara1eirwcx (PTO, conv_mvmnvara2iixygm): the text production stored
  // after f44631a. Pages 1, 22, and 47 are in this manual on purpose. Keeping
  // a marker or a Sources row for them fails the test. f44631a kept them.
  function liveManual(): FullManualDocument {
    return manual("JBA Policy Manual Edited 5.2025", [
      chunk(0, 1, "Manual", "1 | P a g e\nCover.", 1),
      chunk(10, 16, "Dress Code for The Company", "15 | P a g e\nDress Code for The Company\nA neat appearance.", 16),
      chunk(11, 16, "All Locations Dress Code", "All Locations Dress Code\nName tags are worn.", 16),
      chunk(12, 16, "Shoes", "Shoes\nClosed-toe shoes.", 16),
      chunk(13, 16, "Belts", "Belts\nDark belts.", 16),
      chunk(14, 16, "Hair", "Hair\nClean hair.", 16),
      chunk(15, 16, "Facial Hair", "Facial Hair\nClean facial hair.", 16),
      chunk(16, 16, "Make-up", "Make-up\nNatural make-up.", 16),
      chunk(20, 17, "Jewelry/Accessories", "16 | P a g e\nJewelry/Accessories\nNo dangling chains.", 17),
      chunk(21, 17, "Tattoos", "Tattoos\nLarge tattoos stay covered.", 17),
      chunk(30, 18, "Sun Tan City", "17 | P a g e\nSun Tan City\nA branded top.", 18),
      chunk(31, 18, "Shirts", "Shirts\nAny colored collared shirt.", 18),
      chunk(32, 18, "Pants", "Pants\nKhaki or black pants.", 18),
      chunk(33, 18, "Tanning", "Tanning\nA consistent schedule.", 18),
      chunk(40, 23, "Termination", "22 | P a g e\nTermination\nPayout of accrued PTO.", 23),
      chunk(50, 42, "Employee Benefits", "41 | P a g e\nEmployee Benefits\nBenefits overview.", 42),
      chunk(51, 42, "Paid time Off (PTO)", "Paid time Off (PTO)\nPaid time away from work.", 42),
      chunk(52, 42, "Eligibility", "Eligibility\nAfter 90 days.", 42),
      chunk(60, 43, "Provisions", "42 | P a g e\nProvisions\nUnused time carries over.", 43),
      chunk(61, 43, "Usage", "Usage\nHalf-day increments.", 43),
      chunk(70, 48, "Bereavement Leave", "47 | P a g e\nBereavement Leave\nBereavement days.", 48),
    ]);
  }

  function locatorPages(citations: readonly { readonly locator: string }[]): number[] {
    return [...new Set(citations.map((citation) => Number(citation.locator.replace(/\D/g, ""))))].sort((a, b) => a - b);
  }

  it("keeps every model word and drops pages that do not answer the question", () => {
    const dressModel = readFileSync("src/lib/ai/__fixtures__/live-answers/conv_mvmnwgmq2y3usjb.txt", "utf8");
    const ptoModel = readFileSync("src/lib/ai/__fixtures__/live-answers/conv_mvmnvara2iixygm.txt", "utf8");
    const dressResult = choosePolicyManuals("What is the dress code?", [liveManual()]);
    const ptoResult = choosePolicyManuals("What is the PTO policy?", [liveManual()]);
    expect(dressResult.ok).toBe(true);
    expect(ptoResult.ok).toBe(true);
    if (!dressResult.ok || !ptoResult.ok) return;
    expect(dressResult.manuals[0]?.pages.map((page) => page.page)).toEqual(
      expect.arrayContaining([1, 15, 16, 17, 22, 41, 42, 47]),
    );

    const dress = applyFullManualAnswer({
      content: dressModel,
      manuals: dressResult.manuals,
      sourceCount: 0,
      question: "What is the dress code?",
    });
    expect(wordsRemainInOrder(dressModel, dress.content)).toBe(true);
    const chains = dress.content.indexOf("chains,");
    const gray = dress.content.indexOf("any gray,");
    const yoga = dress.content.indexOf("no yoga pants,");
    expect(chains).toBeGreaterThan(-1);
    expect(gray).toBeGreaterThan(chains);
    expect(yoga).toBeGreaterThan(gray);
    expect(dress.content).toContain("[p.15]");
    expect(dress.content).toContain("[p.16]");
    expect(dress.content).toContain("[p.17]");
    expect(dress.content).not.toContain("[p.1]");
    expect(locatorPages(dress.citations)).toEqual([15, 16, 17]);
    expect(dress.citations.map((citation) => citation.excerpt)).not.toContain("Manual");

    const pto = applyFullManualAnswer({
      content: ptoModel,
      manuals: ptoResult.manuals,
      sourceCount: 0,
      question: "What is the PTO policy?",
    });
    expect(wordsRemainInOrder(ptoModel, pto.content)).toBe(true);
    expect(pto.content).toContain("[p.41]");
    expect(pto.content).toContain("[p.42]");
    expect(pto.content).not.toContain("[p.1]");
    expect(pto.content).not.toContain("[p.22]");
    expect(pto.content).not.toContain("[p.47]");
    expect(pto.content).toContain("accrual cap 120 hours");
    expect(pto.content).not.toContain("120 hours [p.");
    expect(pto.content).toContain('("Bereavement Leave" Bereavement Leave, JBA Policy Manual p.47');
    expect(pto.content).toContain("Payout of accrued PTO at termination follows all state and federal guidelines.");
    expect(locatorPages(pto.citations)).toEqual([41, 42]);
    const ptoExcerpts = pto.citations.map((citation) => citation.excerpt);
    expect(ptoExcerpts).not.toContain("Manual");
    expect(ptoExcerpts).not.toContain("Termination");
    expect(ptoExcerpts).not.toContain("Bereavement Leave");
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
