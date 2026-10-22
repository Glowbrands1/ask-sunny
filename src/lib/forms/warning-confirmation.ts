import { isQuestion } from "./employment-change";

/**
 * ============================================================================
 * "CONFIRM THE WRITTEN WARNING" — THE MANAGER CONFIRMS A SUGGESTED LEVEL
 * ============================================================================
 *
 * Owner decision, 22 Oct 2026: the assistant may suggest a Type of Warning,
 * and the manager confirms it — or chooses another — before the form can be
 * filed. This reads the confirmation. It is narrow on purpose: a confirming
 * word AND the level or the warning itself, never a bare "yes" (which answers
 * other questions too), never a question, never "don't confirm it".
 *
 * Returns the level the manager named, or null for "confirm the suggestion as
 * it stands"; null overall when the turn confirms nothing. Pure.
 */
const CONFIRMS =
  /\b(?:confirm(?:ed|s)?|approve[ds]?|accept(?:ed|s)?|agree[ds]?|that['’]?s\s+(?:right|correct|fine|good)|is\s+(?:right|correct|fine|good)|(?:looks|sounds)\s+(?:good|right)|keep\s+(?:it|the|that)|go\s+with|stick\s+with|leave\s+it\s+(?:as|at))\b/i;
const ABOUT_THE_LEVEL = /\b(?:warning|level|suggest(?:ion|ed)?|type\s+of\s+warning|verbal|written)\b/i;
const REFUSES = /\b(?:don['’]?t|do\s+not|not|never|no)\s+(?:\w+\s+){0,2}?(?:confirm|approve|accept|agree|keep|go\s+with)\b/i;

export type ConfirmedLevel = "verbal" | "written";

export function readWarningConfirmation(text: string): { level: ConfirmedLevel | null } | null {
  const trimmed = (text ?? "").trim();
  if (trimmed === "" || isQuestion(trimmed)) return null;
  if (!CONFIRMS.test(trimmed) || !ABOUT_THE_LEVEL.test(trimmed) || REFUSES.test(trimmed)) return null;
  const verbal = /\bverbal\b/i.test(trimmed);
  const written = /\bwritten\b/i.test(trimmed);
  if (verbal && written) return null;
  return { level: verbal ? "verbal" : written ? "written" : null };
}
