/**
 * ============================================================================
 * A PLACEHOLDER IS NOT A VALUE
 * ============================================================================
 *
 * QA caught this on a real coaching form. Asked to draft the Details field, the
 * model wrote:
 *
 *   "Follow-Up: I will check in with Sarah on [Follow-Up Date] to review her
 *    attendance and provide support if needed."
 *
 * `[Follow-Up Date]` was then stored as a canonical field value, rendered in
 * the editor, and printed into the PDF. On a signed HR document that is not a
 * cosmetic blemish: it is a sentence that reads as a commitment while naming no
 * date, and nobody proof-reads a field the assistant filled in.
 *
 * THE MODEL IS TOLD NOT TO, AND IS ALSO NOT TRUSTED NOT TO. The prompt says to
 * leave a field empty rather than guess; this is the guard that runs on what
 * comes back, in the same spirit as the responsibility filter. A model
 * instruction is a request, not a boundary.
 *
 * WHY REMOVING THE WHOLE SENTENCE, RATHER THAN THE TOKEN. Deleting just the
 * bracket leaves "I will check in with Sarah on to review her attendance" — a
 * broken sentence that still asserts a commitment. Deleting the sentence leaves
 * a shorter, true paragraph. If nothing survives, the field is left EMPTY for
 * the manager to write, which is the outcome the drafting contract already
 * promises for anything the model cannot support.
 *
 * FOLLOW-UP IS NOT A FIELD ON THE COACHING FORM. It is instance metadata, set
 * through `/api/forms/instances/[id]/follow-up` and shown as a real date
 * control. A model narrating it into Details duplicates one fact across two
 * authorities, and the two then disagree the moment a manager moves the date.
 */

/**
 * Bracketed fill-in tokens: `[Follow-Up Date]`, `[Employee Name]`, `[Salon]`,
 * `[Job Title]`, `{{anything}}`.
 *
 * Deliberately shape-based rather than a list of known tokens — the next one a
 * model invents will not be on any list.
 */
const PLACEHOLDER = /\[[^\]\n]{1,60}\]|\{\{[^}\n]{1,60}\}\}/g;

/** Sentence-ish spans, kept with their trailing punctuation. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/);
}

export function containsPlaceholder(text: string): boolean {
  PLACEHOLDER.lastIndex = 0;
  return PLACEHOLDER.test(text);
}

/**
 * Removes every sentence carrying an unresolved placeholder.
 *
 * Line structure is preserved, because these fields are frequently written as
 * labelled lines ("Observed: …", "Expectation: …") and collapsing them into a
 * paragraph would change how the form reads.
 */
export function stripPlaceholders(text: string): string {
  const kept = text
    .split("\n")
    .map((line) =>
      sentences(line)
        .filter((sentence) => !containsPlaceholder(sentence))
        .join(" ")
        .trim(),
    )
    .filter((line, index, lines) => {
      // Drop lines emptied by the filter, but keep a blank line that was
      // already blank and is separating two surviving paragraphs.
      if (line !== "") return true;
      return index > 0 && index < lines.length - 1 && lines[index - 1] !== "";
    });

  return kept.join("\n").trim();
}

/**
 * Applies the guard across a drafted value set.
 *
 * A field left EMPTY by this is reported so the caller can tell the manager
 * which ones it declined to fill — the same shape the policy guard uses for
 * `withheld`.
 */
export function stripPlaceholdersFromDraft(values: Record<string, string>): {
  values: Record<string, string>;
  cleaned: string[];
  emptied: string[];
} {
  const next: Record<string, string> = {};
  const cleaned: string[] = [];
  const emptied: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== "string" || !containsPlaceholder(value)) {
      next[key] = value;
      continue;
    }
    const stripped = stripPlaceholders(value);
    cleaned.push(key);
    if (stripped === "") {
      emptied.push(key);
      continue;
    }
    next[key] = stripped;
  }

  return { values: next, cleaned, emptied };
}
