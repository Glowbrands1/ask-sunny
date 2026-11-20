/**
 * ============================================================================
 * A COACHING OBSERVED LINE IS WHAT WAS SEEN, NOT THE TOPIC (QA's live test of #1144, 20 Nov 2026)
 * ============================================================================
 *
 * "coaching for <P> on greeting guests, she didn't greet 3 guests today" saved "Observed:\nGreeting guests, she didn't
 * greet 3 guests." The coaching card's topic ("greeting guests", kept on the manager's words; `coachingTopic`) was put in
 * front of what was seen. Observed starts with what was seen: a leading "<topic>," / "<topic>:" / "<topic> —" is
 * dropped and the rest capitalised. Read from the card's record (the topic), never a word list. Pure.
 */

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The write-up with the topic prefix taken off its Observed line(s); unchanged when there is none. */
export function withoutTopicPrefix(text: string, topic: string | null | undefined): string {
  const words = (topic ?? "").trim().replace(/[.!?]+$/, "").split(/\s+/).filter(Boolean);
  if (words.length === 0 || text.trim() === "") return text;
  const prefix = new RegExp(`(^|\\bObserved:\\s*\\n?)\\s*${words.map(escape).join("\\s+")}\\s*(?:,|:|—|–|-)\\s+(?=\\S)`, "i");
  return text.replace(prefix, (_match, before: string) => before).replace(/(^|\bObserved:\s*\n?\s*)([a-z])/, (_match, before: string, letter: string) => `${before}${letter.toUpperCase()}`);
}
