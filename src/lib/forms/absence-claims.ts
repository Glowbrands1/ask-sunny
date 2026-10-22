/**
 * ============================================================================
 * "A NO CALL / NO SHOW" IS THE MANAGER'S TO SAY
 * ============================================================================
 *
 * QA, 22 Oct 2026. The policy manual's Seminar/Webinar Attendance section
 * says a seminar missed WITHOUT NOTIFYING the Supervisor "is considered a no
 * call no show to a scheduled shift" — so whether she called anyone is the
 * fact the classification turns on. A draft for "she skipped the monthly
 * meeting" came back saying "This was a no call/no show. She did not notify
 * her manager.", which nobody had said.
 *
 * A drafted sentence that calls an absence a no call/no show (or job
 * abandonment), or says the employee did not call, notify, tell or contact
 * anyone, survives only where the manager's own words say the same kind of
 * thing. The sentence is removed, never reworded; the rest of the field
 * stands, and a labelled section that lost its only sentence loses its label.
 *
 * Pure and browser-safe.
 */

const UNSTATED: readonly { pattern: RegExp; family: RegExp }[] = [
  {
    pattern: /\bno[- ]?call[,/ -]*(?:and\s+)?no[- ]?show\b|\bncns\b|\bjob\s+abandonment\b/i,
    family: /\bno[- ]?call\b|\bncns\b|\bno[- ]?show\b|\babandon\w*/i,
  },
  {
    pattern:
      /\b(?:without|did ?n[o']?t|didn['’]t|never|failed\s+to|neglected\s+to)\s+(?:\w+\s+){0,2}?(?:notify\w*|call(?:ing|ed)?|inform\w*|tell\w*|contact\w*|let\s+(?:\w+\s+)?know|giving\s+notice|notice)\b/i,
    family: /\b(?:notif\w*|notice|call\w*|inform\w*|told|tell\w*|contact\w*|text\w*|let\s+\w+\s+know|heads[- ]up|no[- ]?show|ncns)\b/i,
  },
];

/** Whether this sentence says something about the absence that `source` does not. */
export function unstatedAbsenceClaim(sentence: string, source: string): boolean {
  return UNSTATED.some((entry) => entry.pattern.test(sentence) && !entry.family.test(source));
}

function guardText(text: string, source: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const lines = text.split("\n").map((line) =>
    line
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => {
        if (!unstatedAbsenceClaim(sentence, source)) return true;
        removed.push(sentence.trim());
        return false;
      })
      .join(" "),
  );
  const cleaned = lines.filter((line, index) => {
    if (!/^[A-Z][A-Za-z -]{0,30}:\s*$/.test(line.trim())) return true;
    const next = lines.slice(index + 1).find((candidate) => candidate.trim() !== "");
    return next !== undefined && !/^[A-Z][A-Za-z -]{0,30}:/.test(next.trim());
  });
  return { text: removed.length > 0 ? cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim() : text, removed };
}

export interface AbsenceClaimResult {
  values: Record<string, string>;
  /** Fields a sentence was removed from. */
  adjusted: string[];
  /** The sentences removed. */
  removed: string[];
}

/** Every drafted text field, held to what the manager said about the absence. */
export function guardAbsenceClaims(values: Record<string, string>, source: string): AbsenceClaimResult {
  const next: Record<string, string> = {};
  const adjusted: string[] = [];
  const removed: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== "string" || value.trim() === "") {
      next[key] = value;
      continue;
    }
    const guarded = guardText(value, source);
    if (guarded.removed.length > 0) {
      adjusted.push(key);
      removed.push(...guarded.removed);
    }
    if (guarded.text !== "") next[key] = guarded.text;
  }
  return { values: next, adjusted, removed };
}

export const ABSENCE_CLAIM_REMOVED_NOTICE =
  "Wording that called this a no call/no show, or said the employee did not call or notify anyone, was removed because your notes did not say so. Add it back only if it is true.";
