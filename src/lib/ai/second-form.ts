/**
 * A request for a different document, not a revision of the one on screen.
 *
 * Follow-up coaching is its own template. "Another" and "second" are too.
 * A redraft of the open form is not. Off, callers ignore this and keep
 * the revision path.
 */

const SEPARATE =
  /\b(?:follow[- ]?up coaching|follow[- ]?up form|second (?:form|document|ca|corrective|coaching)|another (?:form|ca|corrective action|coaching)|new (?:ca|corrective action|coaching form|follow[- ]?up)|separate (?:form|document))\b/i;

const REDRAFT =
  /\b(?:re-?draft|re-?write|revise|redo|change the|update the|fix the|edit the)\b/i;

export function wantsSeparateDocument(question: string): boolean {
  const text = question ?? "";
  if (REDRAFT.test(text) && !SEPARATE.test(text)) return false;
  return SEPARATE.test(text);
}

/** Any manager turn in the create payload asked for a different document. */
export function historyWantsSeparateDocument(conversation: unknown): boolean {
  if (!Array.isArray(conversation)) return false;
  return conversation.some((turn) => {
    if (!turn || typeof turn !== "object") return false;
    const row = turn as { role?: unknown; content?: unknown };
    return row.role === "user" && wantsSeparateDocument(typeof row.content === "string" ? row.content : "");
  });
}
