import {
  futurePriorRowDropEnabled,
  historyLevelNotThisFormEnabled,
  priorActionsNoSignedEnabled,
  priorActionsParseEnabled,
  priorRowNotOnIncidentDateEnabled,
  priorStepDateListEnabled,
  priorStepPreviouslyEnabled,
  priorStepSentenceEnabled,
} from "@/lib/config/chat-quality-flags";

import { statesFirstOccurrence } from "./corrective-action-intake";
import { historyWarningLevels } from "./warning-level";
import { correctedDates, datesInText, managerDatesForDraft, priorSteps } from "./form-date-answer";
import { incidentDates } from "./incident-dates";
import { priorSentenceFixFor } from "./prior-sentence-scope";
import { OFFICIAL_POLICY_MANUAL } from "./official-policy-manual";

/**
 * ============================================================================
 * "LIST PREVIOUSLY RECEIVED COACHING AND/OR CORRECTIVE ACTION WITH DATE SIGNED"
 * ============================================================================
 *
 * The Corrective Action Form's one line for the employee's history, from
 * revision 5 (HR feedback, 3 Oct 2026). It replaced two single lines —
 * "Previous corrective action for this policy or issue" and "Date of previous
 * corrective action" — which held one step and one date between them.
 *
 * ONE ENTRY PER LINE, each saying what was received and when it was signed:
 *
 *   Coaching — signed 09/02/2026
 *   Verbal warning — signed 09/21/2026
 *
 * THE HISTORY IS THE MANAGER'S, NEVER THE MODEL'S. The whole progression
 * escalates on this line, so a date in it survives only where the manager
 * stated it, and a step the manager dated in their own words is put here by
 * code even if the model left it out — which is the production fix the old
 * date line carried (`priorStepDate`), kept for the list. Pure and
 * browser-safe.
 */

export const PRIOR_ACTIONS_KEY = "prior_actions";
export const PRIOR_ACTIONS_LABEL =
  "List previously received coaching and/or corrective action with date signed";

/** The two revision-4 keys this field replaced. Still read on forms filed against them. */
export const LEGACY_PREVIOUS_ACTION_KEY = "previous_action";
export const LEGACY_PREVIOUS_ACTION_DATE_KEY = "previous_action_date";

/** What the line says when there is no history — a real answer, not a blank. */
export const NO_PRIOR_ACTION = "None — first occurrence";

/** `YYYY-MM-DD` as the business writes a date by hand. */
export function signedDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  return match ? `${match[2]}/${match[3]}/${match[1]}` : iso.trim();
}

/**
 * The kinds of step the list records, most specific first. A verbal, written
 * or final written CA is its own step, and so is a policy acknowledgement —
 * "previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26" lists a
 * verbal corrective action (HR, 21 Oct 2026).
 */
const STEPS: readonly [RegExp, string][] = [
  [/\b(?:verbally\s+(?:warned|coached|counsell?ed)|warned\s+verbally)\b/i, "Verbal warning"],
  [/final\s+written\s+(?:corrective actions?|cas?\b|c\/a)/i, "Final written corrective action"],
  [/written\s+(?:corrective actions?|cas?\b|c\/a)/i, "Written corrective action"],
  [/verbal\s+(?:corrective actions?|cas?\b|c\/a)/i, "Verbal corrective action"],
  [/final\s+written\s+warning/i, "Final written warning"],
  [/written\s+warning/i, "Written warning"],
  [/verbal\s+warning/i, "Verbal warning"],
  // "she's had a verbal before", "got a written in august" — the noun left off (QA, 22 Oct 2026, round 3).
  [/\bfinal\s+written\b/i, "Final written warning"],
  [/\bwritten\b(?!\s+up)/i, "Written warning"],
  [/\bverbal(?:ly)?\b/i, "Verbal warning"],
  [/write[- ]?ups?|written up/i, "Write-up"],
  [/corrective actions?/i, "Corrective action"],
  // "prior CA 9/1": the form's own shorthand.
  [/\b(?:cas?|c\/a)\b/i, "Corrective action"],
  [/coach(?:ed|ing)?/i, "Coaching"],
  [/disciplin\w*/i, "Disciplinary action"],
  [/warn(?:ing|ings|ed)/i, "Warning"],
  [/(?:\bpolicy\s+)?\backnowledge?ments?\b|\backnowledged\b/i, "Policy acknowledgement"],
];

