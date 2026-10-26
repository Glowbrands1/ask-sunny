import { priorSentenceFixEnabled } from "@/lib/config/chat-quality-flags";

import {
  datesInText,
  listFormDates,
  managerDatesForDraft,
  priorStepDateOffsets,
  priorSteps,
  type DateInText,
} from "./form-date-answer";

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
export function formDateBrief(resolved: ResolvedFormDate, givenDates: readonly string[] = []): string {
  /*
   * ==========================================================================
   * THE FORM'S DATE IS NOT ALWAYS THE INCIDENT'S
   * ==========================================================================
   *
   * District Manager feedback, 21 Oct 2026: "… standards of conduct policy
   * on 10-20-26. <employee> failed to acknowledge policies in woven by the
   * 10-15-26 deadline." — the form is dated October 20, and this line told
   * the model that date was the incident's and the only one to use, so the
   * deadline could only be written as the form's date or not at all. Where
   * the manager gave a date that is not the form's, the model is given the
   * manager's dates and told the form's date is not necessarily the
   * incident's. On a form dated by a "today" with no other date, nothing
   * changes.
   */
  const others = [...new Set(givenDates)].filter((iso) => iso !== resolved.iso).map(resolveFormDate);
  const given = others.filter((date): date is ResolvedFormDate => date !== null);
  if (given.length === 0) {
    return `FORM DATE: ${resolved.long} (${resolved.weekday}). This is the date of the incident and of this form. Where a date belongs in your text, use exactly "${resolved.long}" and no other date.`;
  }
  const listed = [...(givenDates.includes(resolved.iso) ? [resolved] : []), ...given]
    .map((date) => `"${date.long}"`)
    .join(", ");
  return `FORM DATE: ${resolved.long} (${resolved.weekday}). This is the date the form is dated, not necessarily the date of the incident. The dates the manager gave are ${listed}: write each one only for what the manager said happened on it (or was due on it), exactly as listed, and state each date once. Never write the form date in place of a date the manager gave, and use no other date.`;
}

/**
 * Every spelling of every calendar date in the manager's notes — "10-20-26"
 * is also "October 20, 2026" and "10/20". So a draft that writes the date
 * the manager gave in the form's own style is not taken for an invented one.
 */
function noteDateSpellings(notes: string, year: string): string[] {
  // PRIOR_SENTENCE_FIX_ENABLED: "10-15" and "i coached her on 10-16" are dates the manager gave too.
  return managerDatesForDraft(notes, `${year}-01-01`).flatMap((found) => resolveFormDate(found.iso)?.spellings ?? []);
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
  return `${notes}\n${[...resolved.spellings, ...noteDateSpellings(notes, resolved.iso.slice(0, 4))].join(" ")}`;
}

/** The manager naming the day itself, so the form's date — resolved from it — is theirs. */
const SAID_THE_DAY = /\b(?:today|tonight|this (?:morning|afternoon|evening))\b/i;

const NOT_CONTEXT = new Set([
  "the", "and", "for", "was", "were", "has", "had", "her", "his", "their", "she", "him", "they", "that",
  "this", "with", "from", "into", "onto", "not", "did", "does", ...MONTHS.map((month) => month.toLowerCase()),
]);

/**
 * The words just before and after a date — what a sentence and the manager's
 * notes can share when they mean the same date ("by the … deadline").
 */
function neighbourWords(text: string, start: number, end: number): Set<string> {
  const words = (part: string) => part.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  const before = words(text.slice(Math.max(0, start - 40), start)).slice(-4);
  const after = words(text.slice(end, end + 40)).slice(0, 4);
  return new Set([...before, ...after].filter((word) => !NOT_CONTEXT.has(word)));
}

/**
 * A day stated twice in one sentence is stated once — but only where the later
 * mention is a trailing "on <day>", so nothing is left hanging: "On October
 * 20, 2026, Marlo did not follow the attendance policy on October 20, 2026."
 * keeps the first. "…finish the training by October 20, 2026" and "from …
 * to …" are left exactly as written (review, 22 Oct 2026).
 */
