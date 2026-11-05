import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PERFORMANCE_MANAGEMENT_DRAFT_RULES } from "@/lib/forms/escalation-guard";

import {
  CA_CHOSEN_LINE,
  SALES_EXCEPTION_LINE,
  SALES_RESULTS_OFFENSE_LINE,
  salesExceptionSuffix,
  salesResultsOffenseLine,
  withCaChosenRule,
  withSalesException,
} from "./ca-sales-prompt-lines";
import { buildSystemPrompt, EMPLOYEE_PERFORMANCE_RULES } from "./prompts";

/*
 * QA's prompt audit, 5 Nov 2026, and Pau's "go": three lines ADDED behind
 * CA_SALES_POLICY_ENABLED where an older line contradicts the sales rule.
 * Off, every prompt is byte-identical; on, each line follows the one it
 * qualifies and nothing else moves.
 */
const NUMBERS_ALONE = /^- A metric is a coaching signal[^\n]*numbers alone[^\n]*$/m;
const PROMPT = {
  assistantName: "Sunny",
  brandName: "Sun Tan City",
  salonNoun: "salon",
  context: { userName: "Pat Manager", locationName: "All salons", todayIso: "2026-11-05" },
  mode: "standard" as const,
  hasContext: true,
  hasFrameworkGrounding: true,
  hasDailyStatsFramework: true,
};

beforeEach(() => {
  vi.stubEnv("CA_SALES_POLICY_ENABLED", "");
  vi.stubEnv("PROMPT_CACHE_ENABLED", "");
  vi.stubEnv("CHAT_STYLE_RULES_ENABLED", "");
});
afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");

/** The exception line sits on the line right after every "numbers alone" rule in the text. */
function exceptionFollowsEveryRule(text: string): boolean {
  const lines = text.split("\n");
  const rules = lines.flatMap((line, index) => (NUMBERS_ALONE.test(line) ? [index] : []));
  return rules.length > 0 && rules.every((index) => lines[index + 1] === SALES_EXCEPTION_LINE);
}

describe("CA_SALES_POLICY_ENABLED: the three added prompt lines", () => {
  it("off: nothing is added anywhere (the prompt, the rules and the draft lines are as before)", () => {
    expect(withSalesException(EMPLOYEE_PERFORMANCE_RULES)).toBe(EMPLOYEE_PERFORMANCE_RULES);
    expect(salesExceptionSuffix()).toBe("");
    expect(salesResultsOffenseLine(["attendance_policy", "standards_of_conduct", "dress_code", "other"])).toBe("");
    expect(withCaChosenRule(PERFORMANCE_MANAGEMENT_DRAFT_RULES)).toBe(PERFORMANCE_MANAGEMENT_DRAFT_RULES);
    for (const cache of ["", "1"]) {
      vi.stubEnv("PROMPT_CACHE_ENABLED", cache);
      expect(buildSystemPrompt(PROMPT)).not.toContain(SALES_EXCEPTION_LINE);
    }
  });

  it("on, 1: the exception follows the \"numbers alone\" rule, in both prompt layouts and in the employee performance rules", () => {
    on();
    for (const cache of ["", "1"]) {
      vi.stubEnv("PROMPT_CACHE_ENABLED", cache);
      const prompt = buildSystemPrompt(PROMPT);
      expect(exceptionFollowsEveryRule(prompt), `PROMPT_CACHE_ENABLED=${cache || "off"}`).toBe(true);
      // Added only: removing the line gives the prompt back as it was with the flag off.
      const added = prompt.split(`\n${SALES_EXCEPTION_LINE}`).join("");
      vi.stubEnv("CA_SALES_POLICY_ENABLED", "");
      expect(added).toBe(buildSystemPrompt(PROMPT));
      on();
    }
    expect(exceptionFollowsEveryRule(withSalesException(EMPLOYEE_PERFORMANCE_RULES))).toBe(true);
  });

  it("on, 2: a form with no under_performance box reads sales results as standards_of_conduct; a form with one gets nothing", () => {
    on();
    expect(salesResultsOffenseLine(["attendance_policy", "standards_of_conduct", "dress_code", "other"])).toBe(SALES_RESULTS_OFFENSE_LINE);
    expect(salesResultsOffenseLine(["tardiness", "under_performance", "standards_of_conduct"])).toBe("");
  });

  it("on, 3: the Corrective Action line follows the lowest-rung rule, and every other rule is in place", () => {
    on();
    for (const rules of [PERFORMANCE_MANAGEMENT_DRAFT_RULES]) {
      const added = withCaChosenRule(rules);
      const at = added.indexOf(CA_CHOSEN_LINE);
      expect(added[at - 1]).toMatch(/LOWEST rung/);
      expect(added.filter((rule) => rule !== CA_CHOSEN_LINE)).toEqual([...rules]);
    }
  });
});
