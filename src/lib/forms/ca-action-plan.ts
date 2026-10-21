import { fieldsForVariant, type FormDocument } from "./document";
import { employeeFirstName } from "./employee-reference";
import { PLAN_OF_ACTION } from "./narrative-draft";
import {
  PAYROLL_DEDUCT_KEY,
  isPayrollDeductAnswer,
  payrollDeductAmount,
  payrollDeductSentence,
  quotedDeductionAmount,
  type PayrollDeductAnswer,
} from "./payroll-deduct";
import { CA_ACTION_PLAN_CLOSING, withRequiredClosing } from "./required-closing";

/**
 * ============================================================================
 * THE CORRECTIVE ACTION FORM'S ACTION PLAN, WRITTEN BY CODE
 * ============================================================================
 *
 * District Manager feedback, 21 Oct 2026, verbatim:
 *
 *   "action plan adds unnecessary language - should only have 2 sentences:
 *    management will review (policy name) with employee; and Future policy
 *    violations may result in additional corrective action up to and
 *    including termination of employment."
 *
 * So the plan is no longer drafted. It is these sentences, always, in order:
 *
 *   Management will review the <policy> policy with <first name>.
 *   [$3.25 will be deducted from <first name>'s pay. | A payroll deduction applies.]
 *   Future policy violations may result in additional corrective action up to
 *   and including termination of employment.
 *
 * The payroll sentence is there only when the form's own "Is payroll deduct
 * applicable?" says Yes (the manager's answer; `payroll-deduct.ts`). Its
 * amount is the manager's, always; with none stated, the one amount the
 * section Direct policy quotes states for a payroll deduction ("$25.00" under
 * Late Opening), and otherwise none. The last sentence is the version's
 * required closing (`required-closing.ts`).
 *
 * THE POLICY IS THE ONE DIRECT POLICY CITES, never the model's: the manual
 * sections on the line's verified provenance, by the headings the manual
 * prints ("Visitors in the Workplace", "Late Opening"), joined naturally when
 * there are several ("the Late Opening and Attendance policies"). Where the
 * line cites no section, the offense Policy Violated names; where there is
 * nothing at all, "the applicable company policy".
 *
 * A PLAN A PERSON WROTE IS THEIRS. Only a plan Ask Sunny built — written by
 * the assistant and carrying `ACTION_PLAN_SOURCE` provenance — is rebuilt
 * when the policy, the payroll answer or the offense changes later. A plan the
 * manager typed, or one rewritten on their request in chat, is left alone.
 *
 * Pure and browser-safe.
 */

/** The templates whose Action Plan is built here rather than drafted. */
const FIXED_ACTION_PLAN_TEMPLATES: ReadonlySet<string> = new Set(["dpoa"]);

export function hasFixedActionPlan(templateKey: string | null | undefined): boolean {
  return FIXED_ACTION_PLAN_TEMPLATES.has(templateKey ?? "");
}

/** The provenance `source` of a plan built here — what marks it as safe to rebuild. */
export const ACTION_PLAN_SOURCE = "corrective_action_plan";

/** When no policy can be named at all. */
export const APPLICABLE_POLICY = "the applicable company policy";

/** The manual sections a Direct policy line cites, by heading, from its verified provenance. */
export function citedPolicyNames(provenance: Record<string, unknown> | null | undefined): string[] {
  if (!provenance || provenance.verified !== true || provenance.source !== "official_policy_manual") return [];
  const listed = Array.isArray(provenance.sections) ? provenance.sections : [];
  const names: string[] = [];
  for (const entry of listed) {
    const heading = (entry as { locator?: unknown } | null)?.locator;
    if (typeof heading !== "string" || heading.trim() === "") continue;
    if (!names.some((name) => name.toLowerCase() === heading.trim().toLowerCase())) names.push(heading.trim());
  }
  return names;
}

/**
 * The policies a Policy Violated line names — the offense labels it prints,
 * one per box. "Violation of Company Policies — Visitors in the Workplace" and
 * "Tardiness/Leaving Early — Late Opening" are the section; Violation of
 * Company Policies alone names no policy; "Dress Code Violation" is the Dress
 * Code.
 */
export function policyNamesFromViolated(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/\s*,\s*/)
    .map((label) => {
      const text = label.trim();
      const section = /^.+?\s+[—–]\s+(.+)$/.exec(text) ?? /^violation of company polic(?:y|ies)\s*-\s*(.+)$/i.exec(text);
      if (section) return section[1]!.trim();
      if (/^violation of company polic(?:y|ies)$/i.test(text)) return "";
      return text.replace(/\s+violations?$/i, "").trim();
    })
    .filter((name, index, all) => name !== "" && all.findIndex((other) => other.toLowerCase() === name.toLowerCase()) === index);
}

/** "the Late Opening policy", "the Late Opening and Attendance policies", "the applicable company policy". */
export function policyPhrase(names: readonly string[]): string {
  const bare = names
    .map((name) => name.trim().replace(/^the\s+/i, "").replace(/\s+polic(?:y|ies)$/i, "").trim())
    .filter((name) => name !== "");
  if (bare.length === 0) return APPLICABLE_POLICY;
  const joined =
    bare.length === 1 ? bare[0]! : `${bare.slice(0, -1).join(", ")} and ${bare[bare.length - 1]!}`;
  return `the ${joined} ${bare.length === 1 ? "policy" : "policies"}`;
}

