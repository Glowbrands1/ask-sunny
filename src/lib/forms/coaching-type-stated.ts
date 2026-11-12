import { coachingTypeStatedTicksEnabled } from "@/lib/config/chat-quality-flags";

/*
 * ============================================================================
 * A COACHING TYPE THE MANAGER NAMES IS TICKED AS STATED (COACHING_TYPE_STATED_TICKS_ENABLED)
 * ============================================================================
 *
 * Ported from Ask Bubbles (QA's 17p live check there, 12 Nov 2026): a coaching request that named its type ("… coaching on under performance")
 * was drafted with no Coaching Type ticked; the tick was left to the drafting model, which sometimes ticks and sometimes
 * does not. Like a stated warning level on a Corrective Action, a coaching type the manager names is ticked as their
 * statement, before the model drafts, and the model's own tick never replaces it. Exactly one named type; two, or a
 * negated one ("not underperformance"), state nothing. Topics stay with the model. Pure; off, nothing is read.
 */

/** The group on the Coaching Form. */
export const COACHING_TYPE_KEY = "coaching_type";

/** The one key a stated coaching type may write (`applyStatedFacts` / `statedWrite`). */
export const COACHING_TYPE_STATED_KEYS: ReadonlySet<string> = new Set([COACHING_TYPE_KEY]);

const TYPES: readonly { key: string; said: RegExp }[] = [
  { key: "underperformance", said: /\bunder[\s-]?perform(?:ance|ing|s)?\b/i },
  { key: "training_plan_of_action", said: /\btraining\s+plan(?:\s+of\s+action)?\b/i },
  { key: "retraining", said: /\bre-?train(?:ing|ed)?\b/i },
];

const NEGATED_BEFORE = /\b(?:not|no|isn['’]?t|wasn['’]?t|never|without)\s+(?:(?:a|an|the|for|about|on)\s+)?$/i;

/** The one coaching type the manager's words name, among the options the form offers; null otherwise. */
export function statedCoachingType(notes: string, offered: readonly string[]): string | null {
  if (!coachingTypeStatedTicksEnabled()) return null;
  const found = new Set<string>();
  for (const type of TYPES) {
    if (!offered.includes(type.key)) continue;
    const pattern = new RegExp(type.said.source, "gi");
    for (const match of notes.matchAll(pattern)) {
      if (!NEGATED_BEFORE.test(notes.slice(0, match.index))) found.add(type.key);
    }
  }
  return found.size === 1 ? [...found][0]! : null;
}
