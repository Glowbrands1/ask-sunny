import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildReportAnalysisSystemPrompt } from "./analysis-prompt";

/**
 * ============================================================================
 * WHAT THE REPORT-ANALYSIS PROMPT MUST SAY
 * ============================================================================
 *
 * A Sales Totals report says WHAT happened and carries nothing that could say
 * WHY — no staffing, no promotions, no weather, no marketing. So the difference
 * between "Aurora is down 12%" and "Aurora is down 12% because the promotion
 * ended" is the difference between a fact and a fabrication, and a district
 * manager can spend real money on the second.
 *
 * These assertions pin the rules that stop that. They are worded loosely enough
 * to survive rephrasing and specifically enough to fail if a rule is dropped.
 */

const PROMPT = buildReportAnalysisSystemPrompt();

describe("facts, interpretations and causes are three different things", () => {
  it("defines a fact as something the context states", () => {
    expect(PROMPT).toMatch(/A FACT is something the context states/);
  });

  it("requires interpretations to be marked as interpretations", () => {
    expect(PROMPT).toMatch(/An INTERPRETATION is/);
    expect(PROMPT).toMatch(/Interpretation:/);
  });

  it("refuses causes outright and says why the report cannot support one", () => {
    expect(PROMPT).toMatch(/A CAUSE is neither, and you do not state one/);
    expect(PROMPT).toMatch(/no staffing/i);
    expect(PROMPT).toMatch(/no promotions/i);
    expect(PROMPT).toMatch(/cannot know why any number moved/i);
  });

  it("tells the model what to do instead when asked why", () => {
    expect(PROMPT).toMatch(/name what would be needed to find out/i);
  });
});

describe("the four report semantics are restated to the model", () => {
  it("says a blank cell is not a zero", () => {
    expect(PROMPT).toMatch(/"Not reported" means the source left the cell blank\. It is not zero/);
  });

  it("forbids adding across dates and combining the windows", () => {
    expect(PROMPT).toMatch(/Never add figures across report dates/);
    expect(PROMPT).toMatch(/never combine the daily and month-to-date windows/);
  });

  it("forbids describing estate averages as totals", () => {
    expect(PROMPT).toMatch(/per-salon AVERAGES/);
    expect(PROMPT).toMatch(/Never describe them as estate totals/);
  });

  it("forbids computing a figure the context declines to give", () => {
    expect(PROMPT).toMatch(/NOT AVAILABLE/);
    expect(PROMPT).toMatch(/report the limitation instead of estimating/);
  });
});

describe("no invented sources", () => {
  it("forbids citing documents, policies or page numbers", () => {
    expect(PROMPT).toMatch(/Do not cite documents, policies, page numbers or file names/);
    expect(PROMPT).toMatch(/inventing a reference would be a fabrication/i);
  });

  it("says nothing was retrieved from the knowledge base", () => {
    expect(PROMPT).toMatch(/Nothing was retrieved from the knowledge base/);
  });

  it("tells the model to say so when the context does not cover the question", () => {
    expect(PROMPT).toMatch(/Do not fill the gap with a plausible number or a plausible reason/);
  });
});

describe("nothing caller-controlled reaches the system prompt", () => {
  it("takes no arguments", () => {
    expect(buildReportAnalysisSystemPrompt.length).toBe(0);
  });

  it("interpolates only brand configuration", () => {
    const source = readFileSync("src/lib/reporting/analysis/analysis-prompt.ts", "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const interpolations = code.match(/\$\{[^}]*\}/g) ?? [];
    expect(interpolations.length).toBeGreaterThan(0);
    for (const interpolation of interpolations) {
      expect(interpolation).toMatch(/ACTIVE_BRAND\./);
    }
  });
});

describe("it is not the knowledge-base prompt", () => {
  it("does not reuse the grounded-answer system prompt", () => {
    const source = readFileSync("src/lib/reporting/analysis/analysis-prompt.ts", "utf8");
    expect(source).not.toMatch(/buildSystemPrompt/);
    expect(source).not.toMatch(/@\/lib\/ai\/prompts/);
  });
});
