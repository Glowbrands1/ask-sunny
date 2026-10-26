/**
 * ============================================================================
 * THE ACTION PLAN THE MANAGER TYPED, AND ONLY THAT
 * ============================================================================
 *
 * Pau, 25 Oct 2026: when the manager typed no action plan, the form's Action
 * Plan stays blank — no "Management will review …" sentence, no closing, no
 * summary. A plan they did type is kept word for word.
 *
 * `managerTypedActionPlan` reads that plan from the manager's own words:
 * "action plan: …", "action plan - …", "the action plan is …", "plan of
 * action: …", "the plan is …". The text after the label is returned exactly as
 * typed, up to the end of the line or a sentence that gives another slot
 * ("No payroll deduct.", "This is a written."). The last plan stated wins.
 * A question, or "action plan: none", is not a plan.
 *
 * `replyWithManagerActionPlan` takes every Action Plan line off a reply and,
 * where the manager typed one, puts theirs back in the first line's place.
 *
 * Used only when ACTION_PLAN_MANAGER_ONLY_ENABLED is on. Pure.
 */

const PLAN_LABEL =
  /(?:^|[^A-Za-z])(?:(?:the|her|his|their|my)\s+)?(?:action\s*plan|plan\s+of\s+action|plan)\s*(?::|=|[-–—](?=\s)|\bis\b(?:\s+to\b(?=\s))?|\bwill\s+be\b|\bshould\s+be\b)[ \t]*/gi;

/** A label must be "action plan" / "plan of action", or "the/her … plan". A bare "plan" after other words is not one. */
function isPlanLabel(match: RegExpExecArray): boolean {
  const label = match[0].replace(/^[^A-Za-z]/, "").toLowerCase();
  if (/action\s*plan|plan\s+of\s+action/.test(label)) return true;
  return /^(?:the|her|his|their|my)\s+plan\b/.test(label);
}

/** Not a plan: nothing, a placeholder, or a complaint about the plan. */
const NOT_A_PLAN = /^(?:none|n\/a|na|nothing|blank|empty|missing|wrong|incorrect|not\b|tbd|-+)[.!]?$|^(?:blank|empty|missing|wrong|incorrect|not\s+right)\b/i;

/** A sentence that gives another slot, not more of the plan. */
const OTHER_SLOT =
  /^(?:no\s+payroll|payroll|verbal|written|this\s+is\s+an?\b|this\s+one\s+is|it'?s\s+an?\s+(?:verbal|written)|prior|previous(?:ly)?|date\b|salon\b|location\b|job\s+title|title\b|employee\b|warning\b|policy\b|[A-Za-z][A-Za-z ]{0,30}:\s)/i;

/** The plan the manager typed, word for word, or null when they typed none. */
export function managerTypedActionPlan(text: string | readonly string[]): string | null {
  const source = typeof text === "string" ? text : text.join("\n");
  let found: string | null = null;
  for (const match of source.matchAll(PLAN_LABEL)) {
    if (!isPlanLabel(match as RegExpExecArray)) continue;
    const start = match.index! + match[0].length;
    const lineEnd = source.indexOf("\n", start);
    const line = source.slice(start, lineEnd === -1 ? undefined : lineEnd);
    const plan = withoutOtherSlots(line).trim();
    if (plan === "" || plan.endsWith("?") || NOT_A_PLAN.test(plan)) continue;
    found = plan;
  }
  return found;
}

/** The line up to the first later sentence that gives another slot. */
function withoutOtherSlots(line: string): string {
  const boundary = /[.!?]\s+/g;
  for (const stop of line.matchAll(boundary)) {
    const next = line.slice(stop.index! + stop[0].length);
    if (OTHER_SLOT.test(next)) return line.slice(0, stop.index! + 1);
  }
  return line;
}

/** "**Action Plan:** …" / "**Action plan:** …" / "- **Action Plan**: …", one line. */
const PLAN_LINE = /^[ \t]*(?:[-*•][ \t]+)?\*\*Action plan:?\*\*:?[^\n]*(?:\n|$)/gim;

/**
 * The reply with no Action Plan but the manager's. Every Action Plan line is
 * removed; the manager's plan, when they typed one, goes where the first one
 * was, or at the end when there was none.
 */
export function replyWithManagerActionPlan(content: string, managerTurns: readonly string[], label: string): string {
  const typed = managerTypedActionPlan(managerTurns);
  const wanted = typed ? `**${label}:** ${typed}` : null;
  const lines = [...content.matchAll(PLAN_LINE)];
  if (lines.length === 0) {
    if (!wanted) return content;
    return content.trim() ? `${content.trimEnd()}\n\n${wanted}` : wanted;
  }
  if (wanted && lines.length === 1 && lines[0]![0].trim() === wanted) return content;
  const marker = "\u0000plan\u0000";
  let first = true;
  const replaced = content.replace(PLAN_LINE, (line) => {
    const keep = first && wanted ? `${marker}${line.endsWith("\n") ? "\n" : ""}` : "";
    first = false;
    return keep;
  });
  return replaced
    .replace(/\n{3,}/g, "\n\n")
    .replace(marker, wanted ?? "")
    .trim();
}
