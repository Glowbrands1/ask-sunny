import { chatGlossaryEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * THE ABBREVIATIONS MANAGERS USE (CHAT_GLOSSARY_ENABLED, default off)
 * ============================================================================
 *
 * Ported from Ask Bubbles (40146f84, #419), where it is
 * `ai/glossary.ts`. Here that path is this app's house-terms table
 * (`HOUSE_GLOSSARY`, retrieval and form shorthands), which is on the
 * flags-off-parity PROTECTED list, so the port lives in this file instead.
 *
 * QA's overnight scan, 4 Nov 2026, sf-s12: "I need to make a corrective action
 * for msb" — MSB is Must See Behaviors, the reason for the form, and it was
 * read as an employee called "msb". Pau approved this text, byte for byte, for
 * both apps: it must stay the same in the sibling app. Do not reword it here.
 *
 * Two uses, both only with the flag on:
 *   - CONTEXT. The block is sent as one extra context block in the main
 *     answering call (`server-ask.ts` → `callClaude`) and in the form reader's
 *     call (`reader/read.ts`) and the other form-intake calls that read the
 *     employee from the manager's words. No system prompt changes.
 *   - A CODE GUARD. A name candidate whose words fold to a term in the table
 *     ("msb", "Msb", "MSB", "M.S.B.") is never the employee: `isGlossaryTerm`
 *     is read where names become the employee (see the parity-log entry).
 *
 * The terms come from the table itself: every "X = …" line. Add a term by
 * adding its line to the approved text, never by a second list.
 */
export const CHAT_GLOSSARY = `ABBREVIATIONS MANAGERS USE
MSB = Must See Behaviors. In "corrective action for MSB" it is the reason for the form, not a person.
A word in this table is never an employee's name and is never saved as one. If you cannot tell whether a word is a person or one of these terms, ask the manager once which employee they mean.`;

/** Letters and digits only, lower case: "M.S.B." and "Msb" both fold to "msb". */
function fold(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** The table's terms, folded: the left side of each "X = …" line. */
export const GLOSSARY_TERMS: ReadonlySet<string> = new Set(
  CHAT_GLOSSARY.split("\n")
    .map((line) => /^([A-Za-z0-9][A-Za-z0-9.&-]*)\s+=\s+\S/.exec(line)?.[1])
    .filter((term): term is string => Boolean(term))
    .map(fold),
);

/** True when the candidate's words, folded together, are a glossary term. Ignores the flag. */
export function foldsToGlossaryTerm(candidate: string | null | undefined): boolean {
  if (!candidate?.trim()) return false;
  const folded = fold(candidate.trim().split(/\s+/).join(""));
  return folded !== "" && GLOSSARY_TERMS.has(folded);
}

/** The code guard: with the flag on, a candidate that is a glossary term is never a person. Off, always false. */
export function isGlossaryTerm(candidate: string | null | undefined): boolean {
  return chatGlossaryEnabled() && foldsToGlossaryTerm(candidate);
}

/** With the flag on, whether the manager's words use a glossary term as a word ("… for msb"). Off, always false. */
export function mentionsGlossaryTerm(text: string | null | undefined): boolean {
  if (!chatGlossaryEnabled() || !text) return false;
  return text.split(/[^A-Za-z0-9.]+/).some((word) => foldsToGlossaryTerm(word.replace(/^\.+|\.+$/g, "")));
}

/** The block for a model call, or null with the flag off. */
export function glossaryBlock(): string | null {
  return chatGlossaryEnabled() ? CHAT_GLOSSARY : null;
}
