/**
 * The cheap first reading of "change exit for lacey morrow" / "show draft of
 * exit", with no imports: whether a turn uses a verb that edits or shows a
 * form at all. The chat route checks this before loading the reopen path, so
 * a turn that is not about an existing form pays nothing for it. The full
 * reading is `readReopenRequest`.
 */
export const EDIT_VERB =
  /\b(?:edit|change|update|correct|fix|revise|redo|re-do|amend|modify|redraft|re-draft|reopen|re-open|unlock|unfinali[sz]e|un-finali[sz]e|duplicate|copy)\b/i;
const SHOW_WORDS = String.raw`show|see|view|display|bring\s+back|open\s+up`;
export const SHOW_VERB = new RegExp(String.raw`\b(?:${SHOW_WORDS})\b`, "i");
/*
 * REOPEN_BY_ANY_OPEN_VERB_ENABLED (QA, 6 Nov 2026; QA's history review of a
 * location manager's chats, 5 Nov 2026): "bring up <name>'s corrective
 * action", "bring up an old coaching form for <first name>" started a new
 * form, because only the words above open one on file. SHOW_VERB, extended by
 * the four verbs QA listed and nothing else (QA decision (a), 6 Nov 2026);
 * read only as the request itself (see `readReopenRequest`), so "she didn't
 * open the salon" is no reopen. "find" DISPLAYS a form, as "show" does; the
 * others OPEN it, as "edit" does (QA decision (b), 6 Nov 2026).
 */
export const OPEN_WORDS = String.raw`bring\s+up|pull\s+up|open`;
export const FIND_WORDS = String.raw`find`;
export const SHOW_OR_OPEN_VERB = new RegExp(String.raw`\b(?:${SHOW_WORDS}|${OPEN_WORDS}|${FIND_WORDS})\b`, "i");

/** `anyOpenVerb`: REOPEN_BY_ANY_OPEN_VERB_ENABLED, read by the caller (this module imports nothing). */
export function mayAskToReopen(question: string, anyOpenVerb = false): boolean {
  return EDIT_VERB.test(question ?? "") || (anyOpenVerb ? SHOW_OR_OPEN_VERB : SHOW_VERB).test(question ?? "");
}

/**
 * REOPEN_BY_ANY_OPEN_VERB_ENABLED: the question `chat-reopen.ts` asks when
 * several forms on file fit the request. The next turn — "2", "the one from
 * nov 3" — answers it, so the route lets that turn reach the reopen path.
 */
export const WHICH_FORM_ON_FILE = "Which one should I open?";

export function answersWhichFormOnFile(history: readonly { role: string; content: string }[]): boolean {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i]!.role === "assistant") return history[i]!.content.includes(WHICH_FORM_ON_FILE);
  }
  return false;
}
