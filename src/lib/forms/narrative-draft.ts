/**
 * ============================================================================
 * WHAT HAPPENED, WHAT IS EXPECTED, AND WHAT GOOD LOOKS LIKE NEXT TIME
 * ============================================================================
 *
 * A coaching record that says only
 *
 *   "Sarah arrived late for her scheduled shift today."
 *
 * is an incident report, not coaching. It does not say what the standard is, so
 * it cannot show the employee was told what to do differently — which is the
 * part that makes the form worth signing. The drafted narrative is therefore
 * written in three labelled sections:
 *
 *   Observed:
 *   <what happened — the manager's facts>
 *
 *   Expectation:
 *   <the standard the employee is expected to meet>
 *
 *   Going Forward:
 *   <what the employee should do differently>
 *
 * ============================================================================
 * THE MANAGER SUPPLIES THE INCIDENT. ASK SUNNY SUPPLIES THE COACHING.
 * ============================================================================
 *
 * This is the product decision, and it is the opposite of what an earlier
 * version of this file did. That version required the manager's own words to
 * carry an expectation before it would allow an Expectation section, and
 * dropped the section otherwise. The effect was that "Sarah Test was late
 * today." produced a one-line form and a request for the manager to write the
 * expectation themselves — which is the typing the feature exists to remove.
 *
 * So a neutral, behavioural expectation is INFERRED from the incident.
 * "Employees are expected to arrive on time and be ready to work at the start of
 * their scheduled shift" is not a claim about anybody's words or anybody's
 * policy document; it is ordinary workplace coaching, and writing it is the job.
 *
 * ============================================================================
 * WHICH LEAVES A SHARPER LINE FOR THE GUARD TO HOLD
 * ============================================================================
 *
 * The guard below polices FACTS, never guidance. Guidance is Ask Sunny's to
 * write; a fact is the manager's to supply. So what runs on the model's output
 * is exactly three things, and nothing else:
 *
 *   SCHEDULING AND FOLLOW-UP go unconditionally. The follow-up date is instance
 *   metadata with its own control — see `follow-up.ts`. A sentence narrating it
 *   here duplicates one fact across two authorities, and they disagree the
 *   moment a manager moves the date. "Going Forward" is behaviour, never a
 *   meeting.
 *
 *   MANUFACTURED SPECIFICS — a date, an amount, a count of prior occurrences —
 *   survive only if the manager supplied them. Checked by GROUNDING, not by
 *   shape: "arrived twenty minutes late" is kept when the manager said twenty
 *   minutes and removed when the model chose the number. A guard that stripped
 *   every number would delete the facts the record exists to hold.
 *
 *   CLAIMS OF AUTHORITY the draft does not have — a disciplinary level, a
 *   warning, a suspension, a termination, attendance points, a policy section,
 *   "company policy requires". These are the sentences that turn coaching into
 *   a disciplinary instrument, and they are ungrounded assertions rather than
 *   guidance, so they are held to the same grounding rule.
 *
 * An expectation like "is expected to arrive on time" contains none of those,
 * which is why inference and this guard do not fight: one writes standards, the
 * other refuses facts nobody supplied.
 *
 * WHICH FIELDS THIS APPLIES TO IS VERSIONED, NOT HARD-CODED. A field asks for
 * the shape by carrying `narrative: "observed_expectation"` in the stored
 * template version, the same way a field asks to be policy-grounded. No code in
 * this path names a template key.
 */

/** The section labels, in the order they are printed. */
export const OBSERVED_LABEL = "Observed:";
export const EXPECTATION_LABEL = "Expectation:";
export const GOING_FORWARD_LABEL = "Going Forward:";

/** The value `FormField.narrative` carries to ask for this shape. */
export const OBSERVED_EXPECTATION = "observed_expectation";

/**
 * ============================================================================
 * AND THE PARAGRAPH THAT SAYS WHAT IS BEING DONE ABOUT IT
 * ============================================================================
 *
 * The corrective forms — the Disciplinary Plan of Action and the Policy Review
 * — carry a second drafted paragraph beside the observation: the Action Plan
 * and the Plan of Action. Left with no shape at all, the model wrote the one
 * thing a plan of action must never be:
 *
 *   "Leadership will review the dress code policy with Pauline to ensure full
 *    understanding. Follow-up observations will be conducted regularly, with a
 *    formal review scheduled for [Follow-Up Date] to confirm compliance.
 *    Continued non-compliance will result in further action as outlined in
 *    company policy."
 *
 * Three inventions in three sentences — a review cadence nobody agreed, a date
 * that does not exist, and a consequence quoted from a document nobody
 * retrieved. What the manager wanted in its place reads:
 *
 *   "This is being addressed as a policy review of salon appearance standards.
 *    Jane is expected to arrive for each shift in attire that meets the salon's
 *    dress and appearance standards, and to confirm with a manager beforehand
 *    if she is uncertain whether an item of clothing is appropriate. The
 *    specific dress code language should be reviewed with Jane from the current
 *    applicable company manual, and the manager should confirm she understands
 *    the standard."
 *
 * Same three beats every time: WHAT IS BEING DONE and about what, WHAT THE
 * EMPLOYEE DOES going forward, and — because the policy fields fail closed when
 * retrieval finds no approved match — that the manual's actual language is to
 * be READ WITH the employee rather than recalled into the record.
 *
 * ONE PARAGRAPH, NO LABELS, which is why this shape shares the guard rather
 * than the format. `splitSections` finds no labels and hands the whole thing
 * through as one section, so every sentence still meets the same three
 * refusals: no scheduling, no specific the manager did not supply, no claim of
 * authority the draft does not have. The shape of the prose is the prompt's
 * job; what may be ASSERTED in it is this file's.
 */