/** The step a manager's words named, as a line on the list begins. */
function stepLabel(named: string): string {
  return namedStep(named)?.label ?? "Coaching or corrective action";
}

/**
 * The step nearest the date in the manager's words, and where it sits: the
 * step nearest the date is the one the date belongs to. Where two end at the
 * same place ("verbal warning" and its "warning"), the more specific, listed
 * first, wins.
 */
function namedStep(named: string): { start: number; end: number; label: string } | null {
  let best: { start: number; end: number; label: string } | null = null;
  for (const [pattern, label] of STEPS) {
    const global = new RegExp(pattern.source, "gi");
    for (const match of named.matchAll(global)) {
      const end = match.index + match[0].length;
      if (!best || end > best.end) best = { start: match.index, end, label };
    }
  }
  return best;
}

/**
 * The first and the last step the manager's words name, by where they sit:
 * the first is the one a sentence opens on, the last the one nearest its end
 * (`namedStep`). Null when no step is named. Read by
 * `ai/prior-coaching-denial.ts` to tell "no prior coaching" from "no prior
 * coaching except a verbal in July".
 */
export function firstAndLastNamedStep(
  named: string,
): { first: { start: number; end: number; label: string }; last: { start: number; end: number; label: string } } | null {
  const last = namedStep(named);
  if (!last) return null;
  let first = last;
  for (const [pattern, label] of STEPS) {
    for (const match of named.matchAll(new RegExp(pattern.source, "gi"))) {
      const end = match.index + match[0].length;
      if (match.index < first.start || (match.index === first.start && end > first.end)) first = { start: match.index, end, label };
    }
  }
  return { first, last };
}

/**
 * What a step was for, as the manager said it beside the step: "coaching for
 * attendance on 9/1" → "for attendance". Nothing when the words after the step
 * are anything else.
 */
function stepDescription(named: string): string {
  const step = namedStep(named);
  if (!step) return "";
  const rest = named
    .slice(step.end)
    .replace(/\s+(?:on|dated|signed|at|back|in|from)\s*$/i, "")
    .replace(/[\s,]+$/, "")
    .trim();
  return /^(?:for|about|regarding|over)\s+\S/i.test(rest) ? rest : "";
}

/**
 * Where a line's date comes from, which says how it reads with
 * PRIOR_ACTIONS_NO_SIGNED_ENABLED: `on_file`, a finalized form in Form
 * Monitoring ("— finalized 09/02/2026"); `said`, a step the manager told
 * ("— 09/02/2026"); `said_signed`, a step the manager said was signed
 * ("— signed 09/02/2026"). Off, every line reads "— signed <date>".
 */
export type PriorLineSource = "on_file" | "said" | "said_signed";

export function priorActionLine(step: string, iso: string, topic = "", description = "", source: PriorLineSource = "said"): string {
  const what = description ? `${step} ${description}` : step;
  const head = topic ? `${what} — ${topic}` : what;
  if (!priorActionsNoSignedEnabled()) return `${head} — signed ${signedDate(iso)}`;
  const mark = source === "on_file" ? "finalized " : source === "said_signed" ? "signed " : "";
  return `${head} — ${mark}${signedDate(iso)}`;
}

/*
 * READING A LINE'S DATE BACK (PRIOR_ACTIONS_NO_SIGNED_ENABLED). The list's
 * parsers (`form-reducer.ts` priorLineKey, `ca-chat-dates.ts`,
 * `chat-correction.ts`) found a line's date after " — signed ". A line now
 * ends "— signed 09/01/2026", "— finalized 09/01/2026" or "— 09/01/2026";
 * these read all three.
 */
