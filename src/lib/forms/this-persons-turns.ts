import type { BoundedContext } from "./bounded-context";
import { detectTemplateIntent } from "./template-intent";

/**
 * ============================================================================
 * A CARD CITES THIS PERSON'S REQUEST, NOT THE PERSON BEFORE THEM
 * ============================================================================
 *
 * THIS_PERSONS_TURNS_ENABLED (QA, live check B2, 31 Oct 2026; same flag in
 * both apps). In one chat: "create a coaching form for Marnie Holloway",
 * Marnie's coaching details, then "create a coaching form for remy calder".
 * Remy's card cited every manager turn — Marnie's request and her details
 * included — and Create sends the cited turns as the draft's notes, so Remy's
 * draft was written from Marnie's.
 *
 * The turns kept: the last one that names this card's employee and every turn
 * after it; and the turns before it back to a form request that names nobody
 * ("create a coaching form" → "who is it for?" → "remy calder"), or back to
 * the start when no earlier turn names somebody else. Turns that follow an
 * earlier person's request belong to that person. Pure; the name reader is the
 * caller's (`extractEmployeeNames`).
 */
export function turnsFromThisPersonsRequest(
  context: Pick<BoundedContext, "messages" | "ids">,
  employeeName: string | null,
  read: { names: (text: string) => string[]; same: (a: string, b: string) => boolean },
): string[] {
  if (!employeeName) return context.ids;
  const turns = context.messages;
  const named = turns.map((turn) => read.names(turn.content));
  let last = -1;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (named[index]!.some((name) => read.same(name, employeeName))) {
      last = index;
      break;
    }
  }
  if (last < 0) return context.ids;
  let start = last;
  for (let index = last - 1; index >= 0; index -= 1) {
    if (named[index]!.some((name) => !read.same(name, employeeName))) break;
    if (named[index]!.length === 0 && detectTemplateIntent(turns[index]!.content).kind === "none") {
      if (index === 0) start = 0;
      continue;
    }
    start = index;
    if (named[index]!.length === 0) break;
  }
  const kept = new Set(turns.slice(start).flatMap((turn) => (turn.id ? [turn.id] : [])));
  return context.ids.filter((id) => kept.has(id));
}
