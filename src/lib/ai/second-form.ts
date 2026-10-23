import { NOT_A_TYPED_NAME } from "@/lib/forms/name-words";
import { detectTemplateIntent } from "@/lib/forms/template-intent";

/**
 * A request for a different document, not a revision of the one on screen.
 *
 * Follow-up coaching is its own template. "Another" and "second" are too.
 * A redraft of the open form is not. A form word that leads, with the
 * person's name later in the sentence, is a new document too: "coaching for
 * cell phone use … for Colene Schildt" is a coaching form, and a finalized
 * corrective action already on the thread does not answer it. Off, callers
 * ignore this and keep the revision path.
 */

const SEPARATE =
  /\b(?:follow[- ]?up coaching|follow[- ]?up form|second (?:form|document|ca|corrective|coaching)|another (?:form|ca|corrective action|coaching)|new (?:ca|corrective action|coaching form|follow[- ]?up)|separate (?:form|document))\b/i;

const REDRAFT =
  /\b(?:re-?draft|re-?write|revise|redo|change the|update the|fix the|edit the)\b/i;

const LEADING_FORM = /^(?:please\s+)?(coaching|ca|corrective action)\b/i;

export function wantsSeparateDocument(question: string): boolean {
  const text = question ?? "";
  if (REDRAFT.test(text) && !SEPARATE.test(text)) return false;
  if (SEPARATE.test(text)) return true;
  return promoteSeparateForm(text) !== null;
}

/**
 * A leading form word whose subject is named later, rewritten so the existing
 * form detector sees it. Null when the message is already a form request, a
 * redraft, or names nobody. The original words stay after the prefix.
 */
export function promoteSeparateForm(question: string): string | null {
  const text = (question ?? "").replace(/\s+/g, " ").trim();
  if (!text || (REDRAFT.test(text) && !SEPARATE.test(text))) return null;
  const intent = detectTemplateIntent(text);
  if (intent.kind === "explicit") return null;
  if (intent.kind === "corrective_action" && intent.requestedCreation) return null;
  const lead = LEADING_FORM.exec(text);
  if (!lead) return null;
  const person = personNamedLater(text);
  if (!person) return null;
  const coaching = lead[1]!.toLowerCase() === "coaching";
  const rewritten = coaching ? `coaching form for ${person}. ${text}` : `corrective action form for ${person}. ${text}`;
  return detectTemplateIntent(rewritten).kind === "explicit" ? rewritten : null;
}

function personNamedLater(text: string): string | null {
  for (const match of text.matchAll(/\bfor\s+((?:[A-Za-z][A-Za-z'’.-]*\s+){0,2}[A-Za-z][A-Za-z'’.-]*)/g)) {
    const words = match[1]!.split(/\s+/);
    while (words.length > 0 && NOT_A_TYPED_NAME.has(words[words.length - 1]!.toLowerCase())) words.pop();
    if (words.length >= 2 && words.every((word) => !NOT_A_TYPED_NAME.has(word.toLowerCase()))) return words.join(" ");
  }
  return null;
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
