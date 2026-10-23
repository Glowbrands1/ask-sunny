import { createHash } from "node:crypto";

/**
 * Low-star chats turned into replay cases, and high-star chats turned into
 * examples.
 *
 * Personal data is removed with patterns and with the roster names the
 * caller supplies. Nothing here writes to a database.
 */

export interface FeedbackRating {
  readonly activityEventId: string;
  readonly rating: number;
  readonly comment: string;
}

export interface FeedbackMessage {
  readonly conversationId: string;
  readonly position: number;
  readonly role: string;
  readonly content: string;
  readonly turnId: string | null;
}

export interface FeedbackReplayCase {
  readonly id: string;
  readonly rating: number;
  readonly prompts: readonly string[];
  readonly answer: string;
  readonly note?: string;
  readonly headings?: readonly string[];
  readonly expectHeading?: string;
}

export interface RatedExchange {
  readonly id: string;
  readonly rating: number;
  readonly scopeId: string;
  readonly question: string;
  readonly answer: string;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]\d{3}[-.\s]\d{4}/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const STREET =
  /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,3}\s+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way|place|pl)\b\.?/gi;

/** Emails, phone numbers, street addresses, ids, and any roster name supplied. */
export function redactPersonal(text: string, rosterNames: readonly string[] = []): string {
  let next = text
    .replace(EMAIL, "[email]")
    .replace(PHONE, "[phone]")
    .replace(SSN, "[id]")
    .replace(UUID, "[id]")
    .replace(STREET, "[address]");
  const names = [...rosterNames]
    .map((name) => name.trim())
    .filter((name) => name.length > 2)
    .sort((a, b) => b.length - a.length);
  let label = 1;
  for (const name of names) {
    const pattern = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    if (!pattern.test(next)) continue;
    const token = `[employee ${label}]`;
    label += 1;
    next = next.replace(pattern, token);
  }
  return next;
}

export function containsPersonalData(text: string): boolean {
  return [EMAIL, PHONE, SSN, UUID, STREET].some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

/**
 * One case per 1–4 star rating that still has a question and an answer.
 * Five-star rows are not replay failures. The id is a hash of the redacted
 * question, so the file does not keep the event id.
 */
export function buildReplayCases(input: {
  readonly ratings: readonly FeedbackRating[];
  readonly messages: readonly FeedbackMessage[];
  readonly rosterNames?: readonly string[];
}): FeedbackReplayCase[] {
  const names = input.rosterNames ?? [];
  const cases: FeedbackReplayCase[] = [];
  for (const rating of input.ratings) {
    if (!Number.isInteger(rating.rating) || rating.rating < 1 || rating.rating > 4) continue;
    const answer = input.messages.find(
      (message) => message.role === "assistant" && message.turnId === rating.activityEventId,
    );
    if (!answer) continue;
    const question = input.messages
      .filter(
        (message) =>
          message.conversationId === answer.conversationId &&
          message.role === "user" &&
          message.position < answer.position &&
          message.content.trim() !== "",
      )
      .sort((a, b) => b.position - a.position)[0];
    if (!question) continue;
    const prompt = redactPersonal(question.content, names).trim();
    const reply = redactPersonal(answer.content, names).trim();
    if (!prompt || !reply) continue;
    const note = rating.comment.trim() ? redactPersonal(rating.comment, names).trim() : "";
    cases.push({
      id: `fb-${createHash("sha256").update(prompt).digest("hex").slice(0, 12)}`,
      rating: rating.rating,
      prompts: [prompt],
      answer: reply,
      ...(note ? { note } : {}),
    });
  }
  return cases;
}

const STOP = new Set(["that", "this", "with", "from", "have", "were", "your", "what", "when", "they", "them", "about"]);

/** Highly rated exchanges for this company only, closest wording first. */
export function selectFewShot(input: {
  readonly question: string;
  readonly scopeId: string;
  readonly exchanges: readonly RatedExchange[];
  readonly limit?: number;
}): RatedExchange[] {
  const wanted = tokens(input.question);
  if (!input.scopeId || wanted.size === 0) return [];
  return input.exchanges
    .filter((item) => item.rating >= 5 && item.scopeId === input.scopeId)
    .map((item) => ({ item, score: overlap(wanted, tokens(`${item.question} ${item.answer}`)) }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score || b.item.rating - a.item.rating)
    .slice(0, input.limit ?? 3)
    .map((scored) => scored.item);
}

export function fewShotPrompt(examples: readonly RatedExchange[], rosterNames: readonly string[] = []): string {
  if (examples.length === 0) return "";
  const body = examples
    .map((item, index) => {
      const question = redactPersonal(item.question, rosterNames);
      const answer = redactPersonal(item.answer, rosterNames);
      return `Example ${index + 1}, rated ${item.rating}:\nManager: ${question}\nAssistant: ${answer}`;
    })
    .join("\n\n");
  return `SIMILAR PAST ANSWERS THIS COMPANY RATED HIGHLY

These are examples of shape from this company only. Do not copy a name, a date, a figure, or a policy from them unless the sources for this question also say it.

${body}`;
}

/** A row whose stored scope is a different company is not an example here. */
export function scopeForExchange(metadata: unknown, scopeId: string): string | null {
  if (!scopeId) return null;
  if (metadata && typeof metadata === "object" && "scopeId" in metadata) {
    const value = (metadata as { scopeId?: unknown }).scopeId;
    if (typeof value === "string" && value.trim() && value.trim() !== scopeId) return null;
  }
  return scopeId;
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4 && !STOP.has(word)),
  );
}

function overlap(wanted: ReadonlySet<string>, found: ReadonlySet<string>): number {
  let count = 0;
  for (const word of wanted) if (found.has(word)) count += 1;
  return count;
}
