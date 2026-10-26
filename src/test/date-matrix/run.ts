import { appendFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DATE_MATRIX_CASES, type DateMatrixCase, type DateMatrixCasing, type PriorKind } from "./cases";

/**
 * ============================================================================
 * RUNNING THE DATE MATRIX — THE ONE HELPER EVERY SESSION CALLS
 * ============================================================================
 *
 * BYTE-IDENTICAL IN ASK SUNNY AND ASK BUBBLES, like `cases.ts`. Each app's
 * `src/app/api/chat/date-matrix-e2e.test.ts` drives its own chat route and
 * hands this helper what the form said; this helper knows nothing about
 * either app.
 *
 * API
 *
 *   import { runDateMatrix, type FormReading } from "@/test/date-matrix/run";
 *
 *   runDateMatrix({
 *     app: "Ask Sunny",                       // names the describe block
 *     ask: (c: DateMatrixCase) => Promise<FormReading>,
 *     only: (c) => c.role === "prior",       // optional: a subset of cases
 *     gaps: { "qa-late-coached/*:incidentDates": "gap: Code 1 PRIOR_SENTENCE_FIX — …" },
 *     place: "the front desk",                // optional: fills `{place}`
 *     skip: false,                            // optional: register as skipped
 *   });
 *
 * `ask` runs the case's turns (`c.turns`, already in the case's casing, with
 * `{place}` filled by `fillPlace`) through the app and returns a
 * `FormReading`: the card's Date, Prior actions rows, Observation (or the
 * app's own name for it), Follow-up and exit dates, and every sentence that
 * asked which date was meant. It is called ONCE per case; every cell of the
 * case reads the same answer. Reset the app's state inside `ask` — it runs
 * inside the case's first test.
 *
 * CELLS. Each case is one `describe`, and each role or rule it pins is one
 * `it` (see `cellsFor`): formDate, incidentDates, priorActions,
 * priorNotFormDate, followUpDate, lastDayWorked, noticeDate,
 * noticeFulfilledDate, resignationDate, effectiveDate, observation,
 * noInventedDates, asksWhichDate (exactly as expected) or asksAtMostOnce.
 * A cell id is `<base id>/<casing>:<cell>`.
 *
 * KNOWN GAPS. `gaps` maps a cell-id glob (`*` matches anything) to a note
 * that starts with "gap:" and names the owning fix or "unowned". A matching
 * cell runs as `it.fails`: CI stays green while the gap is visible, and the
 * moment the owning fix makes the cell pass, `it.fails` FAILS — the fix's PR
 * must delete that gap line in the same change. A gap therefore never hides
 * a regression, and never outlives its fix. The first matching key wins.
 *
 * ANOTHER PR's TEST runs every case, or a filtered subset, against its own
 * flag set by copying its app's runner (the route harness) and passing its own
 * `only` and `gaps` — for a fix, the runner's gap table minus the lines the
 * fix closes.
 *
 * ENVIRONMENT
 *   DATE_MATRIX_REPORT=<file>   append one JSON line per cell: the case, the
 *                               cell, whether it passed, and why not.
 *   DATE_MATRIX_IGNORE_GAPS=1   run every cell as a plain `it` (to see what
 *                               fails today). Never set in CI.
 */

export interface FormReading {
  /** A form card came back at all. */
  card: boolean;
  templateKey: string | null;
  /** Informational: the employee the card names. */
  employee: string | null;
  /** The card's Date, ISO, or null when none is shown. */
  formDate: string | null;
  /** The Prior actions rows, as printed. */
  priorRows: string[];
  /** The Observation / account, as printed ("" when there is none). */
  observation: string;
  followUpDate: string | null;
  lastDayWorked: string | null;
  noticeDate: string | null;
  noticeFulfilledDate: string | null;
  resignationDate: string | null;
  effectiveDate: string | null;
  /** Every sentence, over the whole conversation, that asked which date was meant. */
  dateQuestions: string[];
  /** Every reply, for failure messages. */
  transcript: string;
}

