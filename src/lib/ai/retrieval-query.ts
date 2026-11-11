import { slotOnlyRetrievalTopic } from "./slot-only-turn";
import type { OpenFormSummary } from "./types";

/**
 * ============================================================================
 * A FOLLOW-UP IS SEARCHED WITH WHAT IT FOLLOWS
 * ============================================================================
 *
 * Production feedback, 20 Oct 2026. Sunny quoted the manual's Late Opening
 * section; the manager replied "I have independently verified and the policy
 * is correct you may issue"; and Sunny took the quotation back — "the
 * knowledge base I can see right now has nothing on late opening". Both were
 * honest about what retrieval returned. The second search was for the words
 * "verified", "policy" and "correct", and the Late Opening passage does not
 * resemble them.
 *
 * So a turn that only POINTS BACK — short, and leaning on "it", "that", "the
 * policy" or an opening "and" / "what about" — is searched together with what
 * it points at:
 *
 *   the manager's previous turn     what "that" meant when they said it
 *   the open form's cited sections  "the policy" on a form that cites Late
 *                                   Opening is Late Opening
 *
 * WHAT THIS DOES NOT CHANGE. The question still leads the query, so a
 * follow-up that names a new topic still finds it first. A turn that does not
 * point back, or is long enough to carry its own topic, is searched exactly as
 * before. Only the MANAGER'S words are added — an assistant turn is Sunny's
 * own output, and searching on it would let one answer ground the next. And
 * this is retrieval only: the model is still told to answer from the sources
 * that come back, and nothing here becomes a source.
 *
 * Pure; `server-ask.ts` calls it for the knowledge search and nothing else.
 */

/** Past this many words a turn carries its own topic. */
const FOLLOW_UP_MAX_WORDS = 25;

/** How much of the earlier turn is added — enough for its topic, not its whole account. */
const PREVIOUS_TURN_CHARS = 400;

const POINTS_BACK =
  /\b(?:it|its|that|this|those|these|they|them|same|above|the\s+(?:policy|policies|section|rule|rules|one|manual|form|wording|language))\b|^\s*(?:and|but|so|also|what about|how about|then|ok|okay)\b/i;

export function retrievalQueryFor(input: {
  readonly question: string;
  readonly history: readonly { role: string; content: string; error?: unknown }[];
  readonly openForm?: OpenFormSummary | null;
}): string {
  const question = (input.question ?? "").trim();
  /*
   * A TURN THAT ONLY FILLS IN A DETAIL — "She works at Lawrence", "It happened
   * on 10-21" — is searched with the conversation's topic instead of its own
   * words. See `slot-only-turn.ts`.
   */
  const topic = slotOnlyRetrievalTopic(question, input.history);
  if (topic) return topic;
  const words = question.split(/\s+/).filter(Boolean).length;
  if (words === 0 || words > FOLLOW_UP_MAX_WORDS || !POINTS_BACK.test(question)) return question;

  const previous = [...input.history]
    .reverse()
    .find((turn) => turn.role === "user" && !turn.error && typeof turn.content === "string" && turn.content.trim() !== "");
  const extra = [
    previous ? clip(previous.content.trim()) : "",
    ...citedSections(input.openForm),
  ].filter((part) => part !== "" && !question.toLowerCase().includes(part.toLowerCase()));

  return extra.length === 0 ? question : [question, ...extra].join("\n");
}

/**
 * The manual sections the open form cites — read off its source lines,
 * "Source: JBA Policy Manual — Late Opening, p. 15" → "Late Opening".
 */
export function citedSections(form: OpenFormSummary | null | undefined): string[] {
  if (!form) return [];
  const found = new Set<string>();
  for (const line of form.lines) {
    for (const match of line.value.matchAll(/Source:[^\n—]*—\s*([^\n,]+?)(?:,\s*pp?\.\s*[\d–-]+)?\s*(?:\n|$)/g)) {
      const section = match[1]!.trim();
      if (section !== "") found.add(section);
    }
  }
  return [...found];
}

function clip(text: string): string {
  if (text.length <= PREVIOUS_TURN_CHARS) return text;
  const cut = text.slice(0, PREVIOUS_TURN_CHARS);
  const space = cut.lastIndexOf(" ");
  return space > PREVIOUS_TURN_CHARS * 0.6 ? cut.slice(0, space) : cut;
}
