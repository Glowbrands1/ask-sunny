import { PRODUCTION_SALONS } from "@/data/salons";
import { payrollAmountFieldEnabled, priorActionsParseEnabled } from "@/lib/config/chat-quality-flags";
import { blankYearlessStepDates, extractFormDate } from "@/lib/forms/form-date-answer";
import {
  payrollAmountFromConversation,
  payrollAnswerForAmount,
  payrollDeductAmount,
  statedPayrollDeduct,
} from "@/lib/forms/payroll-deduct";
import { extractJobTitle, readEmployeeMentions } from "@/lib/forms/proposal";
import { readSalonMentions, rosterSalonName } from "@/lib/forms/salon-mention";
import { statedWarningLevel, warningLevelFromTurns } from "@/lib/forms/warning-level";

/**
 * Facts the current turn left out, copied forward from earlier manager turns.
 *
 * The proposal readers are not changed. This only adds a sentence they
 * already understand, and only when a flag asks for it. With both flags off
 * the question is returned unchanged.
 */

export interface IntakeTurn {
  readonly role: string;
  readonly content: string;
}

export function augmentIntakeQuestion(input: {
  readonly slots: boolean;
  readonly fields: boolean;
  readonly question: string;
  readonly history: readonly IntakeTurn[];
  readonly today: string;
}): string {
  if (!input.slots && !input.fields) return input.question;
  const additions: string[] = [];
  if (input.slots) additions.push(...slotLines(input.question, input.history));
  if (input.fields) {
    const earlier = input.history
      .filter((turn) => turn.role === "user")
      .map((turn) => turn.content)
      .join("\n");
    additions.push(...fieldLines(input.question, input.today, earlier));
  }
  if (additions.length === 0) return input.question;
  return `${input.question.trim()}\n${additions.join(" ")}`;
}

function slotLines(question: string, history: readonly IntakeTurn[]): string[] {
  const earlier = history.filter((turn) => turn.role === "user").map((turn) => turn.content);
  const lines: string[] = [];

  const name = singleName(earlier);
  if (name && readEmployeeMentions(question).names.length === 0) {
    lines.push(`The employee is ${name}.`);
  }

  const title = extractJobTitle(earlier.join("\n"));
  if (title && !extractJobTitle(question)) {
    lines.push(`Job title: ${title}.`);
  }

  const joined = [...earlier, question].join("\n");
  const salon = singleSalon([...earlier, question]) ?? fuzzySalon(joined) ?? uniqueRosterSalon(joined);
  if (salon && readSalonMentions(question).length === 0) {
    lines.push(`It happened at ${salon}.`);
  }
  return lines;
}

const PROPER_NAME = /^[A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+)+$/;

function singleName(turns: readonly string[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const reading = readEmployeeMentions(turns[index] ?? "");
    if (reading.names.length !== 1) continue;
    const name = reading.names[0]!;
    if (reading.explicit || PROPER_NAME.test(name)) return name;
  }
  return null;
}

function singleSalon(turns: readonly string[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const mentions = readSalonMentions(turns[index] ?? "");
    const ids = [...new Set(mentions.flatMap((mention) => mention.salonIds))];
    if (ids.length === 1) return rosterSalonName(ids[0]!) ?? null;
  }
  return null;
}

