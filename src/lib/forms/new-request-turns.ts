import { draftReuseNewRequestEnabled, newRequestOwnTurnsEnabled } from "@/lib/config/chat-quality-flags";
import { extractEmployeeNames, samePerson } from "@/lib/forms/proposal";
import { detectTemplateIntent } from "@/lib/forms/template-intent";

/**
 * ============================================================================
 * A NEW REQUEST FOR THE SAME PERSON IS DRAFTED FROM ITS OWN TURNS
 * ============================================================================
 *
 * NEW_REQUEST_OWN_TURNS_ENABLED. The 2 Nov 2026 scan: "The card showed 'Late
 * Opening' as the policy, but the saved draft says Standards of Conduct. In the
 * same chat, a new late-opening request reused an older trash-and-rugs
 * incident". The first Corrective Action was asked for in pieces — "a CA",
 * then "<name> failed to take trash out and put rugs out untl 12;30pm" — so
 * no earlier turn both asked for the form and named her, and the rule that
 * starts a new request over from itself never fired. The second request,
 * "make me a CA for <name> for being late to opening this morning", was
 * drafted from both incidents, and its policy from the older one.
 *
 * Applied to the card the turn produced, whichever reader made it: when the
 * card's turns run back past the latest turn that asks for this form for this
 * person AND says what it is about, and an earlier turn of the card was
 * already about this person (an earlier request's account), the card's turns
 * start at that request. A request that only repeats ("a CA for <name>") keeps the account
 * already given.
 */

interface Turn {
  readonly id?: string;
  readonly role: string;
  readonly content: string;
}

interface Card {
  readonly templateKey: string;
  readonly employeeName: string | null;
  readonly sourceMessageIds: readonly string[];
}

/** The words of a request beyond the form and the name. */
function aboutWords(text: string, employeeName: string): string[] {
  const name = new Set(employeeName.toLowerCase().split(/\s+/));
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter((word) => word && !name.has(word))
    .filter((word) => !/^(?:make|me|a|an|the|create|start|do|please|can|you|for|ca|c\/a|corrective|action|form|coaching|verbal|written|warning|new|another|i|need|want|to)$/.test(word));
}

/** "for being late to opening this morning": the request says more than the form and the name. */
function saysWhatItIsAbout(text: string, employeeName: string): boolean {
  return aboutWords(text, employeeName).length >= 3;
}

export function withOwnRequestTurns<T extends { formProposal?: Card | null }>(
  answer: T,
  turns: readonly Turn[],
): T {
  const card = answer.formProposal;
  if (!newRequestOwnTurnsEnabled() || !card?.employeeName || card.sourceMessageIds.length < 2) return answer;
  const sources = new Set(card.sourceMessageIds);
  const manager = turns.filter((turn) => turn.role === "user" && turn.id && sources.has(turn.id));
  let requestAt = -1;
  for (let index = manager.length - 1; index > 0; index -= 1) {
    const turn = manager[index]!;
    const named = extractEmployeeNames(turn.content).some((name) => samePerson(name, card.employeeName!));
    if (named && detectTemplateIntent(turn.content).kind !== "none" && saysWhatItIsAbout(turn.content, card.employeeName)) {
      requestAt = index;
      break;
    }
  }
  if (requestAt <= 0) return answer;
  // An earlier turn of this card already about this person: the account of an earlier request for them.
  const earlierAccount = manager
    .slice(0, requestAt)
    .some((turn) => extractEmployeeNames(turn.content).some((name) => samePerson(name, card.employeeName!)));
  if (!earlierAccount) return answer;
  const kept = new Set(manager.slice(requestAt).map((turn) => turn.id!));
  return { ...answer, formProposal: { ...card, sourceMessageIds: card.sourceMessageIds.filter((id) => kept.has(id)) } };
}

/*
 * DRAFT_REUSE_NEW_REQUEST_ENABLED (the 2 Nov scan, nov2-p2; QA: "yes", 3 Nov
 * 2026). With CONVERSATION_DRAFT_REUSE on, Create in a chat that already made
 * a draft of this form for this person reuses that draft — right for "add
 * this to it", wrong for a new incident. "make me a CA for <name> for being
 * late to opening this morning", said after the trash-and-rugs draft, reused
 * that draft, so the late opening never got its own. A manager turn since the
 * earlier draft that asks for this form for this person AND says what it is
 * about is a new request: the earlier draft is not reused.
 */
export function newRequestSinceDraft(input: {
  readonly turns: readonly Turn[];
  /** The last turn the earlier draft was made from; null when it recorded none. */
  readonly lastTurnId: string | null;
  readonly employeeName: string;
}): boolean {
  if (!draftReuseNewRequestEnabled() || !input.lastTurnId || !input.employeeName.trim()) return false;
  const at = input.turns.findIndex((turn) => turn.id === input.lastTurnId);
  if (at < 0) return false;
  // Everything said before a request: the earlier draft's account and the changes made to it since. A
  // request that says it again ("the same long request sent twice") is the same incident, reused as before.
  return input.turns.some((turn, index) => {
    if (index <= at || turn.role !== "user") return false;
    if (detectTemplateIntent(turn.content).kind === "none") return false;
    if (!extractEmployeeNames(turn.content).some((name) => samePerson(name, input.employeeName))) return false;
    const said = new Set(
      input.turns
        .slice(0, index)
        .filter((earlier) => earlier.role === "user")
        .flatMap((earlier) => aboutWords(earlier.content, input.employeeName)),
    );
    // New when most of what it is about was not said before: "late to opening this morning" after the
    // trash and rugs. A few new words in a request that repeats the account are the same incident.
    const about = aboutWords(turn.content, input.employeeName);
    const fresh = about.filter((word) => !said.has(word)).length;
    return fresh >= 3 && fresh * 2 >= about.length;
  });
}
