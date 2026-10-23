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

/** SKIP, empty, or a failed rewrite keeps the query the existing path would have used. */
export function queryAfterRewrite(fallback: string, rewritten: string | null | undefined): string {
  const next = rewritten?.trim() ?? "";
  if (!next || next.toUpperCase() === "SKIP") return fallback;
  return next;
}
