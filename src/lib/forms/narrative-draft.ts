/**
 * ============================================================================
 * WHAT WAS OBSERVED, AND WHAT WAS EXPECTED
 * ============================================================================
 *
 * A coaching record that says only
 *
 *   "Sarah arrived late for her scheduled shift today."
 *
 * records an event and nothing else. It does not say what the manager actually
 * told her, so it cannot show that an expectation was ever communicated — which
 * is the part that makes a coaching form worth signing. The drafted narrative
 * is therefore written in labelled sections:
 *
 *   Observed:
 *   <what happened>
 *
 *   Expectation:
 *   <the expectation the manager communicated>
 *
 *   Next step:            <- only when the manager supplied a coaching action
 *   <what was agreed>
 *
 * THE EXPECTATION IS THE MANAGER'S, NOT THE MODEL'S. An expectation invented to
 * fill the section is a fabricated quotation of a conversation, on a document an
 * employee signs. So the section survives only when the manager's own words
 * carry an expectation at all; where they do not, the draft is the observation
 * alone and the manager writes the rest.
 *
 * WHICH FIELDS THIS APPLIES TO IS VERSIONED, NOT HARD-CODED. A field asks for
 * this shape by carrying `narrative: "observed_expectation"` in the stored
 * template version, the same way a field asks to be policy-grounded. There is
 * no `if (templateKey === "coaching")` anywhere in this path, and a version that
 * does not ask for it is drafted exactly as before.
 *
 * WHY A GUARD AND NOT ONLY A PROMPT. The prompt asks; this runs on what comes
 * back. It removes two classes of sentence, and only these two:
 *
 *   SCHEDULING AND FOLLOW-UP, unconditionally. The follow-up date is instance
 *   metadata with its own control — see `follow-up.ts`. A sentence narrating it
 *   into the record duplicates one fact across two authorities, and they
 *   disagree the moment a manager moves the date. This is the same failure
 *   `drafted-text.ts` was written for, arriving without the brackets.
 *
 *   MANUFACTURED SPECIFICS — a date, a dollar amount, a count of prior
 *   occurrences, a disciplinary consequence — that the manager never supplied.
 *   Checked by GROUNDING, not by shape: the specific has to appear in the
 *   manager's own words to survive. "Arrived twenty minutes late" is kept when
 *   the manager said twenty minutes and removed when the model chose the
 *   number, and that distinction is the whole point. A guard that stripped
 *   every number would delete the facts the record exists to hold.
 */

/** The section labels, in the order they are printed. */
export const OBSERVED_LABEL = "Observed:";
export const EXPECTATION_LABEL = "Expectation:";
export const NEXT_STEP_LABEL = "Next step:";

/** The value `FormField.narrative` carries to ask for this shape. */
export const OBSERVED_EXPECTATION = "observed_expectation";

/**
 * Scheduling and follow-up talk, removed whatever the manager said.
 *
 * Deliberately phrase-based rather than keyword-based. A bare `schedule` would
 * match "arrived late for her scheduled shift" — the observation itself, and
 * the one sentence that must always survive.
 */