const LINE_DATE = /(\s—\s(?:(?:signed|finalized)\s+)?)(\d{2}\/\d{2}\/\d{4})\s*$/i;

/** The MM/DD/YYYY a list line ends with, whatever marks it; "" when it ends with none. */
export function priorLineDate(line: string): string {
  return LINE_DATE.exec(line)?.[2] ?? /\bsigned\s+(\d{2}\/\d{2}\/\d{4})/i.exec(line)?.[1] ?? "";
}

/** The line with its date replaced by `us` (MM/DD/YYYY), its mark ("signed", "finalized" or none) kept. */
export function withPriorLineDate(line: string, us: string): string {
  if (LINE_DATE.test(line)) return line.replace(LINE_DATE, (_match, mark: string) => `${mark}${us}`);
  return line.replace(/signed\s+\d{2}\/\d{2}\/\d{4}/, `signed ${us}`);
}

/**
 * WHAT AN EARLIER STEP WAS ABOUT, as the manager labelled it: "previous
 * coaching was jba policy manual 1-1-26" → "JBA Policy Manual" (District
 * Manager feedback, 21 Oct 2026). Their words, in their order; only a word of
 * the official manual's own name is printed the way the manual spells it, so
 * "jba manual" reads "JBA Manual" on the record. Nothing is added.
 */
const MANUAL_WORDS = new Map(
  OFFICIAL_POLICY_MANUAL.fallbackTitles
    .flatMap((title) => title.split(/\s+/))
    .filter((word) => /^[A-Za-z]+$/.test(word))
    .map((word) => [word.toLowerCase(), word] as const),
);

function stepTopic(topic: string | undefined): string {
  let words = (topic ?? "").trim();
  // "previous coaching: verbal ca 9-1-26": the item names its own step, which the line already opens with.
  const step = namedStep(words);
  if (step) words = `${words.slice(0, step.start)} ${words.slice(step.end)}`.trim();
  return words
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => MANUAL_WORDS.get(word.toLowerCase()) ?? word)
    .join(" ");
}

/**
 * The earlier steps the manager dated in their own words, as lines on the list
 * — what `groundPriorActions` adds when the draft left one out, and what the
 * chat reads back before the form is created.
 */
export function statedPriorActions(notes: string, today: string): string[] {
  const lines = stepsSaid(notes, today).map(managerStepLine);
  return [...lines, ...undatedListSteps(notes, today, lines)];
}

/*
 * PRIOR_STEP_SENTENCE_ENABLED (managers, 26 Oct 2026): "this should be a
 * written and note a verbal ca was given on 9-1-26" and "she was issued a
 * verbal ca on 10.1 for this same thing" listed no Prior actions row. The
 * step reader (`priorSteps`, in the protected `form-date-answer.ts`) reads a
 * labelled list ("previous coaching: verbal ca 9-1-26"), not a step told in
 * a sentence, and its date reader does not read "10.1". With the flag on a
 * sentence that says a step was given, issued, received or signed on a date
 * adds that step; "10.1" is October 1, its year the latest one not after
 * today. Off, `priorSteps` alone.
 */
const STEP_GIVEN =
  /\b(?:was|were|been|got|get|received|had)\s+(?:already\s+|previously\s+|also\s+)?(?:(?:issued|given|signed)\s+)?(?:an?\s+|her\s+|his\s+)?|\b(?:issued|gave|given|signed)\s+(?:her\s+|him\s+|them\s+)?(?:an?\s+)?/gi;
const STEP_THEN_GIVEN = /\b(?:was|were)\s+(?:issued|given|signed)\b/i;
const DOT_DATE = /(?<![$\d.])\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2}|\d{4}))?\b(?![.\d])/g;

function dotDates(sentence: string, today: string): { iso: string; index: number }[] {
  const [year, month, day] = today.split("-").map(Number) as [number, number, number];
  const out: { iso: string; index: number }[] = [];
  for (const match of sentence.matchAll(DOT_DATE)) {
    const m = Number(match[1]);
    const d = Number(match[2]);
    if (m < 1 || m > 12 || d < 1 || d > 31) continue;
    let y = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : year;
    if (!match[3] && (m > month || (m === month && d > day))) y -= 1;
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (iso > today) continue;
    out.push({ iso, index: match.index });
  }
  return out;
}