export const PLAN_OF_ACTION = "plan_of_action";

/**
 * The shapes a field may ask for, and therefore the fields this guard runs on.
 *
 * A set rather than one comparison, because "which fields are narrative" is now
 * two answers and must not become two lists.
 */
export const NARRATIVE_SHAPES: readonly string[] = [OBSERVED_EXPECTATION, PLAN_OF_ACTION];

/**
 * Scheduling and follow-up talk, removed whatever the manager said.
 *
 * Deliberately phrase-based rather than keyword-based. A bare `schedule` would
 * match "arrived late for her scheduled shift" — the observation itself, and
 * the one sentence that must always survive. "next shift" is likewise absent:
 * "arrive on time for her next shift" is coaching, not a diary entry.
 */
const SCHEDULING = [
  /\bfollow[-\s]?ups?\b/i,
  /\bcheck(?:ing|ed)?\s+(?:in|back)\b/i,
  /\b(?:i|we|they)(?:'ll| will| am going to| are going to)\s+(?:meet|review|revisit|reassess|re-?evaluate|reconvene|touch base|circle back|speak again|follow)\b/i,
  /\b(?:revisit|reconvene|circle back|touch base|reassess)\b/i,
  /\bin\s+(?:a|one|two|three|four|five|six|seven|\d+)\s+(?:day|days|week|weeks|month|months)\b/i,
  /\bnext\s+(?:week|month|review|check)\b/i,
  /\b(?:thirty|sixty|ninety|30|60|90)[-\s]days?\b/i,
];

/**
 * Specifics and claims that must be grounded in the manager's words to survive.
 *
 * Each entry matches the CLAIM ITSELF, not the sentence around it, because the
 * matched text is what gets looked for in the manager's notes.
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
  // Disciplinary consequences and levels.
  /\b(?:terminat(?:e|ed|ion)|fired|dismissal|suspend(?:ed|sion)?|final\s+written\s+warning|final\s+warning|written\s+warning|verbal\s+warning|disciplinary\s+action|corrective\s+action|probation|write[-\s]up|disciplinary\s+step)\b/gi,
  /*
   * CLAIMS THAT A WRITTEN RULE SAYS THIS. An inferred expectation is ordinary
   * coaching; the moment it cites a policy it is asserting the contents of a
   * document nobody retrieved. Note this matches the CITATION, not the word
   * "policy" — "expected to follow the attendance policy" is guidance and stays.
   */
  /\b(?:according\s+to|per|under|in\s+accordance\s+with)\s+(?:the\s+)?(?:company\s+|employee\s+)?(?:polic(?:y|ies)|handbook|manual)\b/gi,
  /\bcompany\s+polic(?:y|ies)\b/gi,
  /\bpolic(?:y|ies)\s+(?:requires?|states?|says?|mandates?|dictates?)\b/gi,
  /\bpolic(?:y|ies)\s+(?:section|number)\s*\S+/gi,
  /\battendance\s+points?\b/gi,
  /\b(?:employee\s+)?handbook\b/gi,
  /\bHR\s+(?:will|must|requires?|has\s+been)\b/gi,
];

/** Sentence-ish spans, kept with their trailing punctuation. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/);
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

/** True when a sentence talks about following up, checking in, or scheduling. */
export function isSchedulingSentence(sentence: string): boolean {
  return SCHEDULING.some((pattern) => pattern.test(sentence));
}

/**
 * The specifics and claims in a sentence that the manager never supplied.
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

/**
 * The labels recognised as section boundaries.
 *
 * "Next step:" is accepted although the prompt asks for "Going Forward:" — a
 * model that reaches for the older wording should still have its sections
 * guarded rather than treated as one undifferentiated paragraph.
 */
const LABELS = [OBSERVED_LABEL, EXPECTATION_LABEL, GOING_FORWARD_LABEL, "Next step:"];

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
 *
 * NOTHING HERE JUDGES WHETHER AN EXPECTATION WAS EARNED. Inferring one is the
 * intended behaviour; only the three classes above are removed, and they are
 * removed wherever they appear.
 */
export function guardNarrative(text: string, source: string): NarrativeGuardResult {
  const removed: string[] = [];
  const kept: Section[] = [];

  for (const section of splitSections(text)) {
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
        if (ungroundedSpecifics(sentence, source).length > 0) {
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

  const guarded = kept
    .map((section) =>
      section.label ? `${section.label}\n${section.lines.join("\n")}` : section.lines.join("\n"),
    )
    .join("\n\n")
    .trim();

  return { text: guarded, removed };
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
 * else passes through byte for byte, so this cannot change how any other
 * template drafts.
 */
export function guardNarrativeDraft(
  values: Record<string, string>,
  fields: readonly NarrativeField[],
  source: string,
): NarrativeDraftResult {
  const narrative = new Set(
    fields
      .filter((field) => field.narrative !== undefined && NARRATIVE_SHAPES.includes(field.narrative))
      .map((field) => field.key),
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
