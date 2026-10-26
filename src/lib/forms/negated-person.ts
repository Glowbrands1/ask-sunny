import { negatedPersonNoCardEnabled } from "@/lib/config/chat-quality-flags";

import { firstNonNegatedName, isNegatedName, onlyNegatedMentions } from "./negated-name";
import { extractEmployeeNames } from "./proposal";

/**
 * NEGATED_PERSON_NO_CARD_ENABLED (QA-6, 26 Oct 2026): "never one for Rowan
 * Pell" and "do not make one for Rowan Pell", with a card open for somebody
 * else, offered a card for Rowan Pell. The name readers of the intent and
 * open-form paths ask these before they take a person. The negation itself
 * is `forms/negated-name.ts`, the one helper the typed-name guard also uses.
 * Off: no name is negated and every text is returned unchanged.
 */

function distinct(names: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const trimmed = name?.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    out.push(trimmed);
  }
  return out;
}

/** Of `names`, the ones `text` names only after a negation. Flag off: none. */
export function negatedPeople(text: string, names: readonly (string | null | undefined)[]): string[] {
  if (!negatedPersonNoCardEnabled() || !text) return [];
  return distinct(names).filter((name) => onlyNegatedMentions(text, name));
}

/** The first of `names` that `text` names without a negation. Flag off: null. */
export function firstUnnegatedPerson(text: string, names: readonly (string | null | undefined)[]): string | null {
  if (!negatedPersonNoCardEnabled() || !text) return null;
  return firstNonNegatedName(text, distinct(names));
}

/** `text` with each negated mention of `names` blanked out (same length, so nothing else moves). */
export function withoutNegatedPeople(text: string, names: readonly string[]): string {
  if (!negatedPersonNoCardEnabled() || !text || names.length === 0) return text;
  let out = text;
  for (const name of names) {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    for (const match of text.matchAll(new RegExp(`(?<![\\w'’-])${escaped}(?![\\w'’-])`, "gi"))) {
      if (!isNegatedName(text, match.index)) continue;
      out = out.slice(0, match.index) + " ".repeat(match[0].length) + out.slice(match.index + match[0].length);
    }
  }
  return out;
}

/** "Rowan Pell": two capitalised words, the shape a typed name has. */
const TITLE_CASE_PAIR = /(?<![\w'’-])[A-Z][a-z][\w'’-]*\s+[A-Z][a-z][\w'’-]*(?![\w'’-])/g;

/**
 * The people `text` could be naming, for the negation check: the model's
 * reading, the proposal's name reader, any two capitalised words, and the
 * roster's names (which also find a name typed in lower case or ALL CAPS).
 * Flag off: none.
 */
export function negationCandidates(text: string, proposed: string | null | undefined, people: readonly string[] = []): string[] {
  if (!negatedPersonNoCardEnabled() || !text) return [];
  return distinct([proposed, ...extractEmployeeNames(text), ...(text.match(TITLE_CASE_PAIR) ?? []), ...people]);
}

/**
 * The model's person and the manager's turns as a name reader should see
 * them. A person the newest turn names only after a negation is blanked out
 * of that turn, and a model reading of them (or no reading) becomes the
 * first person the turn names without one, or nobody. A turn with no
 * negated person is left as given. Flag off: both as given.
 */
export function unnegatedNameReading(
  proposed: string | null,
  turns: readonly string[],
  people: readonly string[] = [],
): { proposed: string | null; turns: readonly string[] } {
  const latest = turns.at(-1) ?? "";
  const candidates = negationCandidates(latest, proposed, people);
  const negated = negatedPeople(latest, candidates);
  if (negated.length === 0) return { proposed, turns };
  const key = proposed?.trim().toLowerCase();
  // A negated model reading, or none, becomes the first person named without a negation.
  const replace = !key || negated.some((name) => name.toLowerCase() === key);
  return {
    proposed: replace ? firstUnnegatedPerson(latest, candidates) : proposed,
    turns: [...turns.slice(0, -1), withoutNegatedPeople(latest, negated)],
  };
}