/*
 * PRIOR_STEP_PREVIOUSLY_ENABLED (A2, one of Pau's 7; QA 6 Nov 2026): "in the previously recieved coaching include
 * that <name> signed the jba policy manual on 10-15-26" listed no Prior actions row: "recieved" (as typed) is not
 * a given-verb, so the sentence named no earlier step. With the flag on, a step that "previous(ly) / prior /
 * earlier" leads, with at most one word between, is an earlier step; a manual named after it is the line's topic,
 * and "signed" there marks the date signed. Off, as before.
 */
const EARLIER_STEP_LEAD = /\b(?:previous(?:ly)?|prior|earlier)\s+(?:[a-z]+\s+)?$/i;
const MANUAL_NAMED = /\b(?:jba\s+)?(?:policy\s+)?manual\b/i;

function sentenceSteps(notes: string, today: string): { iso: string; named: string; topic?: string }[] {
  const steps: { iso: string; named: string; topic?: string }[] = [];
  for (const sentence of (notes ?? "").split(/(?<=[!?\n])|(?<=\.)(?!\d)/)) {
    const step = namedStep(sentence);
    if (!step) continue;
    const before = sentence.slice(0, step.start);
    const after = sentence.slice(step.end);
    const earlier = priorStepPreviouslyEnabled() && EARLIER_STEP_LEAD.test(before);
    const given = [...before.matchAll(STEP_GIVEN)].some((match) => match.index + match[0].length >= step.start - 1) || STEP_THEN_GIVEN.test(after.slice(0, 20)) || earlier;
    if (!given) continue;
    const dates = [...datesInText(after, today), ...dotDates(after, today)];
    const first = dates.filter((found) => found.iso <= today).sort((a, b) => a.index - b.index)[0];
    if (!first) continue;
    const manual = earlier ? MANUAL_NAMED.exec(after.slice(0, first.index)) : null;
    const signed = earlier && /\bsign(?:ed)?\b/i.test(after.slice(0, first.index));
    const topic = manual ? `${manual[0]}${signed ? " signed" : ""}` : undefined;
    steps.push({ iso: first.iso, named: sentence.slice(step.start, step.end), ...(topic ? { topic } : {}) });
  }
  return steps;
}

/** The steps the manager dated: `priorSteps`, and with PRIOR_STEP_SENTENCE_ENABLED a step told in a sentence. */
function stepsSaid(notes: string, today: string): { iso: string; named: string; topic?: string; about?: string }[] {
  const steps = priorSteps(notes, today);
  const have = new Set(steps.map((step) => step.iso));
  const sentences = priorStepSentenceEnabled() ? [...steps, ...sentenceSteps(notes, today).filter((step) => !have.has(step.iso) && have.add(step.iso))] : steps;
  /*
   * HISTORY_LEVEL_NOT_THIS_FORM_ENABLED (F2, QA 14 Nov 2026): "verbal warning on 9/21. late again … today" — the level on
   * file by its own date goes under Prior actions with that date, as "she had a verbal on 10/30" already does.
   */
  const told = historyLevelNotThisFormEnabled()
    ? [...sentences, ...historyWarningLevels(notes, today).filter((step) => step.iso && !have.has(step.iso) && have.add(step.iso))]
    : sentences;
  // PRIOR_STEP_DATE_LIST_ENABLED: "coaching on 9/8/2026, 9/15/2026 and 9/25/2026" is a row per date.
  if (!priorStepDateListEnabled()) return told;
  return [...told, ...dateListSteps(notes, today).dated.filter((step) => !have.has(step.iso) && have.add(step.iso))];
}

