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

describe("facts, signals, interpretations and causes are four different things", () => {
  it("defines a fact as a value the context states", () => {
    expect(PROMPT).toMatch(/A FACT is a value the context states/);
  });

  /**
   * THE TIER LIVE QA MADE NECESSARY. "This is where the row-to-row differences
   * are widest" was the model doing statistics by eye. The comparisons are now
   * computed server-side, so the prompt's job is to point at them rather than
   * to forbid guessing — a model handed a table and asked which rows matter
   * will always eyeball it if nothing better is available.
   */
  it("defines a signal as a comparison the server already computed", () => {
    expect(PROMPT).toMatch(/A SIGNAL is a comparison the server already computed/);
    expect(PROMPT).toMatch(/rank out of the reporting salons, a quartile, the median/);
    expect(PROMPT).toMatch(/SELECTED-METRIC SIGNALS/);
  });

  it("forbids forming a comparison by reading down the table", () => {
    expect(PROMPT).toMatch(/Do NOT compute a comparison of your own by reading down the salon table/);
    expect(PROMPT).toMatch(/it was not computed, and you say so rather than estimating it/);
  });

  it("requires interpretations to be marked and to name their signal", () => {
    expect(PROMPT).toMatch(/An INTERPRETATION is an operational reading built on those facts and signals/);
    expect(PROMPT).toMatch(/Interpretation:/);
    expect(PROMPT).toMatch(/name the signal it rests on/);
  });

  it("refuses causes outright and says why the report cannot support one", () => {
    expect(PROMPT).toMatch(/A CAUSE is none of these, and you do not state one/);
    expect(PROMPT).toMatch(/no staffing/i);
    expect(PROMPT).toMatch(/no promotions/i);
    expect(PROMPT).toMatch(/cannot know why any number moved/i);
  });

  it("tells the model what to do instead when asked why", () => {
    expect(PROMPT).toMatch(/name what would be needed to find out/i);
  });
});

describe("the selected measure leads a broad answer", () => {
  it("names the selected metric as the subject of a broad question", () => {
    expect(PROMPT).toMatch(/THE SELECTED MEASURE IS THE ANSWER TO A BROAD QUESTION/);
    expect(PROMPT).toMatch(/the selected measure IS the subject\. Lead with it and stay on it/);
  });

  it("lists the broad questions this applies to", () => {
    for (const question of [
      "what should I look at first",
      "what stands out",
      "how are we doing",
    ]) {
      expect(PROMPT.toLowerCase()).toContain(question.toLowerCase());
    }
  });

  it("refuses interestingness as a reason to switch measures", () => {
    // The live failure: a Grand Total view answered with a paragraph on PPTA.
    expect(PROMPT).toMatch(/Being more interesting, more variable or more unusual is not a reason/);
    expect(PROMPT).toMatch(/if Grand Total is selected, Grand Total is the analysis/);
  });

  it("names the other measures as follow-up territory, not the lead", () => {
    expect(PROMPT).toMatch(/PPTA, EFTs, Tans, New Customers and Sunless Sessions are there for follow-up questions/);
  });

  it("allows offering a metric switch so the manager keeps the choice", () => {
    expect(PROMPT).toMatch(/if your priority is membership growth, switch to EFTs/i);
    expect(PROMPT).toMatch(/hands the choice back to the manager instead of making it for them/);
  });
});

describe("priority and performance cannot be invented", () => {
  it("says outright that no baseline exists in this context", () => {
    expect(PROMPT).toMatch(/YOU CANNOT KNOW WHAT TO PRIORITISE, AND YOU SAY SO/);
    expect(PROMPT).toMatch(/no target, no budget, no forecast, no prior period and no other date/);
  });

  it("separates a snapshot outlier from underperformance", () => {
    expect(PROMPT).toMatch(/A SNAPSHOT OUTLIER is a salon at an end of this selection's ranking/);
    expect(PROMPT).toMatch(/UNDERPERFORMANCE is a shortfall against something expected/);
    expect(PROMPT).toMatch(/nothing expected in this context to fall short of/);
  });

  it("requires a basis for every evaluative label, and says there is none", () => {
    for (const label of [
      "Underperforming",
      "weak",
      "poor",
      "needs attention",
      "strong performance",
      "doing well",
    ]) {
      expect(PROMPT).toContain(label);
    }
    expect(PROMPT).toMatch(/require an explicit basis, and this report does not supply one\. Do not use them bare/);
    expect(PROMPT).toMatch(/say that position is not a verdict/);
  });

  it("requires the limitation to open a priority or performance answer", () => {
    expect(PROMPT).toMatch(/When asked what to look at first, or how the business is doing, OPEN by stating the limitation/);
    expect(PROMPT).toMatch(/can show where results differ, but not what is genuinely underperforming without a target or a historical baseline/);
  });
});

describe("high and low need their basis in the same sentence", () => {
  it("forbids a bare magnitude claim", () => {
    expect(PROMPT).toMatch(/Never write that a figure is high, low, unusually high, unusually low, big or small without the comparison that makes it so, in the same sentence/);
  });

  it("shows the qualified phrasings that are acceptable", () => {
    expect(PROMPT).toMatch(/ranks 15th of 15 on Grand Total in this delivery/);
    expect(PROMPT).toMatch(/bottom quartile of the 15 reporting salons/);
    expect(PROMPT).toMatch(/64% above the median Grand Total for these 15 salons/);
  });

  it("shows the unqualified phrasings that are not", () => {
    expect(PROMPT).toMatch(/Bad: \\?"Grand Island has low sales/);
    expect(PROMPT).toMatch(/the grounds are sitting in the signals section/);
  });
});

describe("measures are never ranked against each other by spread", () => {
  /**
   * The live answer said "this is where the row-to-row differences are widest"
   * about PPTA. That compared a dollar range against a dollars-per-transaction
   * range against a session-count range — three different units, so the
   * subtraction has no meaning whatever it produces.
   */
  it("forbids the comparison and says why it is void", () => {
    expect(PROMPT).toMatch(/NEVER RANK THE MEASURES AGAINST EACH OTHER BY SPREAD/);
    expect(PROMPT).toMatch(/Do not say that one measure varies more, has a wider spread, or shows bigger differences than another/);
    expect(PROMPT).toMatch(/subtracting quantities in different units, and the result means nothing however confident it sounds/);
  });

  it("says the server computes no such comparison to quote", () => {
    expect(PROMPT).toMatch(/The server deliberately does not compute such a comparison, so there is none in the context/);
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

  it("allows a salon's own PPTA and its rank, but not a combined one", () => {
    expect(PROMPT).toMatch(/a salon's own PPTA and its position among the others are both usable/);
    expect(PROMPT).toMatch(/the median of those values is NOT this delivery's PPTA and neither is their sum/);
    expect(PROMPT).toMatch(/Never present a PPTA average or median as the business's PPTA/);
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
