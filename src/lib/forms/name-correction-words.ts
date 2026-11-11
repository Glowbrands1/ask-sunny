import type { AskResponse } from "@/lib/ai/types";
import { nameCorrectionWordsEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * "FIX HER LAST NAME …" IS A CORRECTION OF THE NAME ON THE OPEN DRAFT
 * ============================================================================
 *
 * NAME_CORRECTION_WORDS_ENABLED. The 2 Nov 2026 scan: "The bot said it updated
 * the employee name …, but the form didn't change." The manager typed the
 * name one way, then: "fix her last name …", "under the employee line the name
 * is supposed to be …", "redo …", "make that change to …", "okay the correct
 * way is …". The header correction reads "change her name to …" and "her name
 * is …" — none of these — so the turns went to the answering model, which
 * said it had changed the name.
 *
 * Ported from Ask Bubbles. Each is handed to the correction as "change her
 * name to <the name>" (here no form's name is chat-correctable, so the reply
 * says how to change it on the card):
 * a last name alone keeps the first name on the form; a whole name counts only
 * when it shares a first or last name with the person on the open draft, so a
 * different person's name is never written over hers.
 */

const LAST_NAME = /^\s*(?:please\s+)?(?:fix|change|correct|update|make)\s+(?:her|his|their|the(?:\s+employee'?s)?)\s+last\s+name\s+(?:to\s+|is\s+|as\s+)?(.+?)\s*[.!]?\s*$/i;
const WHOLE_NAME: readonly RegExp[] = [
  /\bthe\s+(?:employee'?s?\s+)?name\s+is\s+supposed\s+to\s+be\s+(.+?)\s*[.!]?\s*$/i,
  /^\s*(?:ok(?:ay)?[,\s]+)?the\s+correct\s+(?:way|spelling|name)\s+is\s+(.+?)\s*[.!]?\s*$/i,
  /^\s*(?:please\s+)?make\s+that\s+change\s+to\s+(.+?)\s*[.!]?\s*$/i,
  /^\s*(?:please\s+)?redo\s+(?:it\s+(?:as|with)\s+)?(.+?)\s*[.!]?\s*$/i,
];

function words(name: string): string[] {
  return name.toLowerCase().split(/[^a-z'-]+/).filter(Boolean);
}

/** The turn as the header correction reads it, or null when it is not a name correction. */
export function nameCorrectionQuestion(question: string, currentName: string | null): string | null {
  if (!nameCorrectionWordsEnabled() || !currentName?.trim()) return null;
  const current = words(currentName);
  if (current.length === 0) return null;
  const last = LAST_NAME.exec(question);
  if (last) {
    const typed = last[1]!.trim();
    if (!typed || typed.split(/\s+/).length > 3) return null;
    return `change her name to ${[...currentName.trim().split(/\s+/).slice(0, -1), typed].join(" ")}`;
  }
  for (const pattern of WHOLE_NAME) {
    const match = pattern.exec(question);
    if (!match) continue;
    const typed = match[1]!.replace(/^["'“‘]+|["'”’]+$/g, "").trim();
    const said = words(typed);
    if (said.length < 2 || said.length > 5) return null;
    const shares = said[0] === current[0] || said[said.length - 1] === current[current.length - 1];
    return shares ? `change her name to ${typed}` : null;
  }
  return null;
}

/**
 * A name correction the open form does not take from the chat (a Corrective
 * Action's name is the directory's; only its date is chat-correctable): the
 * reply says how to change it, and that nothing changed.
 */
export function nameNotCorrectedReply(open: { templateName: string; employeeName: string }): AskResponse {
  return {
    recommendedVideoIds: [],
    content: `**Nothing on the form has changed yet.** The name on a ${open.templateName} isn't changed from the chat — edit the Employee Name line on the card and press **Save changes**. The name on the card is **${open.employeeName}**.`,
    citations: [],
    coverage: "not_applicable",
  };
}
