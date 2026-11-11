import { outlineOnOpenProposalEnabled } from "@/lib/config/chat-quality-flags";


/*
 * ============================================================================
 * AN OUTLINE PASTED ON AN OPEN PROPOSAL NEVER COSTS THE PROPOSAL ITS FACTS (OUTLINE_ON_OPEN_PROPOSAL_ENABLED)
 * ============================================================================
 *
 * Ported from the sibling app: QA's Bubbles 17i live test (11 Nov 2026); reproduced here, on a proposal (Create never pressed): (a) "create a corrective action for
 * <A>, she was late on 11/3/26" made the card (Issue, Attendance p.14); (b) an "Observation of Offense: … / Action
 * Plan: …" outline written for another person, pasted next, was ignored; (c) "same outline but with <A first>'s info"
 * left the card with no Issue, no Policy and a generic plan (in the replay pack, the outline's date became <A>'s). The
 * card is re-read from the manager's turns every time, and the outline — another person's account — was read as hers.
 *
 * With the flag on and no form open, a pasted labelled outline and a turn asking for "the same outline" are no account:
 * they are left out of the re-read, and such a turn is read as the request before it, so step (a)'s Issue, date, Policy
 * and plan are kept. The reply says the outline is kept as the layout for her form, with her own details. Pure.
 */

/** Two or more "<Label>:" lines: a pasted labelled outline ("Observation of Offense: … / Action Plan: …"). */
const LABEL_LINE = /(?:^|\n)[ \t]*[A-Z][A-Za-z /&'’-]{3,40}[ \t]*:/g;
function looksLikePastedTemplate(text: string): boolean {
  return (text.match(LABEL_LINE) ?? []).length >= 2;
}

const SAME_OUTLINE = /\b(?:same|this|that|the)\s+(?:outline|template|format|layout)\b/i;

/** A pasted labelled outline, or a turn asking for "the same outline …". */
export function isOutlineTurn(text: string): boolean {
  return looksLikePastedTemplate(text) || SAME_OUTLINE.test(text);
}

interface Turn {
  readonly id?: string;
  readonly role: string;
  readonly content: string;
}

interface Asked<T extends Turn> {
  readonly question: string;
  readonly history: readonly T[];
  readonly activeFormInstanceId?: string | null;
}

/**
 * The request as the proposal re-read takes it: outline turns left out of the history, and an outline turn read as the
 * manager's last request before it. `outline` is true when this turn was an outline turn. Null when nothing changes.
 */
export function withoutOutlineTurns<T extends Turn, A extends Asked<T>>(asked: A): { asked: A; outline: boolean; requestId?: string } | null {
  if (!outlineOnOpenProposalEnabled() || asked.activeFormInstanceId) return null;
  const outline = isOutlineTurn(asked.question);
  const kept = asked.history.filter((turn) => !(turn.role === "user" && isOutlineTurn(turn.content)));
  if (!outline && kept.length === asked.history.length) return null;
  if (!outline) return { asked: { ...asked, history: kept }, outline: false };
  const request = [...kept].reverse().find((turn) => turn.role === "user" && turn.content.trim() !== "");
  if (!request) return null;
  return { asked: { ...asked, history: kept, question: request.content }, outline: true, ...(request.id ? { requestId: request.id } : {}) };
}

interface CardLike {
  readonly employeeName: string | null;
  readonly templateName?: string;
  readonly sourceMessageIds?: readonly string[];
}

/** On the outline turn, the reply says the outline is kept as the layout for her form, with her own details. */
export function withOutlineKeptNote<T extends { content: string; formProposal?: CardLike | null }>(
  answer: T,
  cited?: { readonly outlineTurnId?: string; readonly requestId?: string },
): T {
  const card = answer.formProposal;
  if (!card?.employeeName) return answer;
  // The card cites the request it was read from, never the outline turn, so Create's notes are her account.
  const ids = card.sourceMessageIds;
  const sourceMessageIds =
    ids && cited?.outlineTurnId && cited.requestId
      ? [...new Set(ids.map((id) => (id === cited.outlineTurnId ? cited.requestId! : id)))]
      : ids;
  const form = card.templateName ?? "form";
  const note = `I've kept your outline as the layout for **${card.employeeName}**'s ${form}, with ${card.employeeName.split(/\s+/)[0]}'s own details — nothing from the person in the outline goes on this card. Nothing above has changed.`;
  return { ...answer, content: `${note}\n\n${answer.content}`, formProposal: { ...card, ...(sourceMessageIds ? { sourceMessageIds } : {}) } };
}

/**
 * The draft's notes (the manager's turns, a blank line between them) without the outline turns: the pasted outline is
 * another person's account, and "same outline but with <A>'s info" is no account, so neither person's name, date or
 * events from the outline reach <A>'s draft (QA, 11 Nov 2026). The form's own fields give the layout (Observation of
 * Offense, Action Plan …); the content comes only from <A>'s turns. Unchanged with the flag off, or when every turn is
 * an outline turn.
 */
export function notesWithoutOutline(notes: string): string {
  if (!outlineOnOpenProposalEnabled()) return notes;
  const turns = notes.split(/\n{2,}/);
  const kept = turns.filter((turn) => !isOutlineTurn(turn));
  return kept.length === turns.length || kept.length === 0 ? notes : kept.join("\n\n");
}
