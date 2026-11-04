/**
 * ============================================================================
 * THE CHAT GLOSSARY, AS CA_SALES_POLICY_ENABLED READS IT — A NO-OP FOR NOW
 * ============================================================================
 *
 * In Ask Bubbles (#422) an account that uses a term of the approved chat
 * glossary (MSB, Must See Behaviors) is read as the Standards of Conduct, and
 * the term is looked up with `foldsToGlossaryTerm` from the glossary module.
 * Ask Sunny's copy of that table, `src/lib/ai/chat-glossary.ts`, is on
 * claude/chat-glossary (PR #506) and not yet on main. `src/lib/ai/glossary.ts`
 * here is a different table — the house form shorthands ("ca", "write up") —
 * and has no policy terms, so it is not read in its place.
 *
 * Until #506 merges this answers false for every word: no account is read as
 * MSB, and only the Under Performance reading applies. When #506 merges,
 * replace the body with `return foldsToGlossaryTerm(candidate);`, imported from
 * "@/lib/ai/chat-glossary". Never add a word list here: the terms come from the
 * approved glossary text alone.
 */
export function foldsToChatGlossaryTerm(candidate: string | null | undefined): boolean {
  void candidate;
  return false;
}
