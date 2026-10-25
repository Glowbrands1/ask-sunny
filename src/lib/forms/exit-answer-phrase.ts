import { exitIntakeFixEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * "ITEMS RETURNED" IS AN ANSWER ON THE EXIT FORM, NOT A PERSON
 * ============================================================================
 *
 * Ported from the sibling app (live QA, 25 Oct 2026, conv_mvnt2u0o2ql6a0h).
 * "create an exit form for Test Employee at Lawrence. Gave notice 9/25/26 –
 * fulfilled 10/9/26, resigning to pursue other career options, items
 * returned, payroll deduction does not apply" put **Items Returned** on this
 * app's card as the employee (the sibling asked "Test Employee or items
 * returned?"). The name readers take "does not apply" for "not <person>",
 * which makes the turn a correction and each short comma clause a possible
 * name; the intent reading then takes the only two-word one.
 *
 * A candidate that is, in its own words, one of the exit form's Details
 * answers — items or the key returned or kept, payroll deduction, rehire,
 * minimum wage, the bonus — names nobody. The vocabulary is the one
 * `exit-details.ts` reads those answers with; this module stands alone so the
 * name readers can use it without importing the exit readers. Only with
 * EXIT_INTAKE_FIX_ENABLED. Pure and browser-safe.
 */
const THING = String.raw`(?:(?:store|salon)\s+)?(?:items?|uniforms?|shirts?|polos?|name ?tags?|badges?|aprons?|keys?|property|belongings)`;
const RETURNED = String.raw`(?:returned|turned in|brought back|given back|handed in|dropped off|kept)`;
const OWNER = String.raw`(?:(?:her|his|their|the|all|of)\s+)*`;

const ANSWER = new RegExp(
  [
    String.raw`${THING}(?:\s+(?:were|was|all|also|not|never|been))*\s+${RETURNED}`,
    String.raw`(?:returned|kept|turned in|brought back|gave back|dropped off)\s+${OWNER}${THING}`,
    String.raw`(?:no\s+)?payroll(?:\s+deduct(?:ion|ed)?)?`,
    String.raw`(?:no\s+)?deductions?`,
    String.raw`(?:not\s+)?(?:eligible\s+for\s+)?re-?hir(?:e|able)`,
    String.raw`min(?:imum|\.)?\s*wage`,
    String.raw`(?:no\s+)?bonus(?:\s+forfeit(?:ure|ed)?)?`,
  ]
    .map((alternative) => `(?:${alternative})`)
    .join("|")
    .replace(/^/, "^(?:")
    .concat(")$"),
  "i",
);

/** True when the flag is on and the candidate is one of the exit form's answers, not a person. */
export function isExitAnswerPhrase(candidate: string | null | undefined): boolean {
  if (!exitIntakeFixEnabled() || !candidate?.trim()) return false;
  const phrase = candidate
    .trim()
    .replace(/[’]/g, "'")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "")
    .replace(/\s+/g, " ");
  return ANSWER.test(phrase);
}