export interface RunDateMatrixOptions {
  app: string;
  ask: (testCase: DateMatrixCase) => Promise<FormReading>;
  only?: (testCase: DateMatrixCase) => boolean;
  gaps?: Readonly<Record<string, string>>;
  place?: string;
  /** Register the cases as skipped (e.g. inside a suite that re-runs every test under other flags). */
  skip?: boolean;
}

/* ------------------------------------------------------------- the words -- */

/** Fills `{place}` in the case's casing, or drops " at {place}" when the app gives none. */
export function fillPlace(text: string, casing: DateMatrixCasing, place?: string): string {
  if (!place) return text.replace(/,?\s+at \{place\}/gi, "").replace(/\{place\}/gi, "");
  const cased = casing === "lower" ? place.toLowerCase() : casing === "upper" ? place.toUpperCase() : place;
  return text.replace(/\{place\}/gi, cased);
}

/** The value of a "**Label:** …" line (or "- **Label:** …"), or null. */
export function cardLine(content: string, label: string): string | null {
  for (const raw of content.split("\n")) {
    const line = raw.trim().replace(/^[-*]\s+/, "");
    if (line.startsWith(`**${label}:**`)) return line.slice(`**${label}:**`.length).trim();
  }
  return null;
}

/** Sentences that ask the manager which date was meant. */
export function dateQuestionsIn(content: string): string[] {
  return content
    .split(/\n+|(?<=[.?!])\s+/)
    .filter((sentence) =>
      /which date|more than one date|couldn't read the date|what date|which day|is that (?:the )?date/i.test(sentence) &&
      /\?/.test(sentence),
    );
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};
const MONTH = "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)";
const ORDINAL_WORDS = [
  "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
  "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth",
  "nineteenth", "twentieth", "twenty-first", "twenty-second", "twenty-third", "twenty-fourth", "twenty-fifth",
  "twenty-sixth", "twenty-seventh", "twenty-eighth", "twenty-ninth", "thirtieth", "thirty-first",
];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const pad = (value: number) => String(value).padStart(2, "0");

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function valid(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** A typed year as written, else the most recent such day not after `today`. */
function resolve(month: number, day: number, year: string | undefined, today: string): string | null {
  if (year) {
    const full = year.length === 2 ? 2000 + Number(year) : Number(year);
    return valid(full, month, day) ? `${full}-${pad(month)}-${pad(day)}` : null;
  }
  const thisYear = Number(today.slice(0, 4));
  for (const candidate of [thisYear, thisYear - 1]) {
    if (!valid(candidate, month, day)) continue;
    const iso = `${candidate}-${pad(month)}-${pad(day)}`;
    if (iso <= today) return iso;
  }
  return null;
}

export interface MentionedDate {
  iso: string;
  /** "MM-DD", for comparing a printed date with a typed one whatever the year. */
  monthDay: string;
  phrase: string;
}

/**
 * Every date the text mentions, in any format the matrix uses, resolved to
 * ISO against `today`. The matrix's own reader — deliberately independent of
 * either app's — so a cell can tell which dates a card printed.
 */
export function mentionedDates(text: string, today: string): MentionedDate[] {
  const found: (MentionedDate & { index: number; end: number })[] = [];
  const add = (pattern: RegExp, read: (match: RegExpMatchArray) => string | null) => {
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      const end = index + match[0].length;
      if (found.some((entry) => index < entry.end && end > entry.index)) continue;
      const iso = read(match);
      if (iso) found.push({ iso, monthDay: iso.slice(5), phrase: match[0], index, end });
    }
  };
  const month = (word: string) => MONTHS[word.toLowerCase()]!;

  add(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (m) => resolve(Number(m[2]), Number(m[3]), m[1], today));
  add(new RegExp(String.raw`\b${MONTH}\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?`, "gi"), (m) =>
    resolve(month(m[1]!), Number(m[2]), m[3], today),
  );
  add(new RegExp(String.raw`\b${MONTH}\.?\s+(${ORDINAL_WORDS.join("|")})\b`, "gi"), (m) =>
    resolve(month(m[1]!), ORDINAL_WORDS.indexOf(m[2]!.toLowerCase()) + 1, undefined, today),
  );
  add(new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?[\s-]+${MONTH}\b\.?(?:,?\s+(\d{4}))?`, "gi"), (m) =>
    resolve(month(m[2]!), Number(m[1]), m[3], today),
  );
  add(/(?<![\d$.,/-])(\d{1,2})([-/.])(\d{1,2})(?:\2(\d{4}|\d{2}))?(?![\d]|[-/.]\d)/g, (m) =>
    resolve(Number(m[1]), Number(m[3]), m[4], today),
  );
  add(/\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/gi, (m) => {
    const day = Number(m[1]);
    let [year, monthNumber] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
    for (let step = 0; step < 12; step += 1) {
      const iso = valid(year, monthNumber, day) ? `${year}-${pad(monthNumber)}-${pad(day)}` : null;
      if (iso && iso <= today) return iso;
      monthNumber -= 1;
      if (monthNumber === 0) [year, monthNumber] = [year - 1, 12];
    }
    return null;
  });
  add(/\bon\s+(\d{2})(\d{2})\b/gi, (m) => resolve(Number(m[1]), Number(m[2]), undefined, today));
  add(/\btoday\b/gi, () => today);
  add(/\byesterday\b/gi, () => addDays(today, -1));
  add(new RegExp(String.raw`\b(?:last|this past)\s+(${WEEKDAYS.join("|")})\b`, "gi"), (m) => {
    const target = WEEKDAYS.indexOf(m[1]!.toLowerCase());
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    return addDays(today, -(((weekday - target + 7) % 7) || 7));
  });
  return found.sort((left, right) => left.index - right.index).map(({ iso, monthDay, phrase }) => ({ iso, monthDay, phrase }));
}

/* ------------------------------------------------------------- the cells -- */

export type DateMatrixCell =
  | "formDate"
  | "incidentDates"
  | "priorActions"
  | "priorNotFormDate"
  | "followUpDate"
  | "lastDayWorked"
  | "noticeDate"
  | "noticeFulfilledDate"
  | "resignationDate"
  | "effectiveDate"
  | "observation"
  | "noInventedDates"
  | "asksWhichDate"
  | "asksAtMostOnce";

const SINGLE_DATE_ROLES = [
  "followUpDate",
  "lastDayWorked",
  "noticeDate",
  "noticeFulfilledDate",
  "resignationDate",
  "effectiveDate",
] as const;

/** The roles and rules a case pins, in a fixed order. */
export function cellsFor(testCase: DateMatrixCase): DateMatrixCell[] {
  const e = testCase.expect;
  const cells: DateMatrixCell[] = [];
  if (e.formDate !== undefined) cells.push("formDate");
  if (e.incidentDates) cells.push("incidentDates");
  if (e.priorActions) cells.push("priorActions");
  if (e.priorActions?.length) cells.push("priorNotFormDate");
  for (const role of SINGLE_DATE_ROLES) if (e[role] !== undefined) cells.push(role);
  if (e.observationMustContain || e.observationMustNotContain) cells.push("observation");
  if (e.incidentDates || e.priorActions) cells.push("noInventedDates");
  cells.push(e.asksWhichDate === undefined ? "asksAtMostOnce" : "asksWhichDate");
  return cells;
}

const KIND: Record<PriorKind, RegExp> = {
  verbal: /verbal/i,
  written: /written/i,
  coaching: /coach|manual|training/i,
};

function describeReading(reading: FormReading): string {
  return [
    `card=${reading.card} template=${reading.templateKey} employee=${reading.employee} formDate=${reading.formDate}`,
    `priorRows=${JSON.stringify(reading.priorRows)} followUp=${reading.followUpDate}`,
    `lastDay=${reading.lastDayWorked} notice=${reading.noticeDate} fulfilled=${reading.noticeFulfilledDate} resigned=${reading.resignationDate}`,
    `observation=${JSON.stringify(reading.observation)}`,
    `dateQuestions=${JSON.stringify(reading.dateQuestions)}`,
    "--- transcript ---",
    reading.transcript.slice(0, 2500),
  ].join("\n");
}

/** Throws (through `expect`) when the cell does not hold. */
export function checkCell(testCase: DateMatrixCase, reading: FormReading, cell: DateMatrixCell): void {
  const e = testCase.expect;
  const why = `${testCase.id}:${cell}\n${describeReading(reading)}`;
  const today = testCase.today;
  const observed = mentionedDates(reading.observation, today);
  switch (cell) {
    case "formDate": {
      if (e.formDateOrAsk && reading.dateQuestions.length === 1) return;
      if (e.formDate === null) {
        expect([null, today], why).toContain(reading.formDate);
        return;
      }
      expect(reading.formDate, why).toBe(e.formDate);
      return;
    }
    case "incidentDates": {
      const printed = observed.map((entry) => entry.monthDay);
      const missing = e.incidentDates!.filter((iso) => !printed.includes(iso.slice(5)));
      expect(missing, `incident dates missing from the Observation\n${why}`).toEqual([]);
      return;
    }
    case "priorActions": {
      const wanted = e.priorActions!;
      if (!wanted.length) {
        expect(reading.priorRows, why).toEqual([]);
        return;
      }
      const missing = wanted.filter(
        (prior) =>
          !reading.priorRows.some(
            (row) => KIND[prior.kind].test(row) && mentionedDates(row, today).some((date) => date.monthDay === prior.date.slice(5)),
          ),
      );
      expect(missing, `prior rows missing\n${why}`).toEqual([]);
      expect(reading.priorRows.length, `prior rows: exactly the ones stated\n${why}`).toBe(wanted.length);
      return;
    }
    case "priorNotFormDate": {
      const priors = e.priorActions!.map((prior) => prior.date.slice(5));
      if (reading.formDate) expect(priors, `the form is dated with a prior's date\n${why}`).not.toContain(reading.formDate.slice(5));
      return;
    }
    case "followUpDate":
    case "lastDayWorked":
    case "noticeDate":
    case "noticeFulfilledDate":
    case "resignationDate":
    case "effectiveDate":
      if (e.dateOrAsk && reading.dateQuestions.length === 1) return;
      expect(reading[cell], why).toBe(e[cell]);
      return;
    case "observation": {
      const text = reading.observation.toLowerCase();
      for (const must of e.observationMustContain ?? []) expect(text, `must contain "${must}"\n${why}`).toContain(must.toLowerCase());
      for (const never of e.observationMustNotContain ?? []) expect(text, `must not contain "${never}"\n${why}`).not.toContain(never.toLowerCase());
      return;
    }
    case "noInventedDates": {
      const typed = testCase.turns.flatMap((turn) => mentionedDates(turn, today));
      const expected = [
        e.formDate,
        ...(e.incidentDates ?? []),
        ...(e.priorActions ?? []).map((prior) => prior.date),
      ].filter((iso): iso is string => Boolean(iso));
      const allowedIso = new Set([...typed.map((entry) => entry.iso), ...expected]);
      const allowedDay = new Set([...allowedIso].map((iso) => iso.slice(5)));
      const invented = [
        ...observed.filter((entry) => !allowedDay.has(entry.monthDay)),
        ...reading.priorRows.flatMap((row) => mentionedDates(row, today)).filter((entry) => !allowedIso.has(entry.iso)),
      ].map((entry) => `${entry.phrase} (${entry.iso})`);
      expect(invented, `dates the manager did not give\n${why}`).toEqual([]);
      return;
    }
    case "asksWhichDate":
      expect(reading.dateQuestions.length, why).toBe(e.asksWhichDate ? 1 : 0);
      return;
    case "asksAtMostOnce":
      expect(reading.dateQuestions.length, `asked about a date more than once\n${why}`).toBeLessThanOrEqual(1);
      return;
  }
}