function withEachDayOnce(sentence: string, isoOf: (token: string) => string | null): string {
  DATE_TOKEN.lastIndex = 0;
  const seen = new Set<string>();
  const repeats: { start: number; end: number }[] = [];
  for (const found of sentence.matchAll(DATE_TOKEN)) {
    const day = isoOf(found[0]) ?? found[0].toLowerCase();
    if (seen.has(day)) repeats.push({ start: found.index!, end: found.index! + found[0].length });
    else seen.add(day);
  }
  let out = sentence;
  for (const { start, end } of repeats.reverse()) {
    const before = out.slice(0, start);
    const lead = /\s+on\s+$/i.exec(before);
    if (!lead || !/^\s*[.!?]?\s*$/.test(out.slice(end))) continue;
    out = before.slice(0, before.length - lead[0].length) + out.slice(end);
  }
  return out;
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
  today?: string,
): FormDateCorrection {
  if (!resolved) return { values, corrected: [] };

  const supplied = notes.toLowerCase();
  /*
   * A DATE THE MANAGER GAVE, IN ANY SPELLING. "by the 10-15-26 deadline" drafted
   * as "by the October 15, 2026 deadline" is their date, and was being
   * rewritten to the form's (District Manager feedback, 21 Oct 2026).
   */
  const year = resolved.iso.slice(0, 4);
  // PRIOR_SENTENCE_FIX_ENABLED: with the yearless "10-5", "10-15" and the coaching's "10-16" (QA, 26 Oct 2026).
  const sentenceFix = priorSentenceFixEnabled();
  const noted = sentenceFix ? managerDatesForDraft(notes, `${year}-01-01`) : datesInText(notes, `${year}-01-01`);
  const given = new Set(noted.map((found) => found.iso));
  const isoOf = (token: string) => datesInText(token, `${year}-01-01`)[0]?.iso ?? null;
  const isSupplied = (token: string) =>
    supplied.includes(token.toLowerCase()) ||
    datesInText(token, `${year}-01-01`).some((found) => given.has(found.iso));
  /*
   * THE FORM'S DATE IS ONLY THE MANAGER'S WHEN THEY GAVE IT. A form whose
   * date was left at the day it was created — the manager gave other dates
   * and chose none — does not make that day theirs. QA, 22 Oct 2026: "by
   * the 10-15-26 deadline" drafted as "by the October 21, 2026 deadline"
   * was kept, because October 21 was the form's date.
   */
  /*
   * Only the dates of WHAT HAPPENED count here — never an earlier step's
   * ("got a verbal warning on 10-01-26"): review, 22 Oct 2026, where the
   * prior warning's date was put on the incident.
   */
  const incidentAt = sentenceFix
    ? draftIncidentOffsets(notes, noted, today ?? `${year}-12-31`)
    : new Set(listFormDates(notes, `${year}-01-01`).map((found) => found.index));
  const incidents = noted.filter((found) => incidentAt.has(found.index));
  const incidentDays = new Set(incidents.map((found) => found.iso));
  const formDateIsTheManagers =
    incidentDays.size === 0 || incidentDays.has(resolved.iso) || SAID_THE_DAY.test(notes);
  const meansThisDay = (token: string) =>
    formDateIsTheManagers &&
    resolved.spellings.some((spelling) => spelling.toLowerCase() === token.toLowerCase());
  /*
   * WHICH OF THE MANAGER'S DATES A WRONG ONE STANDS FOR. Where the form's
   * date is not theirs, putting it in place of a wrong date is the very
   * mistake being corrected. The manager's date whose neighbouring words the
   * sentence shares — "deadline", "woven" — is the one meant; with no such
   * date, the only incident date they gave; failing both, the form's.
   */
  const replacementFor = (sentence: string, token: string): string => {
    if (formDateIsTheManagers) return resolved.long;
    const around = neighbourWords(sentence, sentence.indexOf(token), sentence.indexOf(token) + token.length);
    const scored = incidents.map((found) => ({
      iso: found.iso,
      score: [...neighbourWords(notes, found.index, found.end)].filter((word) => around.has(word)).length,
    }));
    const best = Math.max(0, ...scored.map((entry) => entry.score));
    const winners = new Set(scored.filter((entry) => entry.score === best).map((entry) => entry.iso));
    if (best > 0 && winners.size === 1) return resolveFormDate([...winners][0]!)?.long ?? resolved.long;
    if (incidentDays.size === 1) return resolveFormDate([...incidentDays][0]!)?.long ?? resolved.long;
    return resolved.long;
  };

  const steps = sentenceFix ? priorSteps(notes, today ?? `${year}-12-31`) : [];
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
            // The same invented day written twice is one slip, written twice.
            const wrongDays = new Set(wrong.map((token) => isoOf(token) ?? token));
            let next = sentence;
            if (wrongDays.size === 1) {
              const replacement = replacementFor(sentence, wrong[0]!);
              for (const token of new Set(wrong)) next = next.split(token).join(replacement);
            }

            if (sentenceFix) next = withStepDateAsGiven(next, steps, isoOf);
            next = withEachDayOnce(next, isoOf);
            if (next !== sentence) changed = true;
            return next;
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

/**
 * The manager's incident dates the draft prompt lists (`formDateBrief`):
 * `listFormDates`, and with PRIOR_SENTENCE_FIX_ENABLED each yearless "10-15"
 * that is no earlier step's too, so the model is not told to use only the
 * form's date for both latenesses.
 */
export function draftBriefDates(notes: string, today: string): string[] {
  if (!priorSentenceFixEnabled()) return listFormDates(notes, today).map((found) => found.iso);
  const noted = managerDatesForDraft(notes, today);
  const incident = draftIncidentOffsets(notes, noted, today);
  return noted.filter((found) => incident.has(found.index)).map((found) => found.iso);
}

/**
 * PRIOR_SENTENCE_FIX_ENABLED: the offsets of the manager's incident dates —
 * `listFormDates`, and each yearless date that is no earlier step's.
 */
function draftIncidentOffsets(notes: string, noted: readonly DateInText[], today: string): Set<number> {
  const year = today.slice(0, 4);
  const formDates = new Set(listFormDates(notes, `${year}-01-01`).map((found) => found.index));
  const read = new Set(datesInText(notes, `${year}-01-01`).map((found) => found.index));
  const steps = new Set(priorStepDateOffsets(notes, today, notes));
  return new Set(noted.filter((found) => formDates.has(found.index) || (!read.has(found.index) && !steps.has(found.index))).map((found) => found.index));
}

/*
 * ============================================================================
 * PRIOR_SENTENCE_FIX_ENABLED — A STEP'S DATE IS THE ONE THE MANAGER GAVE IT
 * ============================================================================
 *
 * QA, 26 Oct 2026 (a saved Ask Sunny production draft): "…she was late on
 * 10-5 and 10-15. i coached her on 10-16 about being late" was filed as
 * "…was coached about being late on October 5, 2026" — a date the manager
 * gave for the lateness, put on the coaching. A sentence that names a step
 * (coached, counseled, warned, a written or verbal warning) with one date
 * after the step word, where that date is no step's, takes the date of the
 * one step of that kind the manager dated. With no such step, or more than
 * one date among them, the sentence is left as written; no date is invented.
 */
const STEP_WORD = /\b(?:coach(?:ed|ing)?|counsel(?:ed|led|ing)?|warn(?:ed|ing)|written\s+up|write[- ]?up|(?:verbal|written)\s+(?:warning|corrective|ca)\b)/i;
const COACHING_KIND = /\b(?:coach|counsel)/i;

function withStepDateAsGiven(
  sentence: string,
  steps: readonly { iso: string; named: string }[],
  isoOf: (token: string) => string | null,
): string {
  if (steps.length === 0) return sentence;
  const step = STEP_WORD.exec(sentence);
  if (!step) return sentence;
  DATE_TOKEN.lastIndex = 0;
  const tokens = [...sentence.matchAll(DATE_TOKEN)];
  if (tokens.length !== 1 || tokens[0]!.index! < step.index) return sentence;
  const token = tokens[0]![0];
  const iso = isoOf(token);
  if (!iso || steps.some((found) => found.iso === iso)) return sentence;
  const coaching = COACHING_KIND.test(step[0]);
  const kind = steps.filter((found) => COACHING_KIND.test(found.named) === coaching);
  const days = new Set(kind.map((found) => found.iso));
  if (days.size !== 1) return sentence;
  const given = resolveFormDate([...days][0]!);
  return given ? sentence.split(token).join(given.long) : sentence;
}

/**
 * Every mention of one calendar day, in any spelling, moved to another —
 * written the way a drafted form writes a date ("October 19, 2026"). For a
 * form's date corrected in chat: the paragraph Ask Sunny drafted moves with
 * it (QA audit, 22 Oct 2026). Returns the text unchanged when it never named
 * that day.
 */
export function withDateMoved(text: string, fromIso: string, toIso: string): string {
  const to = resolveFormDate(toIso);
  if (!to || fromIso === toIso) return text;
  const year = fromIso.slice(0, 4);
  DATE_TOKEN.lastIndex = 0;
  return text.replace(DATE_TOKEN, (token) =>
    datesInText(token, `${year}-01-01`)[0]?.iso === fromIso ? to.long : token,
  );
}