/*
 * PRIOR_STEP_DATE_LIST_ENABLED (QA round 5, 8 Nov 2026): "she already received a verbal warning and coaching on
 * 9/8/2026, 9/15/2026 and 9/25/2026" listed only "Coaching — 09/08/2026": the step readers take the first date after a
 * step, and the verbal warning named before it took none. With the flag on, a step a given-verb leads (with other steps
 * joined by "and" or commas between) is a row for each date of the list after it ("9/8, 9/15 and 9/25"), and each step
 * named before it is listed with no date: the manager tied none to it. Off, as before.
 */
const LIST_GLUE = /^\s*(?:,\s*(?:and\s+|&\s*)?|and\s+|&\s*)$/i;
const STEP_JOIN = /^\s*(?:,\s*)?(?:and|&|,)\s*(?:an?\s+)?$/i;

function dateListSteps(notes: string, today: string): { dated: { iso: string; named: string }[]; undated: string[] } {
  const dated: { iso: string; named: string }[] = [];
  const undated: string[] = [];
  for (const sentence of (notes ?? "").split(/(?<=[!?\n])|(?<=\.)(?!\d)/)) {
    const step = namedStep(sentence);
    if (!step) continue;
    // The dates right after the step, as one list: "on 9/8/2026, 9/15/2026 and 9/25/2026".
    const after = sentence.slice(step.end);
    const found = datesInText(after, today).sort((a, b) => a.index - b.index);
    if (found.length < 2 || !/^\s*(?:on\s+)?$/i.test(after.slice(0, found[0]!.index))) continue;
    const list = [found[0]!];
    for (const next of found.slice(1)) {
      if (!LIST_GLUE.test(after.slice(list[list.length - 1]!.end, next.index))) break;
      list.push(next);
    }
    if (list.length < 2) continue;
    // A given-verb before the step, with only other steps joined by "and" between: "received a verbal warning and coaching".
    const before = sentence.slice(0, step.start);
    const given = [...before.matchAll(STEP_GIVEN)].pop();
    if (!given) continue;
    const between = before.slice(given.index + given[0].length);
    const others: string[] = [];
    let rest = between;
    while (rest.trim() !== "") {
      const other = namedStep(rest);
      if (!other || other.start !== rest.search(/\S/)) break;
      const glue = rest.slice(other.end);
      const joined = /^\s*(?:,\s*)?(?:and|&|,)\s*(?:an?\s+)?/i.exec(glue);
      if (!joined) break;
      others.push(other.label);
      rest = glue.slice(joined[0].length);
    }
    if (rest.trim() !== "" && !STEP_JOIN.test(rest)) continue;
    const named = sentence.slice(step.start, step.end);
    for (const date of list) if (date.iso <= today) dated.push({ iso: date.iso, named });
    undated.push(...others);
  }
  return { dated, undated };
}

/** PRIOR_STEP_DATE_LIST_ENABLED: the steps named without a date beside a dated list, as lines, unless already listed. */
function undatedListSteps(notes: string, today: string, lines: readonly string[]): string[] {
  if (!priorStepDateListEnabled()) return [];
  const out: string[] = [];
  for (const label of dateListSteps(notes, today).undated) {
    const listed = [...lines, ...out].some((line) => namedStep(line)?.label === label);
    if (!listed) out.push(label);
  }
  return out;
}

/**
 * One step the manager dated, as a line. PRIOR_ACTIONS_PARSE_ENABLED (QA, 25 Oct
 * 2026): the line holds no word the manager did not say — "signed" only when
 * they wrote sign/signed, and a manual they named reads as the manual's title,
 * "JBA Policy Manual", with nothing added after it. "jba manual 1-1-26 for
 * previous coaching" is "Coaching — JBA Policy Manual — 01/01/2026". Off, the
 * line is as before.
 */
