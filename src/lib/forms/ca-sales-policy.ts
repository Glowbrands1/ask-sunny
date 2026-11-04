import { STANDARDS_OF_CONDUCT, withStatedOffense } from "./ca-policy";

/**
 * ============================================================================
 * SALES AND MSB CORRECTIVE ACTIONS CITE THE STANDARDS OF CONDUCT
 * (CA_SALES_POLICY_ENABLED, default off; client request relayed by Pau,
 * 4 Nov 2026; ported from Ask Bubbles #422)
 * ============================================================================
 *
 * Every Corrective Action for sales performance or for MSB (Must See
 * Behaviors) cites the manual's Standards of Conduct, by the heading and page
 * of the retrieved section. Three parts, all only with the flag on:
 *
 *   THE READING (`ca-policy.ts`, `withSalesPolicy`): an account that reads as
 *     the Under Performance offense type, or uses a chat glossary term, is read
 *     as the Standards of Conduct; the card says so and the draft ticks it.
 *   THE OFFENSE TYPE (`withSalesOffense`, here): the drafting model's Under
 *     Performance tick is the Standards of Conduct box, where nothing else
 *     settled the box first.
 *   ONE PROMPT LINE (`CA_SALES_POLICY_RULE`), added after the existing Type of
 *     Offense line, which is not changed.
 *
 * Direct policy is then built from the ticked box by the existing policy
 * fields code: the approved manual, its section heading and page. No quote is
 * composed here.
 */

/** The drafting model's added Type of Offense line. */
export const CA_SALES_POLICY_RULE = `Type of Offense, sales and Must See Behaviors: a corrective action for sales performance or goals, for Must See Behaviors (MSB), or for ringing up a sale inaccurately is ${STANDARDS_OF_CONDUCT}, not under_performance.`;

const UNDER_PERFORMANCE = "under_performance";

/**
 * The drafting model's Under Performance tick, as the Standards of Conduct.
 * Null when it did not tick Under Performance, or the version does not offer
 * the Standards of Conduct box. The model's other ticks stay.
 */
export function withSalesOffense(input: {
  checked: Record<string, string[]>;
  values: Record<string, string>;
  offered: readonly string[];
}): ReturnType<typeof withStatedOffense> | null {
  const ticked = input.checked.offense_type ?? [];
  if (!ticked.includes(UNDER_PERFORMANCE) || !input.offered.includes(STANDARDS_OF_CONDUCT)) return null;
  const keys = [...new Set(ticked.map((key) => (key === UNDER_PERFORMANCE ? STANDARDS_OF_CONDUCT : key)))];
  return withStatedOffense({ checked: input.checked, values: input.values, keys, offered: input.offered });
}
