/**
 * ============================================================================
 * THE FORM ALREADY KNOWS WHAT DAY IT IS. THE MODEL SHOULD NOT BE GUESSING.
 * ============================================================================
 *
 * QA replayed a model output that opened the observation with an invented
 * calendar date:
 *
 *   "Observed: On September 10, 2026, Sarah Test was observed wearing a mini
 *    skirt at the Kearny salon location…"
 *
 * The manager had said "3. today". The narrative guard, correctly, treats a
 * date the manager never gave as an ungrounded specific — and, correctly for
 * the rule it enforces, removes the SENTENCE carrying it. The result was a
 * Corrective Action Form with no Observation of Offense at all: the one fact
 * the manager actually supplied, deleted because the model formatted the date
 * it was never given.
 *
 * Both halves of that are right in isolation and wrong together. This module
 * is the missing piece between them.
 *
 * ============================================================================
 * THE DATE IS A STRUCTURED FIELD, NOT SOMETHING TO INFER FROM PROSE
 * ============================================================================
 *
 * `form_instances.form_date` is set when the record is created and defaults to
 * today. When a manager answers the intake's third question with "today", THAT
 * is what "today" resolved to — server-side, once, at creation, from the
 * application's own clock. It is the authoritative answer to "when did this
 * happen", and it is sitting on the row the whole time the model is drafting.
 *
 * So three things follow, and this module supplies all three:
 *
 *   1. THE MODEL IS TOLD THE DATE, rather than left to invent one. Most of the
 *      problem disappears here: a model given the date uses it.
 *
 *   2. THE DATE COUNTS AS GROUNDED. `ungroundedSpecifics` checks a specific
 *      against the manager's notes, and the notes say "today" — so every
 *      spelling of the resolved date is added to what the guard treats as
 *      supplied. A correctly-written date can then never cost the sentence.
 *
 *   3. A WRONG DATE IS CORRECTED, NOT CARRIED AND NOT FATAL. If the model
 *      writes some other date anyway, it is replaced by the form's own — so
 *      the invented value never reaches the record, and the fact around it
 *      survives. That is the recovery: the sentence's facts are the model's
 *      grounded words, and the date comes from the authoritative field.
 *
 * ============================================================================
 * WHY REPLACING BEATS DELETING, HERE AND ONLY HERE
 * ============================================================================
 *
 * Everywhere else in this area the answer to an unsupported value is to remove
 * it, because there is nothing true to put in its place. A date is the
 * exception: there IS a correct value, the application owns it, and it is not
 * in dispute. Substituting it is not a guess.
 *
 * ONE SUBSTITUTION PER SENTENCE. A sentence naming two dates the manager never
 * gave — "late on Monday and again on Wednesday" — is not a formatting slip,
 * it is an account of events nobody described, and rewriting both to the same
 * day would produce nonsense. Those are left alone for the narrative guard to
 * remove, which is the right outcome.
 */

/** Date shapes a model writes. Kept in step with `narrative-draft`'s. */
const DATE_TOKEN =
  /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

export interface ResolvedFormDate {
  /** The stored `YYYY-MM-DD`. */
  readonly iso: string;
  /** How the observation should read it: "September 10, 2026". */
  readonly long: string;
  /** The weekday, for the prompt only. */
  readonly weekday: string;
  /** Every spelling that means this day, for the grounding check. */
  readonly spellings: readonly string[];
}

/**
 * The form's own date, in every shape a model or a guard might meet it.
 *
 * PARSED AS CALENDAR PARTS, never through `new Date(iso)`, which reads a bare
 * `YYYY-MM-DD` as UTC midnight and can name the previous day for anybody west
 * of Greenwich. A form dated the 10th must not print as the 9th because the
 * server is in Kentucky.
 */
