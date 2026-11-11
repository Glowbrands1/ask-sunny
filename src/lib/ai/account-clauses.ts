import { statedWarningLevel } from "@/lib/forms/warning-level";

/**
 * LEVEL_STEP_NOT_ACCOUNT_ENABLED (QA S12 / S1, 27 Oct 2026): "this should be a
 * written and note a verbal ca was given on 9-1-26" went into the card's
 * Observation of Offense. The first clause sets the warning level and the
 * second lists a prior step; neither says what happened. A clause that only
 * states the level, or only says a step was given on a date, is left out of
 * the account; every other clause stays, in the manager's words.
 */
const STEP_WORD = /\b(?:verbal|written|final|ca|c\/a|corrective|coaching|coached|warning|write-?up)\b/i;
const GIVEN = /\b(?:was|were|been|got|received|had)\s+(?:already\s+|previously\s+|also\s+)?(?:issued|given|signed)\b|\b(?:issued|gave|given|signed|received)\b/i;
const DATED = /\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/;
/** Only the level: "this should be a written", "it's a verbal warning", "make it written". */
const LEVEL_ONLY =
  /^(?:(?:this|it)(?:\s+one)?\s+(?:should\s+be|is|will\s+be|needs\s+to\s+be)|it'?s|make\s+(?:it|this))\s+(?:a\s+)?(?:verbal|written)(?:\s+(?:warning|ca|corrective\s+action))?[.!]?$/i;

function onlyLevel(clause: string): boolean {
  return LEVEL_ONLY.test(clause.trim()) && statedWarningLevel(clause) !== null;
}

function onlyStep(clause: string): boolean {
  return STEP_WORD.test(clause) && GIVEN.test(clause) && DATED.test(clause);
}

export function withoutLevelAndStepClauses(sentence: string): string {
  const clauses = sentence.split(/\s+and\s+/i);
  if (clauses.length < 2 && !onlyLevel(sentence) && !onlyStep(sentence)) return sentence;
  return clauses.filter((clause) => !onlyLevel(clause) && !onlyStep(clause)).join(" and ").trim();
}
