import { afterEach, describe, expect, it, vi } from "vitest";

import { FACSIMILE_RULE_LEAD, TYPED_PRIOR_RULE, withFormPromptRules } from "./form-prompt-rules";
import { buildSystemPrompt } from "./prompts";

/**
 * FACSIMILE_ASK_ONLY_ENABLED and TYPED_PRIOR_NOT_ON_FILE_ENABLED change the
 * answering prompt's form line and add one line after it — nothing else. The
 * source markers, the citation rules and the page rules are the same string
 * with either flag on, so the answer's citations are not touched.
 *
 * The sibling app's production refusal (conv_mvnu3j932gpohx4, 25 Oct 2026): "I can't write
 * this up as a corrective action document here — that's a formal HR record,
 * and I can't produce a facsimile of one or its contents."
 * The sibling app's production invention (conv_mvnsqglc2v7zuyk, 25 Oct 2026): "**Prior
 * coaching:** Coaching Form on file, dated 2025-11-01, for Test Employee."
 */

const CONTEXT = { userName: "Pat Manager", locationName: "Riverbend Commons", todayIso: "2026-10-25" };

function prompt(extra: Partial<Parameters<typeof buildSystemPrompt>[0]> = {}): string {
  return buildSystemPrompt({
    assistantName: "Sunny",
    brandName: "Sun Tan City",
    salonNoun: "salon",
    context: CONTEXT,
    mode: "standard",
    hasContext: true,
    ...extra,
  });
}

const VARIANTS: readonly [string, Partial<Parameters<typeof buildSystemPrompt>[0]>][] = [
  ["a plain answer", {}],
  [
    "every form block",
    {
      hasFormsLibrary: true,
      hasFormRecords: true,
      hasPersonMemory: true,
      crossChatGuard: true,
      styleRules: true,
      priorCoachingOptional: true,
    },
  ],
  ["the whole manual in the prompt (FULL_MANUAL_CONTEXT_ENABLED)", { citeManualPages: true, hasFormsLibrary: true }],
];

const LAYOUTS = [
  ["PROMPT_CACHE_ENABLED off", false],
  ["PROMPT_CACHE_ENABLED on", true],
] as const;

const CITATION_LINE = /marker|\[S\d|\[p\.|cite|citation|page|source/i;

function lines(text: string): string[] {
  return text.split("\n");
}

function minus(a: readonly string[], b: readonly string[]): string[] {
  const rest = new Set(b);
  return a.filter((line) => !rest.has(line));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(LAYOUTS)("%s", (_layout, cached) => {
  function build(flags: readonly string[], extra: Partial<Parameters<typeof buildSystemPrompt>[0]>): string {
    vi.unstubAllEnvs();
    vi.stubEnv("PROMPT_CACHE_ENABLED", cached ? "true" : "");
    vi.stubEnv("FACSIMILE_ASK_ONLY_ENABLED", "");
    vi.stubEnv("TYPED_PRIOR_NOT_ON_FILE_ENABLED", "");
    for (const flag of flags) vi.stubEnv(flag, "true");
    return prompt(extra);
  }

  it.each(VARIANTS)("both flags off: the form line reads as before (%s)", (_name, extra) => {
    const off = build([], extra);
    expect(lines(off).filter((line) => line.startsWith(FACSIMILE_RULE_LEAD))).toHaveLength(1);
    expect(off).not.toContain(TYPED_PRIOR_RULE);
    expect(withFormPromptRules(off, { facsimileAskOnly: false, typedPriorNotOnFile: false })).toBe(off);
  });

  it.each(VARIANTS)("FACSIMILE_ASK_ONLY_ENABLED: asks for the form, never says it cannot (%s)", (_name, extra) => {
    const off = build([], extra);
    const on = build(["FACSIMILE_ASK_ONLY_ENABLED"], extra);
    expect(on).not.toMatch(/facsimile/i);
    const changed = minus(lines(on), lines(off));
    expect(changed).toHaveLength(1);
    expect(minus(lines(off), lines(on))).toEqual([lines(off).find((line) => line.startsWith(FACSIMILE_RULE_LEAD))]);
    const rule = changed[0]!;
    expect(rule).toContain('tell them in one sentence to ask you to create it — for example "ask me to create a coaching form for her" — and stop.');
    expect(rule).toContain("Never say you cannot write, produce, draft or fill out the form");
    // What the rule forbids is still forbidden.
    expect(rule).toContain("never tell a manager to paste your text into an official form");
    expect(rule).toMatch(/Do not write out a "Coaching Record"/);
  });

  it.each(VARIANTS)("TYPED_PRIOR_NOT_ON_FILE_ENABLED: one rule after the form line (%s)", (_name, extra) => {
    const off = build([], extra);
    const on = build(["TYPED_PRIOR_NOT_ON_FILE_ENABLED"], extra);
    expect(minus(lines(off), lines(on))).toEqual([]);
    expect(minus(lines(on), lines(off))).toEqual([TYPED_PRIOR_RULE]);
    const at = lines(on).indexOf(TYPED_PRIOR_RULE);
    expect(lines(on)[at - 1]!.startsWith(FACSIMILE_RULE_LEAD)).toBe(true);
    expect(TYPED_PRIOR_RULE).toContain("IS NOT ON FILE");
    expect(TYPED_PRIOR_RULE).toContain("in the manager's own words");
  });

  it.each(VARIANTS)("both on: every citation, marker and page line is unchanged (%s)", (_name, extra) => {
    const off = build([], extra);
    const on = build(["FACSIMILE_ASK_ONLY_ENABLED", "TYPED_PRIOR_NOT_ON_FILE_ENABLED"], extra);
    const touched = (line: string) => line.startsWith(FACSIMILE_RULE_LEAD) || line.startsWith("- A COMPANY FORM COMES ONLY") || line === TYPED_PRIOR_RULE;
    expect(lines(on).filter((line) => CITATION_LINE.test(line) && !touched(line))).toEqual(
      lines(off).filter((line) => CITATION_LINE.test(line) && !touched(line)),
    );
    expect(TYPED_PRIOR_RULE).not.toMatch(/marker|\[S|\[p\.|cite|page/i);
    expect(on.length - off.length).toBeLessThan(1200);
  });
});

describe("the last-known-good revision", () => {
  it("is never rewritten by either flag", async () => {
    const { setSystemPromptRevision } = await import("./prompts");
    vi.stubEnv("FACSIMILE_ASK_ONLY_ENABLED", "true");
    vi.stubEnv("TYPED_PRIOR_NOT_ON_FILE_ENABLED", "true");
    setSystemPromptRevision("last-known-good");
    try {
      const text = prompt();
      expect(text).toContain(FACSIMILE_RULE_LEAD);
      expect(text).not.toContain(TYPED_PRIOR_RULE);
    } finally {
      setSystemPromptRevision("current");
    }
  });
});
