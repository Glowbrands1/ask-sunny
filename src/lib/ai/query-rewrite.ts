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

/*
 * ============================================================================
 * A FOLLOW-UP THAT NAMES ITS OWN DOCUMENTS IS SEARCHED ON THEM
 * ============================================================================
 *
 * QA Round 17, Sunny conv_mvo0ayai2x20aiy (25 Oct 2026). After "I have an
 * employee that is not verifying documents are signed", the manager named the
 * documents: "The NCR and Fitzpatrick Skin Type Chart, EFT Agreements". The
 * retrieval rewrite, reading the earlier turn, searched "Employment
 * Verification" instead; the skin typing chart (Consent Forms, p.49) was not
 * retrieved and the reply said the knowledge base had nothing on it.
 *
 * Behind FOLLOWUP_NEW_TOPIC_RETRIEVAL_ENABLED: a turn that names at least two
 * words of its own (words of four letters or more, or acronyms such as "NCR"
 * and "EFT", that no earlier manager turn used) keeps a rewritten query only
 * when the rewrite still carries one of those words. A rewrite that kept
 * none of them, only the earlier subject, gives way to the turn's own words.
 */

const TOPIC_STOP = new Set([
  "about",
  "also",
  "and",
  "are",
  "been",
  "both",
  "can",
  "could",
  "does",
  "each",
  "from",
  "have",
  "here",
  "into",
  "just",
  "like",
  "more",
  "need",
  "only",
  "other",
  "over",
  "same",
  "some",
  "than",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "what",
  "when",
  "where",
  "which",
  "will",
  "with",
  "would",
  "your",
]);

/** The words a turn names: four letters or more, or an acronym of two or more capitals. */
function namedWords(text: string): string[] {
  const found: string[] = [];
  for (const raw of text.split(/[^A-Za-z0-9'-]+/)) {
    const word = raw.replace(/^['-]+|['-]+$/g, "");
    if (!word) continue;
    const acronym = /^[A-Z]{2,6}s?$/.test(word);
    const lower = word.toLowerCase().replace(/'s$/, "");
    if (!acronym && (lower.length < 4 || TOPIC_STOP.has(lower))) continue;
    found.push(lower.replace(/s$/, ""));
  }
  return found;
}

/** The words this turn names that no earlier manager turn used. */
export function newTopicWords(question: string, history: readonly { role: string; content: string }[]): string[] {
  const earlier = new Set(
    history.filter((turn) => turn.role === "user").flatMap((turn) => namedWords(turn.content)),
  );
  return [...new Set(namedWords(question).filter((word) => !earlier.has(word)))];
}

/**
 * The query to search: `rewritten` unless the turn names a topic of its own
 * (two new words or more, after an earlier manager turn) and the rewrite kept
 * none of those words; then `ownWords`.
 */
export function followUpOwnQuery(input: {
  readonly question: string;
  readonly history: readonly { role: string; content: string }[];
  readonly rewritten: string;
  readonly ownWords: string;
}): string {
  if (!input.history.some((turn) => turn.role === "user" && turn.content.trim() !== "")) return input.rewritten;
  const fresh = newTopicWords(input.question, input.history);
  if (fresh.length < 2) return input.rewritten;
  const kept = new Set(namedWords(input.rewritten));
  return fresh.some((word) => kept.has(word)) ? input.rewritten : input.ownWords;
}
