import { readSentenceEdit } from "./edit-date-rules";

/**
 * GRAMMAR_ASK_NOT_ACCOUNT_ENABLED (QA P5, 27 Oct 2026): a grammar request ("can
 * you clean up my grammar and capitalizing on proper nouns?"), or an
 * instruction asked as a question ("can you …?"), is not the manager's
 * account. "add that she was rude" stays account. Used for the card's
 * Observation (`keep-filled-slots.ts`) and the draft's notes (the draft route).
 */
export function isAskToTheApp(sentence: string): boolean {
  const read = readSentenceEdit(sentence);
  return read?.kind === "grammar" || (read?.kind === "instruction" && /\?\s*$/.test(sentence.trim()));
}

/** The text without its sentences that ask the app for something; line breaks kept. */
export function withoutAsksToTheApp(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !isAskToTheApp(sentence))
        .join(" "),
    )
    .join("\n");
}