const SCHEDULING = [
  /\bfollow[-\s]?ups?\b/i,
  /\bcheck(?:ing|ed)?\s+(?:in|back)\b/i,
  /\b(?:i|we|they)(?:'ll| will| am going to| are going to)\s+(?:meet|review|revisit|reassess|re-?evaluate|reconvene|touch base|circle back|speak again|follow)\b/i,
  /\b(?:revisit|reconvene|circle back|touch base|reassess)\b/i,
  /\bin\s+(?:a|one|two|three|four|five|six|seven|\d+)\s+(?:day|days|week|weeks|month|months)\b/i,
  /\bnext\s+(?:week|month|shift|review|check)\b/i,
  /\b(?:thirty|sixty|ninety|30|60|90)[-\s]days?\b/i,
];

/**
 * Specifics that must be grounded in the manager's words to survive.
 *
 * Each entry matches the SPECIFIC ITSELF, not the sentence around it, because
 * the matched text is what gets looked for in the manager's notes.
 */
const GROUNDED_SPECIFICS = [
  // Calendar dates, in the shapes a model reaches for.
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?\b/gi,
  /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi,
  // Money.
  /\$\s?\d[\d,]*(?:\.\d{2})?/g,
  // A count of prior occurrences — "her third tardy", "two prior incidents".
  /\b(?:first|second|third|fourth|fifth|\d+)\s+(?:prior\s+|previous\s+)?(?:occurrences?|occasions?|offen[cs]es?|incidents?|infractions?|violations?|warnings?|tardies|tardy|late\s+arrivals?|absences?|no[-\s]shows?)\b/gi,
  // Disciplinary consequences.
  /\b(?:terminat(?:e|ed|ion)|fired|dismissal|suspend(?:ed|sion)?|final\s+written\s+warning|final\s+warning|written\s+warning|verbal\s+warning|disciplinary\s+action|corrective\s+action|probation|write[-\s]up)\b/gi,
];

/**
 * Language that shows the manager communicated an expectation.
 *
 * Read against the MANAGER'S notes, never against the model's output. Broad on
 * purpose: it decides whether an Expectation section is allowed to exist at
 * all, so a false negative deletes a legitimate section. What it must not
 * accept is a bare observation — "Sarah was late today" carries none of these.
 */
const EXPECTATION_CUE =
  /\b(?:expect\w*|should\w*|must|need(?:s|ed)?\s+to|ought\s+to|has\s+to|have\s+to|required?|requirement|reminded?|remind|told|asked|instructed|directed|discussed|explained|agreed|committed|going\s+forward|from\s+now\s+on|in\s+future|standard|policy|make\s+sure|ensure|supposed\s+to)\b/i;

/** Sentence-ish spans, kept with their trailing punctuation. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/);
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

/** True when the manager's own words carry an expectation of any kind. */
export function hasExpectationCue(source: string): boolean {
  return EXPECTATION_CUE.test(source);
}

/** True when a sentence talks about following up, checking in, or scheduling. */
export function isSchedulingSentence(sentence: string): boolean {
  return SCHEDULING.some((pattern) => pattern.test(sentence));
}

/**
 * The specifics in a sentence that the manager never supplied.
 *
 * Returns the offending fragments so a caller can say what it removed and why,
 * rather than silently shortening an HR record.
 */
export function ungroundedSpecifics(sentence: string, source: string): string[] {
  const haystack = normalise(source);
  const missing: string[] = [];

  for (const pattern of GROUNDED_SPECIFICS) {
    pattern.lastIndex = 0;
    for (const match of sentence.matchAll(pattern)) {
      const fragment = match[0];
      if (!haystack.includes(normalise(fragment))) missing.push(fragment);
    }
  }

  return missing;
}

interface Section {
  label: string;
  lines: string[];
}

const LABELS = [OBSERVED_LABEL, EXPECTATION_LABEL, NEXT_STEP_LABEL];

/** Matches a label at the start of a line, however the model cased it. */
function labelOf(line: string): string | null {
  const trimmed = line.trim();
  for (const label of LABELS) {
    if (trimmed.toLowerCase().startsWith(label.toLowerCase())) return label;
  }
  return null;
}

/**
 * Splits drafted text into its labelled sections.
 *
 * Text with no labels at all comes back as a single unlabelled section, so the
 * sentence guards below still run on a draft that ignored the format.
 */
function splitSections(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { label: "", lines: [] };

  for (const line of text.split("\n")) {
    const label = labelOf(line);
    if (label) {
      if (current.label || current.lines.some((entry) => entry.trim() !== "")) {
        sections.push(current);
      }
      const remainder = line.trim().slice(label.length).trim();
      current = { label, lines: remainder ? [remainder] : [] };
      continue;
    }
    current.lines.push(line);
  }
  sections.push(current);

  return sections.filter(
    (section) => section.label !== "" || section.lines.some((entry) => entry.trim() !== ""),
  );
}

export interface NarrativeGuardResult {
  text: string;
  /** Fragments removed, for the response the manager sees. */
  removed: string[];
}

/**
 * Applies the guards to one drafted narrative.
 *
 * Sections are rebuilt rather than patched in place: a section whose body does
 * not survive loses its label too, because a heading with nothing under it
 * reads on the printed page as a section the manager forgot to fill in.
 */
export function guardNarrative(text: string, source: string): NarrativeGuardResult {
  const removed: string[] = [];
  const expectationAllowed = hasExpectationCue(source);
  const kept: Section[] = [];

  for (const section of splitSections(text)) {
    if (section.label === EXPECTATION_LABEL && !expectationAllowed) {
      removed.push(EXPECTATION_LABEL);
      continue;
    }

    const lines: string[] = [];
    for (const line of section.lines) {
      if (line.trim() === "") {
        lines.push("");
        continue;
      }
      const survivors = sentences(line).filter((sentence) => {
        if (isSchedulingSentence(sentence)) {
          removed.push(sentence.trim());
          return false;
        }
        const missing = ungroundedSpecifics(sentence, source);
        if (missing.length > 0) {
          removed.push(sentence.trim());
          return false;
        }
        return true;
      });
      const rebuilt = survivors.join(" ").trim();
      if (rebuilt) lines.push(rebuilt);
    }

    const body = lines.join("\n").trim();
    if (body === "") {
      if (section.label) removed.push(section.label);
      continue;
    }
    kept.push({ label: section.label, lines: body.split("\n") });
  }

  const text_ = kept
    .map((section) => (section.label ? `${section.label}\n${section.lines.join("\n")}` : section.lines.join("\n")))
    .join("\n\n")
    .trim();

  return { text: text_, removed };
}

export interface NarrativeField {
  key: string;
  narrative?: string;
}

export interface NarrativeDraftResult {
  values: Record<string, string>;
  /** Fields the guard rewrote. */
  adjusted: string[];
  /** Fields the guard emptied entirely. */
  emptied: string[];
}

/**
 * Applies the guard across a drafted value set.
 *
 * Only fields the STORED VERSION marks as narrative are touched. Everything
 * else passes through byte for byte, so adding this cannot change how any
 * other template drafts.
 */
export function guardNarrativeDraft(
  values: Record<string, string>,
  fields: readonly NarrativeField[],
  source: string,
): NarrativeDraftResult {
  const narrative = new Set(
    fields.filter((field) => field.narrative === OBSERVED_EXPECTATION).map((field) => field.key),
  );

  const next: Record<string, string> = {};
  const adjusted: string[] = [];
  const emptied: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    if (!narrative.has(key) || typeof value !== "string" || value.trim() === "") {
      next[key] = value;
      continue;
    }
    const guarded = guardNarrative(value, source);
    if (guarded.text === value) {
      next[key] = value;
      continue;
    }
    adjusted.push(key);
    if (guarded.text === "") {
      emptied.push(key);
      continue;
    }
    next[key] = guarded.text;
  }

  return { values: next, adjusted, emptied };
}
