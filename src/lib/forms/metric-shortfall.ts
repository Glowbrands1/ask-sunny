/**
 * ============================================================================
 * A SALES OR PERFORMANCE SHORTFALL THE MANAGER STATED
 * ============================================================================
 *
 * A metric named AND a judgement of it — "his sales are low", "her upgrades
 * are down". Read by `correctiveActionBasis` (corrective-action-intake.ts),
 * where it is the progression's metric-only case, and by
 * CA_SALES_POLICY_ENABLED's reading (`ca-policy.ts`), which cites the
 * Standards of Conduct for it. "The sales floor" names no shortfall.
 *
 * A leaf module, so both readers can use it without importing each other.
 * The two lists moved here unchanged from corrective-action-intake.ts
 * (ported from Ask Bubbles #426).
 */

const METRIC_NAMED: readonly RegExp[] = [
  /\bclub close\b/,
  /\b(?:close|closing) rate\b/,
  /\bconversion(?:s| rate)?\b/,
  /\bupgrade(?:s| rate|%| percentage)?\b/,
  /\befts?\b/,
  /\bmembership (?:%|percentage|rate|sales)\b/,
  /\bsales per hour\b/,
  /\b(?:sph|atv|kpis?)\b/,
  /\baverage ticket\b/,
  /\bred (?:%|percentage)\b/,
  /\b(?:her|his|their|the) (?:numbers|stats|metrics|scorecard|percentages)\b/,
  /\bdaily stats\b/,
  /\b(?:sales|revenue|units|packages) (?:are|is|have been|has been)\b/,
];

const METRIC_JUDGED: readonly RegExp[] = [
  /\b(?:low|lowest|down|below|behind|weak|weakest|poor|under|dropping|declining|slipping|worst|bottom|last)\b/,
  /\b(?:not hitting|missing|misses|failing to hit|under target|off target|below target|not meeting)\b/,
  /\bneeds? (?:to )?improve\b/,
];

/** The same reading `correctiveActionBasis` makes: lower case, runs of spaces as one. */
function normalize(text: string): string {
  return (text ?? "").toLowerCase().replace(/[^\S\n]+/g, " ");
}

/** Whether the manager stated a shortfall: a metric named and judged. */
export function statesMetricShortfall(text: string): boolean {
  const normalized = normalize(text);
  return METRIC_NAMED.some((pattern) => pattern.test(normalized)) && METRIC_JUDGED.some((pattern) => pattern.test(normalized));
}
