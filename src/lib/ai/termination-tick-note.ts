import { terminationTickNoteEnabled } from "@/lib/config/chat-quality-flags";
import { extractEmployeeNames, samePerson } from "@/lib/forms/proposal";
import { statesTermination } from "@/lib/forms/termination-stated";
import { detectTemplateIntent } from "@/lib/forms/template-intent";

import type { AskRequest, AskResponse } from "./types";

/**
 * ============================================================================
 * A TERMINATION THE APP DOES NOT TICK IS THE MANAGER'S TO TICK (TERMINATION_TICK_NOTE_ENABLED)
 * ============================================================================
 *
 * QA, 15 Nov 2026 (the termination scan; same flag in both apps): when the manager's words mention termination but the
 * stated-termination reader (`forms/termination-stated.ts`, TERMINATION_STATED_TICKS) does not tick it — "my DM
 * approved her termination, write up the CA", "create a termination for <A>" — the card's only level line was "You'll
 * set the verbal/written warning level on the form — I won't guess at it.", which never says Termination. With the
 * flag TERMINATION_TICK_NOTE is added beside that line (never in its place), the agent loop's hedge wording too.
 * A termination the reader ticks is left to `ai/termination-stated.ts`; nothing here ticks anything. Off, as built.
 */
/*
 * QA's re-review (15 Nov 2026): a false note is cheap when it is worded neutrally, and a missing level prompt is harmful.
 * Conditional and future mentions ("if she does it again she will be terminated", "next time it's termination", "we
 * might terminate her later") still read as a mention, so the note never replaces the verbal/written line: it is added
 * beside it, conditional on the form being a termination.
 */
export const TERMINATION_TICK_NOTE = "If this form is a termination, tick Termination on the form yourself; it needs DM/HR approval before it's finalized.";

const CORRECTIVE = /corrective action/i;
const BOTH_ASKED =
  /You'll set the verbal\/written warning level and any prior coaching or corrective action on the form — I won't guess at them\./;
const LEVEL_ASKED = /You'll set the verbal\/written warning level on the form — I won't guess at it\./;
/** The manager's words mention termination at all ("terminate", "termination", "terminated", "term CA"). */
const MENTIONS = /\bterminat(?:e|ed|es|ing|ion)\b|\bterm\s+(?:ca|c\/a)\b/i;
/**
 * QA's review of #1010 (15 Nov 2026): "I don't want to terminate her, just document the lateness" and "she is not being
 * terminated, write up …" say no termination. A clause with a negation in it never counts; nor does a question ("what
 * is the termination policy?", "should we terminate her?").
 */
const NEGATION = /\b(?:not|no|never|don['’]?t|doesn['’]?t|didn['’]?t|won['’]?t|isn['’]?t|aren['’]?t|wasn['’]?t|without|rather\s+than|instead\s+of|avoid)\b|n['’]t\b/i;
const QUESTION_LEAD = /^(?:how|what|why|when|where|who|which|should|shall|do|does|did|can|could|would|will|is|are|was|were|may|might)\b/i;

/**
 * QA round 3 (15 Nov 2026): "no call no showed" / "no-show" is the REASON for the termination, not a negation of it
 * ("Marnie Holloway no call no showed so we're terminating her"). Blanked before the negation test.
 */
const ATTENDANCE_NO = /\bno[\s-]*call[\s/,-]*no[\s-]*show(?:s|ed|ing)?\b|\bno[\s-]+shows?(?:ed|ing)?\b|\bno[\s-]*call\b/gi;

/** The clauses of a turn that state a termination: no negation, not a question. */
function statesTerminationClause(turn: string): boolean {
  for (const sentence of turn.split(/(?<=[.!?])\s+|\n+/)) {
    const trimmed = sentence.trim();
    if (!MENTIONS.test(trimmed) || /\?\s*$/.test(trimmed) || QUESTION_LEAD.test(trimmed)) continue;
    const clause = trimmed.split(/\s*[,;]\s*|\s+(?:but|just|only)\s+/i).find((part) => MENTIONS.test(part)) ?? trimmed;
    if (!NEGATION.test(clause.replace(ATTENDANCE_NO, " "))) return true;
  }
  return false;
}

/**
 * The manager's turns for THIS card's request, latest last: back from this turn until an earlier turn names somebody
 * else, so another person's termination, or one discussed before this request, is never read onto this card.
 */
function thisRequestsTurns(request: AskRequest, employee: string | null | undefined): string[] {
  const turns = [...(request.history ?? []).filter((turn) => turn.role === "user").map((turn) => String(turn.content)), request.question];
  const kept: string[] = [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    const named = extractEmployeeNames(turn);
    const someoneElse = employee ? named.some((name) => !samePerson(name, employee)) && !named.some((name) => samePerson(name, employee)) : false;
    if (someoneElse) break;
    kept.unshift(turn);
    if (employee && named.some((name) => samePerson(name, employee))) {
      // Before the turn that named them, only the form request that named nobody ("create a termination CA" → "who?").
      for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
        const before = turns[earlier]!;
        if (extractEmployeeNames(before).length > 0) break;
        if (detectTemplateIntent(before).kind !== "none") {
          kept.unshift(before);
          break;
        }
      }
      break;
    }
  }
  return kept;
}

export function withTerminationTickNote(response: AskResponse, request: AskRequest): AskResponse {
  if (!terminationTickNoteEnabled()) return response;
  const proposal = response.formProposal;
  if (!proposal || !(proposal.templateKey === "dpoa" || CORRECTIVE.test(proposal.templateName ?? ""))) return response;
  if (proposal.warningLevel) return response;
  const turns = thisRequestsTurns(request, proposal.employeeName);
  const said = turns.join("\n");
  if (!turns.some(statesTerminationClause) || statesTermination(said)) return response;
  let content = response.content;
  if (content.includes(TERMINATION_TICK_NOTE)) return response;
  const lines = content.split("\n");
  // The note goes on its own line right after the level line (kept as it is), or after the opening line with none.
  const level = lines.findIndex((line) => BOTH_ASKED.test(line) || LEVEL_ASKED.test(line));
  lines.splice(level >= 0 ? level + 1 : Math.min(1, lines.length), 0, "", TERMINATION_TICK_NOTE);
  content = lines.join("\n");
  return { ...response, content: content.replace(/\n{3,}/g, "\n\n").trim() };
}
