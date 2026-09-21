import { blockAppliesToVariant, type FormDocument } from "./document";

/**
 * ============================================================================
 * THE SENTENCE A MANAGER READS AFTER THE PLAN IS DRAFTED
 * ============================================================================
 *
 * The previous generation of this product ended a performance-plan
 * conversation with a short summary — what the plan focuses on, what it builds
 * on, and what to do next — and managers ask for it because a form card alone
 * does not tell them whether Ask Sunny understood them.
 *
 * ============================================================================
 * IT IS A RESTATEMENT OF THE FORM, AND STRUCTURALLY CANNOT BE ANYTHING ELSE
 * ============================================================================
 *
 * THERE IS NO MODEL HERE. No prompt, no second drafting pass, no reading of
 * the manager's original words. Every phrase this returns is copied out of a
 * value that is already stored against the form instance, or out of an option
 * label the template itself declares. A summary that was generated separately
 * would be a second account of the same employee, written from the same notes
 * by the same model — and the two would eventually disagree, on a record where
 * the disagreement is the manager's problem to explain.
 *
 * SO IT IS DERIVED AT RENDER TIME, from the instance the screen just fetched.
 * Edit the plan and the sentence follows, because it is not a copy of the plan:
 * it is a reading of it.
 *
 * ============================================================================
 * WHAT IT DOES WHEN A FIELD IS BLANK
 * ============================================================================
 *
 * It says less. A missing strength drops the clause about strengths; a form
 * with nothing drafted at all produces no summary sentence, only the
 * instruction. Nothing is filled in, inferred or softened — the whole value of
 * the sentence is that a manager can check it against the page below it.
 */

export interface PlanSummaryInput {
  /** The published name, as the form itself carries it. */
  readonly templateName: string;
  /** The employee on the RECORD, not a name parsed out of any prose. */
  readonly employeeName: string;
  readonly document: FormDocument;
  readonly variantKey: string | null;
  /** The stored values, exactly as the instance holds them. */
  readonly values: Record<string, string>;
  readonly checked: Record<string, string[]>;
}

/**
 * ============================================================================
 * WHICH DOCUMENTS GET A SUMMARY, READ OFF THE STORED VERSION
 * ============================================================================
 *
 * The signal is that this document has a section the EMPLOYEE completes in the
 * review conversation — an expectation checklist that is theirs to mark. That
 * is exactly the class of document whose draft is the start of a conversation
 * rather than the record of one, which is what the closing instruction is
 * about.
 *
 * NOT A TEMPLATE KEY. A plan published tomorrow with the same structure gets
 * the same treatment, and a coaching form — which documents a conversation
 * that already happened — never does.
 */
export function isReviewedWithEmployee(
  document: FormDocument,
  variantKey: string | null,
): boolean {
  return document.blocks.some(
    (block) =>
      block.kind === "expectation_checklist" &&
      block.responsibility === "employee" &&
      blockAppliesToVariant(block, variantKey),
  );
}

/**
 * The keys this summary reads, and why they are named here.
 *
 * `policy-fields.ts` names `offense_type` and `policy_violated` for the same
 * reason and with the same caveat: a field's MEANING is not inferable from its
 * label, and guessing which long_text on a form is "the strength" would be a
 * rule that silently picks the wrong one on the next template. These are the
 * SDIT EPP's keys, and a document that does not have them simply contributes
 * nothing to the sentence.
 *
 * THE SHORT LISTS ARE PREFERRED OVER THE PROSE, deliberately. "Punctuality"
 * reads as a clause; "Paulyne needs to improve punctuality and consistently
 * arrive ready to work at her scheduled shift start time" is a sentence, and a
 * sentence inside a sentence is how a summary becomes unreadable. Both are the
 * form's own words either way.
 */
const STRENGTH_KEYS = ["top_strengths", "where_succeeding"] as const;
const IMPROVEMENT_KEYS = ["improvement_areas", "needs_improvement"] as const;
const OBJECTIVE_KEYS = ["plan_of_action"] as const;

