import { headingKey } from "@/lib/forms/official-policy-manual";

import { headingFromAccount } from "./intent-slots";

/**
 * Whether a follow-up is too short to search on its own.
 *
 * The existing retrieval query appends the previous turn only when a pointer
 * word is present. "the cell one" does not match that pattern, so the search
 * is for those three words and a real section can miss the similarity floor.
 * Haiku rewrites that case when QUERY_REWRITE_ENABLED is on. This function
 * only decides; it does not call a model.
 */

export function shouldRewriteFollowUp(
  question: string,
  history: readonly { role: string; content: string }[],
): boolean {
  const trimmed = question.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 12) return false;
  const prior = [...history]
    .reverse()
    .find((turn) => turn.role === "user" && turn.content.trim() !== "" && turn.content.trim() !== trimmed);
  if (!prior) return false;
  const longWords = words.filter((word) => word.replace(/[^A-Za-z]/g, "").length >= 5);
  if (longWords.length >= 3) return false;
  return true;
}

/**
 * The manual heading this question should be searched as.
 *
 * A person arriving late is the Attendance heading when that heading was
 * retrieved. Late Opening is used only when the account is the salon opening
 * late. A model heading is kept only when it is one of the retrieved headings
 * and the account did not already decide. Null keeps the query unchanged.
 */
export function manualTermsQuery(input: {
  readonly question: string;
  readonly headings: readonly string[];
  readonly modelHeading: string | null;
}): string | null {
  const fromAccount = headingFromAccount(input.question, input.headings);
  if (fromAccount) return fromAccount;
  const typed = input.modelHeading?.trim() ?? "";
  if (!typed) return null;
  return input.headings.find((heading) => headingKey(heading) === headingKey(typed)) ?? null;
}

/**
 * The search string. A heading the account already resolves does not ask the
 * model. Otherwise the model heading is used only when it was retrieved.
 */
export function queryWithManualTerms(input: {
  readonly question: string;
  readonly headings: readonly string[];
  readonly modelHeading: string | null;
  readonly fallback: string;
  readonly onModel?: () => void;
}): string {
  const known = manualTermsQuery({ question: input.question, headings: input.headings, modelHeading: null });
  if (known) return known;
  input.onModel?.();
  return manualTermsQuery({ question: input.question, headings: input.headings, modelHeading: input.modelHeading }) ?? input.fallback;
}

/** SKIP, empty, or a failed rewrite keeps the query the existing path would have used. */
export function queryAfterRewrite(fallback: string, rewritten: string | null | undefined): string {
  const next = rewritten?.trim() ?? "";
  if (!next || next.toUpperCase() === "SKIP") return fallback;
  return next;
}
