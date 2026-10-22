/**
 * The cheap first reading of "change exit for lacey morrow" / "show draft of
 * exit", with no imports: whether a turn uses a verb that edits or shows a
 * form at all. The chat route checks this before loading the reopen path, so
 * a turn that is not about an existing form pays nothing for it. The full
 * reading is `readReopenRequest`.
 */
export const EDIT_VERB =
  /\b(?:edit|change|update|correct|fix|revise|redo|re-do|amend|modify|redraft|re-draft|reopen|re-open|unlock|unfinali[sz]e|un-finali[sz]e|duplicate|copy)\b/i;
export const SHOW_VERB = /\b(?:show|see|view|display|bring\s+back|open\s+up)\b/i;

export function mayAskToReopen(question: string): boolean {
  return EDIT_VERB.test(question ?? "") || SHOW_VERB.test(question ?? "");
}