/** The first line of a numbered list, or the first sentence of a paragraph. */
function opening(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  if (text === "") return null;

  const firstLine = text.split("\n").map((line) => line.trim()).find((line) => line !== "");
  if (!firstLine) return null;

  // A paragraph contributes its first sentence; a list line has none to split.
  const firstSentence = firstLine.split(/(?<=[.!?])\s+/)[0] ?? firstLine;
  return firstSentence.replace(/[.;,]+$/, "").trim() || null;
}

function firstOf(
  values: Record<string, string>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const found = opening(values[key]);
    if (found) return found;
  }
  return null;
}

/**
 * The labels of the expectations marked in one column.
 *
 * The LAST resort for a strength or an improvement, and still the form's own
 * words: an option label is template data, printed on the page beside the mark
 * the manager made.
 */
function markedExpectations(
  input: PlanSummaryInput,
  column: "success" | "improvement",
): string | null {
  for (const block of input.document.blocks) {
    if (block.kind !== "expectation_checklist") continue;
    if (!blockAppliesToVariant(block, input.variantKey)) continue;
    // The manager's marks, never the employee's own section.
    if (block.responsibility === "employee") continue;

    const key = column === "success" ? block.successKey : block.improvementKey;
    const marked = input.checked[key] ?? [];
    const labels = marked
      .map((option) => block.options.find((entry) => entry.key === option)?.label)
      .filter((label): label is string => Boolean(label))
      .map((label) => label.replace(/[.;,]+$/, "").trim());
    if (labels.length > 0) return labels[0]!;
  }
  return null;
}

/**
 * A phrase read back as part of a sentence.
 *
 * "Punctuality" is a list entry and starts a line; inside "focuses on
 * punctuality" it should not be capitalised. AN ACRONYM AND A NAME ARE LEFT
 * ALONE — "PPTA" and "Paulyne" are capitalised because of what they are, not
 * because of where they sat.
 */
function asClause(phrase: string, employeeName: string): string {
  const [first] = phrase.split(/\s+/);
  if (!first) return phrase;
  if (first.length > 1 && first === first.toUpperCase()) return phrase;
  if (employeeName.split(/\s+/).some((part) => part === first)) return phrase;
  return first.charAt(0).toLowerCase() + phrase.slice(1);
}

/**
 * The closing instruction, which is true of every plan and says nothing about
 * this one's contents.
 */
function reviewInstruction(input: PlanSummaryInput): string {
  return `Review the ${input.templateName} with ${input.employeeName} and download the PDF when you're ready. Leave the signature fields blank until you've had the review conversation.`;
}

/**
 * The summary, or just the instruction, or nothing.
 *
 * Returns `null` for a document that is not reviewed with the employee — there
 * is no conversation to hold the signatures for, and a coaching record needs
 * no summary of itself.
 */
export function planSummary(input: PlanSummaryInput): string | null {
  if (!isReviewedWithEmployee(input.document, input.variantKey)) return null;

  const strength =
    firstOf(input.values, STRENGTH_KEYS) ?? markedExpectations(input, "success");
  const improvement =
    firstOf(input.values, IMPROVEMENT_KEYS) ?? markedExpectations(input, "improvement");
  const objectives = firstOf(input.values, OBJECTIVE_KEYS);

  const sentences: string[] = [];

  const lead = `The ${input.templateName} draft for ${input.employeeName}`;
  if (improvement && strength) {
    sentences.push(
      `${lead} focuses on ${asClause(improvement, input.employeeName)} while continuing to build on ${asClause(strength, input.employeeName)}.`,
    );
  } else if (improvement) {
    sentences.push(`${lead} focuses on ${asClause(improvement, input.employeeName)}.`);
  } else if (strength) {
    sentences.push(`${lead} builds on ${asClause(strength, input.employeeName)}.`);
  }

  if (objectives) {
    sentences.push(`The plan of action: ${objectives}.`);
  }

  sentences.push(reviewInstruction(input));
  return sentences.join(" ");
}