/** Character trigrams. Used only when the roster reader found no salon. */
export function trigramSimilarity(left: string, right: string): number {
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

function trigrams(text: string): Set<string> {
  const padded = `  ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const grams = new Set<string>();
  for (let index = 0; index < padded.length - 2; index += 1) grams.add(padded.slice(index, index + 3));
  return grams;
}

function fuzzySalon(text: string): string | null {
  const phrases = [...text.matchAll(/(?:\bat|\bin)\s+(?:the\s+)?([a-z0-9][a-z0-9'’.-]*(?:\s+[a-z0-9][a-z0-9'’.-]*){0,3})/gi)];
  const raw = phrases.at(-1)?.[1]?.trim();
  if (!raw) return null;
  const tokens = raw.split(/\s+/).slice(0, 4);
  let best: { name: string; score: number } | null = null;
  for (let length = 1; length <= tokens.length; length += 1) {
    const ranked = rankSalons(tokens.slice(0, length).join(" "));
    if (!ranked) continue;
    if (!best || ranked.score > best.score) best = ranked;
  }
  return best?.name ?? null;
}

/**
 * One salon the words uniquely resemble, when `readSalonMentions` did not
 * take them. Two salons, or a weak resemblance, is no salon.
 */
export function uniqueRosterSalon(text: string): string | null {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const hits = new Map<string, number>();
  for (let start = 0; start < tokens.length; start += 1) {
    for (let length = 1; length <= 3 && start + length <= tokens.length; length += 1) {
      const phrase = tokens.slice(start, start + length).join(" ");
      if (phrase.length < 3) continue;
      const ranked = rankSalons(phrase);
      if (!ranked) continue;
      hits.set(ranked.name, Math.max(hits.get(ranked.name) ?? 0, ranked.score));
    }
  }
  if (hits.size !== 1) return null;
  return [...hits.keys()][0] ?? null;
}

function rankSalons(phrase: string): { name: string; score: number } | null {
  const ranked = PRODUCTION_SALONS.map((salon) => {
    const local = salon.name.replace(/^[A-Z]{2}\s+/, "");
    return {
      name: salon.name,
      score: Math.max(trigramSimilarity(phrase, salon.name), trigramSimilarity(phrase, local)),
    };
  }).sort((left, right) => right.score - left.score);
  const top = ranked[0];
  const next = ranked[1]?.score ?? 0;
  if (!top || top.score < 0.55 || top.score - next < 0.12) return null;
  return top;
}

/**
 * A month-day with no year ("on 10-1") and a dollar amount beside a
 * deduction the amount reader did not take. Rewritten into shapes
 * `extractFormDate` and `payrollDeductAmount` already accept.
 */
export function fieldLines(question: string, today: string, earlier = ""): string[] {
  const lines: string[] = [];
  const corpus = earlier.trim() ? `${earlier}\n${question}` : question;
  if (!extractFormDate(question, today)) {
    const known = extractFormDate(corpus, today);
    // "she was coached on 9-15": an earlier step's yearless date is not the incident (PRIOR_ACTIONS_PARSE_ENABLED).
    const slash = lastUnyearDated(priorActionsParseEnabled() ? blankYearlessStepDates(corpus, today) : corpus, today);
    if (known) lines.push(`It happened on ${slashDate(known)}.`);
    else if (slash) lines.push(`It happened on ${slash}.`);
  }

  if (payrollAmountFieldEnabled()) {
    // The amount line, not a deduction sentence the Action Plan would copy.
    // A policy quotation's $25 is not a figure the manager stated.
    const known = payrollAmountFromConversation([{ role: "user", content: corpus }], {
      payrollAnswer: payrollAnswerForAmount(corpus),
    });
    if (known && !/\bpayroll deduction amount:/i.test(question)) {
      lines.push(`Payroll deduction amount: ${known}.`);
    }
  } else if (!payrollDeductAmount(question)) {
    const known = payrollDeductAmount(corpus);
    const missed = missedDeduction(corpus);
    const amount = known ? `$${known.replace(/^\$/, "")}` : missed;
    if (amount) lines.push(`Payroll deduction of ${amount}.`);
  }

  if (statedPayrollDeduct(question) === null && earlier.trim()) {
    const known = statedPayrollDeduct(earlier);
    if (known === "yes") lines.push("Payroll deduct applies.");
    else if (known === "no") lines.push("No payroll deduction.");
  }
  if (statedWarningLevel(question) === null && earlier.trim()) {
    const level = warningLevelFromTurns(earlier.split("\n").map((line) => line.trim()).filter(Boolean));
    if (level) lines.push(`Warning level: ${level}.`);
  }
  return lines;
}

function slashDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${Number(month)}/${Number(day)}/${year}`;
}

function lastUnyearDated(text: string, today: string): string | null {
  let last: string | null = null;
  for (const match of text.matchAll(/\b(?:on|dated?)\s+(\d{1,2})-(\d{1,2})(?!\d|-)/gi)) {
    const formatted = calendarDay(Number(match[1]), Number(match[2]), today);
    if (formatted) last = formatted;
  }
  return last;
}

function calendarDay(month: number, day: number, today: string): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = Number(today.slice(0, 4));
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const probe = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(probe.getTime()) || probe.getUTCDate() !== day) return null;
  return `${month}/${day}/${year}`;
}

function missedDeduction(text: string): string | null {
  if (statedPayrollDeduct(text) !== "yes" && !/\bpayroll\b/i.test(text) && !/\bdeduct/i.test(text)) {
    return null;
  }
  const money = /\$\s?(\d+(?:,\d{3})*(?:\.\d{2})?)/.exec(text);
  if (!money) return null;
  const digits = money[1]!.replace(/,/g, "");
  if (Number(digits) === 0) return null;
  return money[0]!.replace(/\s+/g, "");
}
