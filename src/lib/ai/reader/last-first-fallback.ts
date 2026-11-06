import { plainWords, type CheckContext } from "./check";
import { lastFirstReading } from "./last-first";
import type { ReaderResult } from "./read";

/**
 * ============================================================================
 * LAST_FIRST_AI_FALLBACK_ENABLED — "CALDER, REMY" WHEN THE AI READER GIVES NO EMPLOYEE
 * ============================================================================
 *
 * QA's audit of #352 (6 Nov 2026; ported from Ask Bubbles): the last-first
 * reading (`last-first.ts`) ran only with the AI reader off. With it on, as in
 * production, a reply with no employee, a timeout or an error left "<Last>,
 * <First>" unread and the card was for "<Last>".
 *
 *   the AI reader fell back (timeout, error, unusable)  -> the last-first reading, if it finds one person
 *   the AI reader read no roster person                 -> its other fields, with the last-first employee
 *   the AI reader read a roster person                  -> left alone
 *
 * The AI reader returning only the "<Last>" word of a "<Last>, <First>" the
 * manager typed is one of the first two rows: the reader's checks (`check.ts`
 * nameFits) give a lone "Calder" a person only when it fits exactly one
 * person, and the pair's person always fits it, so that person IS the pair's;
 * when "Calder" fits two people it is no employee, and the pair decides. The
 * last-first reading is `last-first.ts`'s, unchanged: no new name parser.
 */
export function withLastFirstFallback(
  read: ReaderResult | { readonly fallback: string },
  context: CheckContext,
): ReaderResult | { readonly fallback: string } {
  if ("checked" in read && read.checked.employee?.person) return read;
  const lastFirst = lastFirstReading(context);
  if (!lastFirst) return read;
  if (!("checked" in read)) return { checked: lastFirst, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, ms: 0 };
  return { ...read, checked: { ...read.checked, employee: lastFirst.employee, quotedEmployee: lastFirst.quotedEmployee } };
}

type Employee = { readonly person: { readonly id: string; readonly firstName: string; readonly lastName: string; readonly preferredFirstName?: string | null } | null; readonly name?: string | null; readonly typed?: string | null };

/**
 * This app only (`intent-slots.ts`): CORRECTED_EMPLOYEE_SLOT_ENABLED reads the turn's own name again after the
 * merge, and "My employee Calder, Remy …" names "Calder", which replaced the Remy Calder the checked reading had
 * just filled. A "correction" that is only words of the filled person's own name is that person: the filled
 * employee is kept. Any other correction (another name, another person) stands.
 */
export function withFilledEmployeeKept<T extends Employee>(filled: T, corrected: T): T {
  const person = filled.person;
  if (!person || corrected === filled || corrected.person?.id === person.id) return corrected;
  const typed = plainWords(corrected.name ?? corrected.typed ?? "").split(" ").filter(Boolean);
  const names = [person.firstName, person.preferredFirstName ?? "", person.lastName].flatMap((name) => plainWords(name).split(" ")).filter(Boolean);
  return typed.length > 0 && typed.every((word) => names.includes(word)) ? filled : corrected;
}
