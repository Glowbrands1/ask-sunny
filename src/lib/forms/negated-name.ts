/**
 * ============================================================================
 * A NAME THE MANAGER SAYS THE FORM IS NOT FOR (QA-6, 26 OCT 2026)
 * ============================================================================
 *
 * "do not create a CA for test employee", "never write up test employee",
 * "never one for Rowan Pell", "without test employee", "everyone except test
 * employee", "instead of Rowan Pell", "no, not for Rowan Pell, for Corvin
 * Mallow": the name right after the negation is somebody the form is not
 * for. A name reader asks this before it takes a name, passes a negated one
 * over, and reads the first one that is not negated.
 *
 * Negations: not, never, no, don't / do not, without, except, instead of.
 * Between the negation and the name: nothing, "for" ("not for"), "write up",
 * "one for" ("never one for"), or a verb with up to three words and "for"
 * ("do not make one for", "do not create a CA for", "don't write a verbal
 * for"). Anything else ("not sure, but write one for Rowan Pell") leaves the
 * name read.
 *
 * Pure: reads no flag. Each caller decides behind its own flag whether to ask.
 * This file is the same, byte for byte, in both apps.
 */

const NEGATION = "(?:not|never|no|don['’]?t|do\\s+not|without|except|instead\\s+of)";

const BRIDGE = [
  // "not for", "except for", "never about"
  "(?:for|about|regarding)\\s+",
  // "never write up"
  "write\\s+up\\s+",
  // "never one for", "not another for"
  "(?:one|another)\\s+(?:more\\s+)?for\\s+",
  // "do not make one for", "do not create a CA for", "don't write a verbal for", "do not start a coaching form on"
  "(?:make|create|write|draft|start|open|prepare|issue|give|file|do)\\s+(?:(?:a|an|the|any|one|another)\\s+)?(?:[\\w-]+\\s+){0,3}?(?:for|about|regarding|on)\\s+",
].join("|");

const NEGATED_BEFORE = new RegExp(`(?<![\\w'’-])${NEGATION}\\s+(?:${BRIDGE})?$`, "i");

/** True when the name starting at `nameStart` in `text` follows a negation. */
export function isNegatedName(text: string, nameStart: number): boolean {
  if (!text || nameStart <= 0 || nameStart > text.length) return false;
  return NEGATED_BEFORE.test(text.slice(0, nameStart));
}

function mentions(text: string, name: string): number[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  return [...text.matchAll(new RegExp(`(?<![\\w'’-])${escaped}(?![\\w'’-])`, "gi"))].map((match) => match.index);
}

/** True when `name` is in `text` and every mention of it follows a negation. */
export function onlyNegatedMentions(text: string, name: string): boolean {
  const found = mentions(text ?? "", name);
  return found.length > 0 && found.every((index) => isNegatedName(text, index));
}

/** The first of `names`, in the order they stand in `text`, with a mention that is not negated. */
export function firstNonNegatedName(text: string, names: readonly string[]): string | null {
  let best: { name: string; index: number } | null = null;
  for (const name of names) {
    const index = mentions(text ?? "", name).find((at) => !isNegatedName(text, at));
    if (index !== undefined && (!best || index < best.index)) best = { name, index };
  }
  return best?.name ?? null;
}