/* ------------------------------------------------------------ the runner -- */

function glob(pattern: string): RegExp {
  return new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
}

/** The gap note for a cell id, or null. */
export function gapFor(gaps: Readonly<Record<string, string>> | undefined, cellId: string): string | null {
  for (const [pattern, note] of Object.entries(gaps ?? {})) if (glob(pattern).test(cellId)) return note;
  return null;
}

export function runDateMatrix(options: RunDateMatrixOptions): void {
  const cases = DATE_MATRIX_CASES.filter((entry) => !options.only || options.only(entry));
  const ids = new Set<string>();
  for (const entry of cases) {
    if (ids.has(entry.id)) throw new Error(`duplicate date-matrix case id ${entry.id}`);
    ids.add(entry.id);
  }
  for (const note of Object.values(options.gaps ?? {})) {
    if (!note.startsWith("gap:")) throw new Error(`a gap note starts with "gap:": ${note}`);
  }
  const ignoreGaps = process.env.DATE_MATRIX_IGNORE_GAPS === "1";
  const reportTo = process.env.DATE_MATRIX_REPORT;
  const readings = new Map<string, Promise<FormReading>>();
  const read = (entry: DateMatrixCase) => {
    let pending = readings.get(entry.id);
    if (!pending) {
      const filled = { ...entry, turns: entry.turns.map((turn) => fillPlace(turn, entry.casing, options.place)) };
      pending = options.ask(filled);
      readings.set(entry.id, pending);
    }
    return pending;
  };

  (options.skip ? describe.skip : describe)(`date matrix — ${options.app}`, () => {
    for (const entry of cases) {
      describe(entry.id, () => {
        for (const cell of cellsFor(entry)) {
          const cellId = `${entry.id}:${cell}`;
          const gap = ignoreGaps ? null : gapFor(options.gaps, cellId);
          const test = gap ? it.fails : it;
          test(gap ? `${cell} — ${gap}` : cell, async () => {
            let reading: FormReading | null = null;
            try {
              reading = await read(entry);
              checkCell(entry, reading, cell);
              if (reportTo) record(reportTo, options.app, entry, cell, reading, true, gap, "");
            } catch (error) {
              if (reportTo) record(reportTo, options.app, entry, cell, reading, false, gap, String((error as Error)?.message ?? error));
              throw error;
            }
          });
        }
      });
    }
  });
}

function record(
  file: string,
  app: string,
  entry: DateMatrixCase,
  cell: DateMatrixCell,
  reading: FormReading | null,
  pass: boolean,
  gap: string | null,
  message: string,
) {
  appendFileSync(
    file,
    `${JSON.stringify({
      app,
      id: entry.id,
      baseId: entry.baseId,
      casing: entry.casing,
      form: entry.form,
      role: entry.role,
      formats: entry.formats,
      cell,
      pass,
      gap,
      employee: reading?.employee ?? null,
      expectedEmployee: entry.expect.employee ?? null,
      card: reading?.card ?? false,
      formDate: reading?.formDate ?? null,
      priorRows: reading?.priorRows ?? [],
      followUpDate: reading?.followUpDate ?? null,
      lastDayWorked: reading?.lastDayWorked ?? null,
      noticeDate: reading?.noticeDate ?? null,
      resignationDate: reading?.resignationDate ?? null,
      observation: reading?.observation ?? "",
      dateQuestions: reading?.dateQuestions ?? [],
      message: message.split("\n")[0]!.slice(0, 300),
      transcript: (reading?.transcript ?? "").slice(0, 1500),
    })}\n`,
  );
}