function managerStepLine(step: { iso: string; named: string; topic?: string; about?: string }): string {
  const label = stepLabel(step.named);
  const description = stepDescription(step.named) || (step.about ?? "");
  if (!priorActionsParseEnabled()) return priorActionLine(label, step.iso, stepTopic(step.topic), description, saidSigned(step) ? "said_signed" : "said");
  const what = description ? `${label} ${description}` : label;
  // "verbal ca signed 9-1-26": "signed" marks the date, it is not what the step was about.
  const topic = manualTitled(stepTopic(step.topic))
    .replace(/\bsign(?:ed|ing)?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${topic ? `${what} — ${topic}` : what} — ${saidSigned(step) ? "signed " : ""}${signedDate(step.iso)}`;
}

/** Whether the manager's own words for a step say it was signed ("verbal ca signed 9-1-26"). */
function saidSigned(step: { named: string; topic?: string }): boolean {
  return /\bsign(?:ed|ing)?\b/i.test(`${step.named} ${step.topic ?? ""}`);
}

/**
 * PRIOR_ACTIONS_NO_SIGNED_ENABLED: the dates the manager said a step was
 * signed — a step they dated in words that say so (`saidSigned`), or a
 * sentence of theirs that says sign/signed and gives the date ("verbal
 * warning signed 9/1/26", which no step reader takes as a step).
 */
function signedDatesSaid(notes: string, today: string, steps: readonly { iso: string; named: string; topic?: string }[]): Set<string> {
  const dates = new Set(steps.filter(saidSigned).map((step) => step.iso));
  for (const sentence of (notes ?? "").split(/(?<=[!?\n])|(?<=\.)(?!\d)/)) {
    if (!/\bsign(?:ed|ing)?\b/i.test(sentence)) continue;
    for (const found of [...datesInText(sentence, today), ...dotDates(sentence, today)]) dates.add(found.iso);
  }
  return dates;
}

/**
 * A drafted line without the "signed" nobody said: "Coaching — JBA Policy
 * Manual — signed 10/15/2026" → "Coaching — JBA Policy Manual — 10/15/2026".
 * Kept as written when the manager said a step on one of its dates was signed.
 */
function withoutUnsaidSigned(line: string, today: string, signedSaid: ReadonlySet<string>): string {
  if (!/\bsign(?:ed|ing)?\b/i.test(line)) return line;
  if (datesInText(line, today).some((found) => signedSaid.has(found.iso))) return line;
  return line
    .replace(/\(\s*sign(?:ed|ing)?\s*\)/gi, " ")
    .replace(/\bsign(?:ed|ing)?\b(?:\s+(?:on|off(?:\s+on)?))?\s*:?/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/—\s*—/g, "—")
    .replace(/\s*—\s*$/, "")
    .trim();
}

/** "jba manual", "policy manual", "JBA Policy Manual": the manual's title, never renamed. */
function manualTitled(topic: string): string {
  return topic.replace(/\b(?:jba\s+)?(?:policy\s+)?manual\b/i, "JBA Policy Manual");
}

/**
 * The drafted list, held to what the manager actually said.
 *
 *   A line carrying a date the manager never gave is removed — an invented
 *   date on a disciplinary history is the worst thing this line can hold.
 *   Each step the manager dated in their own words and the draft left out is
 *   added as its own line, and so is each finalized form on file for them.
 *   Left empty, and told "first time", it reads "None — first occurrence".
 *
 * Lines without a date are kept: "Coaching on attendance (date not given)" is
 * the manager's to complete, not this function's to delete.
 */
export function groundPriorActions(input: {
  drafted: string;
  notes: string;
  today: string;
  /**
   * The employee's finalized forms in Form Monitoring, as lines — see
   * `prior-forms.ts`. A record, so its dates stand as the manager's do, and a
   * step on file that the draft left out is listed.
   */
  onFile?: readonly { formDate: string; line: string; templateKey?: string }[];
}): { value: string; added: string[]; removed: string[] } {
  const onFile = input.onFile ?? [];
  const stated = new Set([
    // PRIOR_SENTENCE_FIX_ENABLED: a yearless "10-16" the manager typed is a date they gave (`datesInText` with it off).
    ...(priorSentenceFixFor(input.notes) ? managerDatesForDraft : datesInText)(input.notes, input.today).map((found) => found.iso),
    ...onFile.map((form) => form.formDate),
  ]);
  const removed: string[] = [];
  // PRIOR_ROW_NOT_ON_INCIDENT_DATE_ENABLED: a step on the incident's own date that nobody named is invented.
  const incidentDays = priorRowNotOnIncidentDateEnabled() ? new Set(incidentDates(input.notes, input.today)) : new Set<string>();
  // The kinds of step the manager named without a date ("On the first shift I verbally coached her"): such a row may be theirs.
  const undatedKinds = priorRowNotOnIncidentDateEnabled() ? undatedStepKinds(input.notes, input.today) : new Set<string>();
  const stepOrFile = new Set([...stepsSaid(input.notes, input.today).map((step) => step.iso), ...onFile.map((form) => form.formDate)]);

  // A date the manager corrected ("9-2-26 not 9-1-26") is no longer one they gave.
  for (const retracted of correctedDates(input.notes, input.today).keys()) stated.delete(retracted);
  const kept = (input.drafted ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (line === "") return false;
      const dates = datesInText(line, input.today);
      if (dates.some((found) => !stated.has(found.iso))) {
        removed.push(line);
        return false;
      }
      /*
       * FUTURE_PRIOR_ROW_DROP_ENABLED (QA LS-B11 in the sibling app, 26 Oct 2026: "previous
       * coaching jba manual 11-1-26", corrected next turn to "jba manual
       * 11-1-25"): the draft kept "Coaching — signed 11/01/2026" beside the
       * corrected row. An earlier step is never after today, so with the flag
       * on such a row is removed. Off, as before.
       */
      if (futurePriorRowDropEnabled() && dates.length > 0 && dates.every((found) => found.iso > input.today)) {
        removed.push(line);
        return false;
      }
      if (
        dates.length > 0 &&
        dates.every((found) => incidentDays.has(found.iso) && !stepOrFile.has(found.iso)) &&
        !undatedKinds.has(stepKind(line) ?? "")
      ) {
        removed.push(line);
        return false;
      }
      return true;
    });

  /*
   * PRIOR_ACTIONS_NO_SIGNED_ENABLED (QA, a location manager's chat in the
   * sibling app, 5 Nov 2026: "this is a verbal warning. previous coaching
   * policy manual 10-15-26" drafted "Coaching — JBA Policy Manual — signed
   * 10/15/2026"). Nothing on the record says a step was signed, so a kept
   * line says so only where the manager did. Off, as before.
   */
  if (priorActionsNoSignedEnabled()) {
    const signedSaid = signedDatesSaid(input.notes, input.today, stepsSaid(input.notes, input.today));
    kept.splice(0, kept.length, ...kept.map((line) => withoutUnsaidSigned(line, input.today, signedSaid)));
  }

  const present = new Set(kept.flatMap((line) => datesInText(line, input.today).map((found) => found.iso)));
  const added: string[] = [];
  for (const step of stepsSaid(input.notes, input.today)) {
    if (present.has(step.iso)) continue;
    present.add(step.iso);
    added.push(managerStepLine(step));
  }
  // PRIOR_STEP_DATE_LIST_ENABLED: "a verbal warning and coaching on 9/8, 9/15 and 9/25": the verbal warning, undated.
  added.push(...undatedListSteps(input.notes, input.today, [...kept, ...added]));
  /*
   * What the manager said of a step comes first; the record fills in the rest.
   *
   * A LINE STANDS FOR ONE STEP, NOT FOR A WHOLE DAY (QA F-11, 22 Oct 2026). A
   * Coaching Form and a Verbal CA signed the same day are two steps; matching
   * on the date alone listed only the first. A line already on the list covers
   * a form on file only when it has the form's date AND names the same kind
   * of step, and each line covers one form.
   */
  const covering = [...kept, ...added].map((line) => ({
    line,
    dates: new Set(datesInText(line, input.today).map((found) => found.iso)),
    used: false,
  }));
  for (const form of onFile) {
    const cover = covering.find(
      (entry) => !entry.used && entry.dates.has(form.formDate) && sameStepKind(entry.line, form),
    );
    if (cover) {
      cover.used = true;
      continue;
    }
    added.push(form.line);
    covering.push({ line: form.line, dates: new Set([form.formDate]), used: true });
  }

  const lines = [...kept, ...added];
  // A history and "None" cannot both be true; a dated step wins.
  const history = lines.filter((line) => !/^none\b/i.test(line));
  const final = history.length > 0 ? history : lines;

  if (final.length === 0 && statesFirstOccurrence(input.notes)) {
    return { value: NO_PRIOR_ACTION, added: [NO_PRIOR_ACTION], removed };
  }
  return { value: final.join("\n"), added, removed };
}

/** Whether a line on the list names the same kind of step as a form on file. */
function sameStepKind(line: string, form: { line: string; templateKey?: string }): boolean {
  const coaching = (text: string) => /\bcoach/i.test(text);
  const corrective = (text: string) => /\b(?:corrective|verbal|written|warning|termination|demotion|ca|c\/a|write[- ]?up)\b/i.test(text);
  const formIsCoaching = form.templateKey ? form.templateKey === "coaching" : coaching(form.line) && !corrective(form.line);
  return formIsCoaching ? coaching(line) : corrective(line);
}

/**
 * The revision-4 pair, read as one entry on the new list — so a form revised
 * onto revision 5 keeps the history its original recorded. Null when the
 * original recorded neither.
 */
export function legacyPriorActions(
  previousAction: string | null | undefined,
  previousActionDate: string | null | undefined,
): string | null {
  const action = (previousAction ?? "").trim();
  const date = (previousActionDate ?? "").trim();
  if (action === "" && date === "") return null;
  if (date === "") return action;
  const step = action === "" ? "Previous corrective action" : action;
  // PRIOR_ACTIONS_NO_SIGNED_ENABLED: the old form recorded a date, not that anything was signed.
  return priorActionsNoSignedEnabled() ? `${step} — ${signedDate(date)}` : `${step} — signed ${signedDate(date)}`;
}

/*
 * PRIOR_ROW_NOT_ON_INCIDENT_DATE_ENABLED (QA live pass 7, 26 Oct 2026): a row on
 * an incident date is the manager's when they named that kind of step without
 * a date ("On the first shift I verbally coached her on our policy" → the
 * coaching on 10/5, the first shift). It is invented only when every step of
 * that kind they named has its own date ("i coached her on 10-16"), as with
 * "Verbal coaching on lateness — 10/15/2026" built from "verbal" and "10-15".
 */
const STEP_WORDS =
  /\b(?:coach(?:ed|ing)?|talked\s+(?:to|with)|spoke\s+(?:to|with)|counsel(?:ed|ing)?|warn(?:ed|ing)|(?:verbal|written)\s+(?:warning|ca|corrective)|wrote\s+(?:her|him|them)\s+up|write[- ]?up)\b/i;

/* A yearless day the date reader may skip: "10-16", "10/1", "oct 1st", "October 1st". */
const HAS_A_DAY =
  /\b\d{1,2}[-/.]\d{1,2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/i;

function stepKind(text: string): "warning" | "coaching" | null {
  if (/\b(?:warn(?:ed|ing)?|written|write[- ]?up|wrote\s+\w+\s+up|corrective|c\/?a)\b/i.test(text)) return "warning";
  if (/\b(?:coach(?:ed|ing)?|talked|spoke|counsel(?:ed|ing)?)\b/i.test(text)) return "coaching";
  return null;
}

function undatedStepKinds(notes: string, today: string): Set<string> {
  const kinds = new Set<string>();
  for (const sentence of notes.split(/(?<=[.!?])\s+|\n+/)) {
    if (!STEP_WORDS.test(sentence) || datesInText(sentence, today).length > 0 || HAS_A_DAY.test(sentence)) continue;
    const kind = stepKind(sentence.replace(/\b(?:create|make|need|issue|write)\b.*?\b(?:ca|c\/a|corrective\s+action)(?:\s+form)?\b/gi, " "));
    if (kind) kinds.add(kind);
  }
  return kinds;
}