export function resolveFormDate(iso: string): ResolvedFormDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").trim());
  if (!match) return null;

  const [, year, month, day] = match;
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;

  const monthName = MONTHS[monthIndex]!;
  const dayNumber = String(Number(day));
  const weekday = DAYS[new Date(Date.UTC(Number(year), monthIndex, Number(day))).getUTCDay()]!;

  return {
    iso: match[0],
    long: `${monthName} ${dayNumber}, ${year}`,
    weekday,
    spellings: [
      match[0],
      `${monthName} ${dayNumber}, ${year}`,
      `${monthName} ${dayNumber}`,
      `${Number(month)}/${dayNumber}/${year}`,
      `${Number(month)}/${dayNumber}`,
      `${month}/${day}/${year}`,
      weekday,
    ],
  };
}

/**
 * The line the model is given, so it stops inventing one.
 *
 * It says what the date IS and forbids any other, which is the cheapest of the
 * three fixes and the one that prevents rather than repairs.
 */
export function formDateBrief(resolved: ResolvedFormDate): string {
  return `FORM DATE: ${resolved.long} (${resolved.weekday}). This is the date of the incident and of this form. Where a date belongs in your text, use exactly "${resolved.long}" and no other date.`;
}

/**
 * The manager's notes, plus the resolved date, as ONE grounding source.
 *
 * `ungroundedSpecifics` asks whether a specific appears in the source. The
 * manager wrote "today"; the application resolved it. Both are the same fact,
 * so both belong in what the guard treats as supplied.
 */
export function groundedSourceWithFormDate(
  notes: string,
  resolved: ResolvedFormDate | null,
): string {
  if (!resolved) return notes;
  return `${notes}\n${resolved.spellings.join(" ")}`;
}

export interface FormDateCorrection {
  values: Record<string, string>;
  /** Field keys whose date was rewritten to the form's own. */
  corrected: string[];
}

/**
 * Rewrites a date the manager never gave to the form's own resolved date.
 *
 * Runs BEFORE the narrative guard, so what that guard then sees is a grounded
 * date and a sentence it can keep. Only the fields named in `keys` are touched
 * — the caller passes the narrative ones — and a date the manager DID write is
 * left exactly as they wrote it.
 */
export function correctDraftedDates(
  values: Record<string, string>,
  keys: ReadonlySet<string>,
  notes: string,
  resolved: ResolvedFormDate | null,
): FormDateCorrection {
  if (!resolved) return { values, corrected: [] };

  const supplied = notes.toLowerCase();
  const isSupplied = (token: string) => supplied.includes(token.toLowerCase());
  const meansThisDay = (token: string) =>
    resolved.spellings.some((spelling) => spelling.toLowerCase() === token.toLowerCase());

  const next: Record<string, string> = {};
  const corrected: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    if (!keys.has(key) || typeof value !== "string" || value.trim() === "") {
      next[key] = value;
      continue;
    }

    let changed = false;
    /*
     * LINE BY LINE, THEN SENTENCE BY SENTENCE. The narrative fields are
     * written as labelled sections separated by blank lines, and a sentence
     * split that rejoined with a space would collapse "Observed:" and
     * "Expectation:" into one paragraph — destroying the very shape the
     * concurrent narrative work put there.
     */
    const rebuilt = value
      .split("\n")
      .map((line) =>
        line
          .split(/(?<=[.!?])\s+/)
          .map((sentence) => {
            DATE_TOKEN.lastIndex = 0;
            const wrong = [...sentence.matchAll(DATE_TOKEN)]
              .map((found) => found[0])
              .filter((token) => !isSupplied(token) && !meansThisDay(token));

            // Two invented dates is an account of events nobody described,
            // not a formatting slip. Left for the narrative guard to remove.
            if (wrong.length !== 1) return sentence;

            changed = true;
            return sentence.replace(wrong[0]!, resolved.long);
          })
          .join(" "),
      )
      .join("\n");

    if (!changed) {
      next[key] = value;
      continue;
    }
    next[key] = rebuilt;
    corrected.push(key);
  }

  return { values: next, corrected };
}
