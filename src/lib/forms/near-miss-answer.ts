import { nearMissDetailsAcceptEnabled } from "@/lib/config/chat-quality-flags";

import { editDistance } from "./employee-match";
import { statedPayrollDeduct } from "./payroll-deduct-answer";
import { statedWarningLevel } from "./warning-level";

/**
 * ============================================================================
 * A NEAR-MISS NAME, ANSWERED WITH THE FORM'S DETAILS (NEAR_MISS_DETAILS_ACCEPT_ENABLED)
 * ============================================================================
 *
 * Ported from the sibling app (QA's gate there on 4d42c342, 7 Nov 2026), with FORM_NAME on: "i have an employee,
 * Corvina Ashdown Vellacot that needs a corrective action form …" → "Is this for **Corvina Vellacott**? Tell me if
 * that should change." → "verbal warning, no payroll deduct, …" → the SAME question again, the details lost, no card.
 * The answer reader (`ai/first-name-suggest.ts` chosenName) took only "yes", an option or a full name, so the turn
 * was read as it was, the card was built for the name as typed, and the near-miss check asked again.
 *
 * The manager went on with the form without turning the name down. That accepts the name asked about, when:
 *   - the turn states a form detail, by the app's own readers: a warning level (`warning-level.ts`
 *     statedWarningLevel) or a payroll answer (`payroll-deduct-answer.ts`);
 *   - it is not a question and does not open by turning the name down ("no", "nope", "wrong", "not …"), unless that
 *     opening clause is itself the payroll answer ("no payroll deduct");
 *   - the manager typed the asked person's first name and a word close to their surname (a typo of the full name, not
 *     a first name typed alone: that is still only asked, as Pau ruled on 28 Oct 2026).
 * No word list. Off: never.
 */
export function acceptsNearMissWithDetails(reply: string, asked: string, typedTurns: readonly string[]): boolean {
  if (!nearMissDetailsAcceptEnabled()) return false;
  const text = reply.trim();
  if (!text || text.endsWith("?")) return false;
  const [first, ...surname] = words(asked);
  const last = surname.at(-1);
  if (!first || !last) return false;
  const typed = new Set(typedTurns.flatMap(words));
  if (!typed.has(first)) return false;
  if (![...typed].some((word) => word !== first && word.length >= 4 && editDistance(word, last) <= 2)) return false;
  if (/^(?:no|nope|wrong|not)\b/i.test(text) && statedPayrollDeduct(text.split(/[,.;!\n]/)[0] ?? "") === null) return false;
  return statedWarningLevel(text) !== null || statedPayrollDeduct(text) !== null;
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z'’-]*/g) ?? [];
}

/**
 * NEAR_MISS_DETAILS_ACCEPT_ENABLED: once the asked name is accepted, the whole name as typed is replaced by it, not
 * only the first name: "Corvina Ashdown Vellacot" became "Corvina Vellacott Ashdown Vellacot", which was again
 * close to the roster and asked again. The length of the typed words after the first name, up to and including the
 * one close to the asked surname's last word (at most three words), or 0. Off: 0.
 */
export function nearMissTypedRest(after: string, asked: string): number {
  if (!nearMissDetailsAcceptEnabled()) return 0;
  const last = words(asked).slice(1).at(-1);
  if (!last) return 0;
  const typed = /^(?:\s+[A-Za-z][A-Za-z'’-]*){1,3}/.exec(after)?.[0] ?? "";
  let end = 0;
  for (const found of typed.matchAll(/\s+([A-Za-z][A-Za-z'’-]*)/g)) {
    const word = found[1]!.toLowerCase();
    if (word.length >= 4 && editDistance(word, last) <= 2) end = found.index! + found[0].length;
  }
  return end;
}