export interface ActionPlanInput {
  /** The sections Direct policy cites (`citedPolicyNames`). First choice. */
  readonly citedPolicies: readonly string[];
  /** The Policy Violated line, for when nothing is cited. */
  readonly policyViolated?: string | null;
  readonly employeeName: string | null | undefined;
  readonly payroll: {
    readonly answer: PayrollDeductAnswer | null;
    readonly amount: string | null;
    /** Where the amount came from: the manager's words, or the section Direct policy quotes. */
    readonly amountFrom?: "manager" | "manual";
  };
  /** The version's required closing; absent on a version without one, which gets the current wording. */
  readonly closing?: string | null;
}

/** The whole Action Plan, closing included. */
export function correctiveActionPlan(input: ActionPlanInput): string {
  const firstName = employeeFirstName(input.employeeName);
  const names = input.citedPolicies.length > 0 ? input.citedPolicies : policyNamesFromViolated(input.policyViolated);
  const sentences = [
    `Management will review ${policyPhrase(names)} with ${firstName ?? "the employee"}.`,
    payrollDeductSentence({ answer: input.payroll.answer, amount: input.payroll.amount, firstName }),
  ].filter((sentence): sentence is string => sentence !== null);
  return withRequiredClosing(sentences.join(" "), input.closing?.trim() || CA_ACTION_PLAN_CLOSING);
}

/** The provenance a built plan is stored with: what it was built from. */
export function actionPlanProvenance(input: ActionPlanInput): Record<string, unknown> {
  const cited = input.citedPolicies.length > 0;
  const named = cited ? [...input.citedPolicies] : policyNamesFromViolated(input.policyViolated);
  return {
    source: ACTION_PLAN_SOURCE,
    policySource: cited ? "direct_policy" : named.length > 0 ? "policy_violated" : "none",
    policies: named,
    payroll: input.payroll.answer === "yes" ? (input.payroll.amount ?? "applies") : null,
    /* An amount taken from the manual is the manual's: removing the section removes the figure. */
    ...(input.payroll.answer === "yes" && input.payroll.amount && input.payroll.amountFrom === "manual"
      ? { payrollAmountFrom: "manual" }
      : {}),
  };
}

/**
 * The amount the plan states, and where it came from: the manager's, always;
 * otherwise — on a Yes — the one the quoted section states
 * (`quotedDeductionAmount`); otherwise none.
 */
export function planPayrollAmount(input: {
  readonly answer: PayrollDeductAnswer | null;
  readonly stated: string | null;
  /** Direct policy's value, only where it was quoted from the manual with verified provenance. */
  readonly quotedPolicy: string | null;
}): { amount: string | null; amountFrom?: "manager" | "manual" } {
  if (input.stated) return { amount: input.stated, amountFrom: "manager" };
  const quoted = input.answer === "yes" ? quotedDeductionAmount(input.quotedPolicy) : null;
  return quoted ? { amount: quoted, amountFrom: "manual" } : { amount: null };
}

/** The key of the version's Action Plan, or null on a form without one built here. */
export function fixedActionPlanKey(
  templateKey: string | null | undefined,
  document: FormDocument,
  variantKey: string | null,
): { key: string; closing: string | null } | null {
  if (!hasFixedActionPlan(templateKey)) return null;
  const field = fieldsForVariant(document, variantKey).find((candidate) => candidate.narrative === PLAN_OF_ACTION);
  return field ? { key: field.key, closing: field.requiredClosing ?? null } : null;
}

interface StoredValue {
  readonly fieldKey: string;
  readonly value: string | null;
  readonly checked: readonly string[];
  readonly filledBy: string;
  readonly provenance?: Record<string, unknown> | null;
}

/**
 * The plan as it should read NOW, from what the form holds — for a change made
 * after the first draft (a policy added in chat, the payroll answer
 * corrected). Null when nothing should be written: not this form, no plan
 * built here on it (a person's plan, or none yet), or already right.
 *
 * The amount is the manager's: from `notes` where they said it this turn,
 * otherwise the amount the plan already states — unless the plan took it from
 * the manual, when it is read again from what Direct policy quotes now.
 */
export function refreshedActionPlan(input: {
  readonly templateKey: string;
  readonly document: FormDocument;
  readonly variantKey: string | null;
  readonly employeeName: string | null | undefined;
  readonly values: readonly StoredValue[];
  readonly notes?: string;
}): { key: string; value: string; provenance: Record<string, unknown> } | null {
  const plan = fixedActionPlanKey(input.templateKey, input.document, input.variantKey);
  if (!plan) return null;
  const row = input.values.find((entry) => entry.fieldKey === plan.key);
  const current = (row?.value ?? "").trim();
  if (!row || current === "" || row.filledBy !== "ai" || row.provenance?.source !== ACTION_PLAN_SOURCE) return null;

  const rowOf = (key: string) => input.values.find((entry) => entry.fieldKey === key);
  const policyRow = rowOf("policy_language");
  const answer = (rowOf(PAYROLL_DEDUCT_KEY)?.checked ?? []).find(isPayrollDeductAnswer) ?? null;
  const cited = (policyRow?.value ?? "").trim() === "" ? [] : citedPolicyNames(policyRow?.provenance);
  /* An amount the plan took from the manual is the manual's to change: it is read again from what is quoted now. */
  const kept = row.provenance?.payrollAmountFrom === "manual" ? null : payrollDeductAmount(current);
  const built: ActionPlanInput = {
    citedPolicies: cited,
    policyViolated: rowOf("policy_violated")?.value ?? null,
    employeeName: input.employeeName,
    payroll: {
      answer,
      ...planPayrollAmount({
        answer,
        stated: payrollDeductAmount(input.notes ?? "") ?? kept,
        quotedPolicy: cited.length > 0 ? (policyRow?.value ?? null) : null,
      }),
    },
    closing: plan.closing,
  };
  const value = correctiveActionPlan(built);
  if (value === row.value) return null;
  return { key: plan.key, value, provenance: actionPlanProvenance(built) };
}
