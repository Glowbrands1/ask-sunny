import { sourcesOnTopicEnabled } from "@/lib/config/chat-quality-flags";
import { routeReportFamilies } from "@/lib/reporting/read/family-routing";
import type { SourceCitation } from "@/types";

import { DAILY_STATS_REPORT_NAMES, DAILY_STATS_TERMS, isDailyStatsQuestion } from "./daily-stats-gate";

/**
 * ============================================================================
 * A DAILY STATS QUESTION'S SOURCE CARDS ARE ON ITS TOPIC (SOURCES_ON_TOPIC_ENABLED)
 * ============================================================================
 *
 * QA's live test (24 Nov 2026): "What are the top coaching priorities in a Daily Stats report?" was answered from the
 * coaching framework ("this is methodology, not a live read of a report"), and the only source card shown was the
 * Confidential Information Policy, JBA Policy Manual p.22. On 16 Nov the same question cited the framework. A card is
 * whatever the reply marked [S#]; nothing checked that it was about the question.
 *
 * TWO RULES, both only on a question the Daily Stats gate opens (`daily-stats-gate.ts`), so no other answer's cards change:
 *
 *   1. A Daily Stats coaching-priorities question ("top coaching priorities", "what should I focus on" with the Daily
 *      Stats report named or its figures asked for) shows the Daily Stats Interpretation Framework's card when the
 *      framework was in the answer's sources and the reply marked none of it. The answer was written with it.
 *   2. A card none of whose words is one of the question's own (the question's words, without the framework's
 *      interpretation vocabulary and plain function words) is not about it. When EVERY card but the framework's is like
 *      that, those cards are dropped: an unrelated source is never the only card. A card that shares a word with the
 *      question is kept, and so is every card when one of them does.
 *
 * Off, the cards are returned as given.
 */

/** Words that say nothing about a question's topic: function words, and the framework's own interpretation vocabulary. */
const STOP = new Set([
  ...`a an and are as at be been but by can could did do does doing for from get got had has have how i if in into is it
  its me my of on or our should so than that the their them then there these they this those to up us was we were what
  when where which who why will with would you your about any all also am just more most much need now out over same some
  such very want give tell show list best top main key three five first next today week month report reports daily stat
  stats quick coach coaching coached priority priorities prioritize prioritise focus manager managers team salon salons
  store stores staff employee employees thing things good look looking work working question answer help`.split(/\s+/),
  ...DAILY_STATS_TERMS.flatMap((term) => term.toLowerCase().split(/[^a-z]+/)),
]);

function stem(word: string): string {
  return word.replace(/(?:ing|ed|es|s)$/, "");
}

/** The question's own topic words (lower case, four letters or more, stemmed). */
export function topicWords(question: string): string[] {
  const words = question.toLowerCase().match(/[a-z]+/g) ?? [];
  return [...new Set(words.filter((word) => word.length >= 4 && !STOP.has(word)).map(stem).filter((word) => word.length >= 4))];
}

/** Whether a card shares one of the question's topic words, in its title, locator or excerpt. */
export function cardOnTopic(question: string, card: Pick<SourceCitation, "documentTitle" | "locator" | "excerpt">): boolean {
  const words = topicWords(question);
  if (words.length === 0) return false;
  const text = `${card.documentTitle} ${card.locator} ${card.excerpt}`.toLowerCase();
  return words.some((word) => new RegExp(`\\b${word}`).test(text));
}

const NAMES_REPORT = new RegExp(`\\b(?:${DAILY_STATS_REPORT_NAMES.map((name) => name.replace(/\s+/g, "\\s+")).join("|")})\\b`, "i");
const COACHING_FOCUS = /\b(?:coach\w*|focus\w*|priorit(?:y|ies|ise|ize)\w*|work on|improve|top\s+(?:three|3|five|5)|where do i start|what should i)\b/i;

/** A Daily Stats coaching-priorities question: what to coach or focus on, with the report named or its figures reached for. */
export function asksDailyStatsCoaching(question: string): boolean {
  return COACHING_FOCUS.test(question) && (NAMES_REPORT.test(question) || routeReportFamilies(question).length > 0);
}

/**
 * The cards a reply shows, with the two rules above applied. `framework`: the Daily Stats framework's cards this answer
 * was given, in order (empty when it was not, or does not exist); `frameworkIds`: the role documents' ids (never
 * checked for topic words: they are the reasoning model the answer was written with).
 */
export function onTopicCards(input: {
  readonly question: string;
  readonly cards: readonly SourceCitation[];
  readonly framework: readonly SourceCitation[];
  readonly frameworkIds?: ReadonlySet<string>;
}): SourceCitation[] {
  const cards = [...input.cards];
  if (!sourcesOnTopicEnabled() || !isDailyStatsQuestion(input.question)) return cards;
  const roleIds = new Set([...(input.frameworkIds ?? []), ...input.framework.map((card) => card.documentId)]);
  const isRole = (card: SourceCitation) => roleIds.has(card.documentId);
  const frameworkShown = cards.some((card) => input.framework.some((entry) => entry.documentId === card.documentId));
  const shown = !frameworkShown && input.framework.length > 0 && asksDailyStatsCoaching(input.question) ? [input.framework[0]!, ...cards] : cards;
  const others = shown.filter((card) => !isRole(card));
  if (others.length === 0 || others.some((card) => cardOnTopic(input.question, card))) return shown;
  return shown.filter(isRole);
}
