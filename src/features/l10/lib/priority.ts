// Ask Sunny and Ask Bubbles (not in the Leadership Hub). Port from Ask Bubbles. See src/features/l10/PARITY.md.
import { issueTerm } from "./doc";
import type { Issue } from "./types";

/*
 * Numbered priorities on the Bloom-style IDS page (the owner, 17 Nov 2026: "in ask sunny, we should be able to label
 * 1 2 3 and appear that they are indeed 1 2 3 in ranking"; the same request came from the sibling app's team).
 *
 * The issue keeps `priority: true` (the Hub's "!" mark, so the Hub's own page still shows it) and gains
 * `priorityOrder`, the order it was picked in (the Hub keeps fields it does not know). The numbers shown are worked
 * out from that order, per list (short term / long-term), over the open issues only: solving or un-marking an issue
 * closes the gap, so the room always sees 1, 2, 3…
 */

/** When it was picked; an issue marked before numbering existed (no order) counts as picked first. */
const orderOf = (i: Issue): number => (typeof i.priorityOrder === "number" && Number.isFinite(i.priorityOrder) ? i.priorityOrder : 0);

/** The number each open, marked issue shows (1, 2, 3…), in the order they were picked, per list. */
export function priorityNumbers(issues: readonly Issue[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const term of ["short", "long"] as const) {
    issues
      .map((issue, index) => ({ issue, index }))
      .filter(({ issue }) => issue.priority && !issue.resolved && issueTerm(issue) === term)
      .sort((a, b) => orderOf(a.issue) - orderOf(b.issue) || a.index - b.index)
      .forEach(({ issue }, n) => out.set(issue.id, n + 1));
  }
  return out;
}

/** Marks an issue as the next priority, or clears it (the others keep their order; their numbers close the gap). */
export function togglePriority(issues: readonly Issue[], id: string): Issue[] {
  const next = Math.max(0, ...issues.map(orderOf)) + 1;
  return issues.map((i) => {
    if (i.id !== id) return i;
    if (i.priority) {
      const copy = { ...i } as Record<string, unknown>;
      delete copy.priority;
      delete copy.priorityOrder;
      return copy as Issue;
    }
    return { ...i, priority: true, priorityOrder: next };
  });
}

/** The list order: numbered issues first (1, 2, 3…), then the rest in the order given. */
export function byPriority(list: readonly Issue[], numbers: ReadonlyMap<string, number>): Issue[] {
  const rank = (i: Issue) => numbers.get(i.id) ?? Number.POSITIVE_INFINITY;
  return list
    .map((issue, index) => ({ issue, index }))
    .sort((a, b) => rank(a.issue) - rank(b.issue) || a.index - b.index)
    .map(({ issue }) => issue);
}
