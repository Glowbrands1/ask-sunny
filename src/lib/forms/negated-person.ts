import { negatedPersonNoCardEnabled } from "@/lib/config/chat-quality-flags";

import { firstNonNegatedName, isNegatedName, onlyNegatedMentions } from "./negated-name";

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
