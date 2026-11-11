import { caSalesPolicyEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * CA_SALES_POLICY_ENABLED: THREE ADDED PROMPT LINES (Pau, 5 Nov 2026, "go")
 * ============================================================================
 *
 * QA's prompt audit found three places where an older line, read alone,
 * contradicts the flagged sales rule (a sales or Must See Behaviors
 * shortfall is a Corrective Action citing the Standards of Conduct):
 *
 *   1. "Never recommend … a corrective action on the strength of numbers
 *      alone" (the chat's metric rule);
 *   2. the draft's "under_performance is for results against a sales or
 *      performance target", on a form that has no under_performance box;
 *   3. the draft's "choose the LOWEST appropriate rung", when the manager has
 *      already chosen a Corrective Action.
 *
 * Each line is ADDED after the one it qualifies; no existing text changes.
 * Off, every function here returns its input unchanged (or nothing).
 */

/** 1. After the metric rule. */
export const SALES_EXCEPTION_LINE =
  "- Exception: when the manager states a sales or Must See Behaviors shortfall, a Corrective Action citing the Standards of Conduct is appropriate.";

/** 2. On a draft whose form has no under_performance box. */
export const SALES_RESULTS_OFFENSE_LINE = "Sales and performance results are standards_of_conduct.";

/** 3. After the lowest-rung rule. */
export const CA_CHOSEN_LINE = "When the manager has already chosen a Corrective Action, do not recommend coaching instead.";

const NUMBERS_ALONE = /^- [^\n]*on the strength of numbers alone[^\n]*$/m;

/** The rules with the exception line after the "numbers alone" rule; off, or with no such rule, unchanged. */
export function withSalesException(rules: string): string {
  if (!caSalesPolicyEnabled()) return rules;
  return rules.replace(NUMBERS_ALONE, (line) => `${line}\n${SALES_EXCEPTION_LINE}`);
}

/** The exception line as a suffix for a prompt that writes the metric rule inline: "\n- Exception: …" on, "" off. */
export function salesExceptionSuffix(): string {
  return caSalesPolicyEnabled() ? `\n${SALES_EXCEPTION_LINE}` : "";
}

/** The draft's line for a form without an under_performance box; "" off or when the box exists. */
export function salesResultsOffenseLine(offenseKeys: readonly string[]): string {
  return caSalesPolicyEnabled() && !offenseKeys.includes("under_performance") ? SALES_RESULTS_OFFENSE_LINE : "";
}

/** The draft rules with the Corrective Action line right after the lowest-rung rule; off, or with no such rule, unchanged. */
export function withCaChosenRule(rules: readonly string[]): readonly string[] {
  if (!caSalesPolicyEnabled()) return rules;
  const at = rules.findIndex((rule) => /\blowest\b[^.]*\brung\b/i.test(rule));
  if (at < 0) return rules;
  return [...rules.slice(0, at + 1), CA_CHOSEN_LINE, ...rules.slice(at + 1)];
}
