/**
 * A REFORMAT TURN KEEPS THE SOURCES OF THE ANSWER IT REFORMATS
 * (REFORMAT_KEEPS_SOURCES_ENABLED).
 *
 * QA, conv_mufp73ez8pl7992: a pre-screen summary cited two company documents.
 * The next turn, "ok, make this a downloadable document for …", was searched
 * on its own words, those documents were not found again, and the reply
 * "corrected" the summary: "none of that is in the knowledge base I can see".
 * The figures were in the knowledge base; the model just could not see them
 * any more.
 *
 * On a turn that only asks to reshape the previous answer, the question that
 * answer was retrieved for is searched again and its rows are kept ahead of
 * this turn's own. Every row is still read from the knowledge base on the
 * server; nothing the browser sent is used as a source.
 */

type Turn = { readonly role: string; readonly content: string; readonly error?: unknown };

const THIS = String.raw`(?:this|that|it|these|those|the\s+(?:above|summary|answer|list|notes?|last\s+(?:one|answer|message)))`;
const SHAPE = String.raw`(?:a\s+|an\s+|into\s+(?:a\s+|an\s+)?|in(?:to)?\s+(?:a\s+|an\s+)?|as\s+(?:a\s+|an\s+)?)?(?:(?:downloadable|printable|printed|word|pdf|one[-\s]page|clean|short(?:er)?|formal)\s+)*(?:document|doc|file|pdf|word\s+doc(?:ument)?|table|chart|list|bullet(?:ed)?\s+(?:points?|list)|bullets|email|e-mail|memo|letter|summary|paragraph|handout|one[-\s]pager|outline|spreadsheet)`;

const REFORMAT: readonly RegExp[] = [
  new RegExp(String.raw`\b(?:make|turn|put|convert|format|reformat|change|rewrite|copy|paste|export|save)\s+${THIS}\s+${SHAPE}\b`, "i"),
  new RegExp(String.raw`\b(?:can|could|would|will)\s+${THIS}\s+be\s+(?:formatted|reformatted|put|made|turned|converted|shortened|bulleted|summari[sz]ed|downloaded|printed)\b`, "i"),
  new RegExp(String.raw`\b(?:summari[sz]e|shorten|condense|tighten|simplify|bullet(?:ize)?|tabulate)\s+${THIS}\b`, "i"),
  new RegExp(String.raw`^\s*(?:(?:ok(?:ay)?|great|thanks|perfect|now)[,.!]?\s+)?(?:can\s+you\s+|please\s+)?(?:give\s+(?:me\s+)?|send\s+(?:me\s+)?)?${THIS}\s+(?:as|in(?:to)?)\s+${SHAPE}\b`, "i"),
];

/** True when the turn only asks to reshape what came before, and there is an earlier answer to reshape. */
export function isReformatTurn(question: string, history: readonly Turn[]): boolean {
  const text = (question ?? "").trim();
  if (!text) return false;
  if (!REFORMAT.some((pattern) => pattern.test(text))) return false;
  return history.some((turn) => turn.role === "assistant" && !turn.error && turn.content.trim() !== "");
}

/**
 * The manager turn the previous answer was written for, with the history
 * before it, skipping turns that were themselves reformats ("can this be
 * formatted with bullet points?" after "make this a document"). Null when
 * there is no such turn.
 */
export function earlierAnsweredTurn(
  history: readonly Turn[],
): { readonly question: string; readonly history: readonly Turn[] } | null {
  let sawAnswer = false;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index]!;
    if (turn.role === "assistant") {
      if (!turn.error && turn.content.trim() !== "") sawAnswer = true;
      continue;
    }
    if (!sawAnswer || turn.role !== "user" || turn.content.trim() === "") continue;
    const before = history.slice(0, index);
    if (isReformatTurn(turn.content, before)) continue;
    return { question: turn.content, history: before };
  }
  return null;
}

/** The earlier answer's rows first, then this turn's, each chunk once, at most `limit`. */
export function keepEarlierSources<T extends { chunk_id: string }>(
  earlier: readonly T[],
  current: readonly T[],
  limit: number,
): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const row of [...earlier, ...current]) {
    if (seen.has(row.chunk_id)) continue;
    seen.add(row.chunk_id);
    kept.push(row);
  }
  return kept.slice(0, Math.max(limit, earlier.length));
}
