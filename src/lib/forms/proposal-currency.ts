import "server-only";

import { firstNameSuggestAccepted } from "@/lib/ai/first-name-suggest";
import { staleNeedsRosterPersonEnabled } from "@/lib/config/chat-quality-flags";
import { firstNameSuggestEnabled, partialNameCardCurrentEnabled } from "@/lib/config/chat-quality-flags";

import { acceptedNameSuggestions } from "./employee-match";
import { isQuestion } from "./employment-change";
import { employeeState, managerContext, samePerson } from "./proposal";
import { detectTemplateIntent } from "./template-intent";
import { dateAnswerTurns } from "./incident-dates";
import { isPayrollAnswer } from "./payroll-words";
import { stateCodePlaceContext } from "./state-code-place";
import { checkedReadingEnabled } from "@/lib/config/chat-quality-flags";
import type { ChatMessage } from "@/types";

/**
 * ============================================================================
 * AN OLD CARD MUST NEVER FILE A FORM FOR THE WRONG PERSON
 * ============================================================================
 *
 * Production QA, 30 September 2026: after the manager corrected the employee,
 * the card from BEFORE the correction was still on screen with its Create
 * button. The chat now marks such a card superseded and offers nothing on it
 * (`isProposalSuperseded`), but a card lives in browser storage and a button
 * the browser hides is not a guarantee. So creation checks again, here, what
 * the CONVERSATION now says — read by the same code that made the proposal:
 *
 *   THE EMPLOYEE   re-resolved from the manager's own turns with
 *                  `employeeState`. A different person, two people, or a person
 *                  the manager has since said it is NOT for — refused.
 *   THE FORM       the most recent form the manager ASKED FOR in a statement
 *                  (a question such as "is there a transfer form?" asks for
 *                  nothing). A different form — refused.
 *
 * WHAT THIS IS NOT. It is not an authorization check; the template's own
 * permission and the salon scope are enforced by the route as before, and the
 * manual builder may still file for any name typed into it. It answers one
 * question — is this proposal still the one the conversation stands behind? —
 * and where the conversation cannot say (the turns that named the person have
 * scrolled out of the window), it does not refuse on a guess.
 */
export type ProposalCurrency = { current: true } | { current: false; reason: string };

export function checkProposalIsCurrent(input: {
  conversation: readonly { id?: string; role: ChatMessage["role"]; content: string }[];
  templateKey: string;
  employeeName: string;
  /**
   * STALE_NEEDS_ROSTER_PERSON_ENABLED: the manager's roster, from
   * `rosterNamesFor`. Undefined: names are read as before.
   */
  rosterNames?: readonly string[];
}): ProposalCurrency {
  // An answer to "Which date goes on the form?" ("most recent") is not a name: see `dateAnswerTurns`.
  const answers = dateAnswerTurns(input.conversation);
  const turns = input.conversation.filter(
    (message) =>
      message.role === "user" &&
      typeof message.content === "string" &&
      message.content.trim() !== "" &&
      !answers.has(message.content.trim()) &&
      // PAYROLL_TYPO_NOT_A_NAME_ENABLED: "yes payrol ldeduct" answers the payroll question; it names nobody.
      !isPayrollAnswer(message.content),
  );
  const last = turns[turns.length - 1];
  if (!last) return { current: true };

  // An id is provenance only; one the history arrived without is simply absent.
  const prior = turns.slice(0, -1).map((turn) => ({ id: turn.id ?? "", role: turn.role, content: turn.content }));
  const context = managerContext(prior, { id: last.id, content: last.content });
  let state = employeeState(context);
  // STATE_CODE_NOT_A_PERSON_ENABLED: "at Dodge, NE" is a place; the turns are read again without it.
  const placed = stateCodePlaceContext(context, state.resolution);
  if (placed) state = employeeState(placed);
  const { excluded } = state;
  /*
   * STALE_NEEDS_ROSTER_PERSON_ENABLED. A manager's exit in the sibling app, 29 Oct
   * 2026: "… drop wage and forfeit bonus. not eligible for rehire …" — a right
   * card refused as the conversation "now names more than one person
   * (<the person>, drop wage, forfeit bonus)". With the manager's roster, a
   * name that is neither the card's person (as typed) nor somebody on the
   * roster is not another person; two people on the roster still refuse.
   */
  const resolution = notOtherPeople(state.resolution, input);

  if (resolution.kind === "ambiguous") {
    return {
      current: false,
      reason: `This proposal is out of date: the conversation now names more than one person (${resolution.candidates.join(", ")}). Tell Sunny which one the form is for, then use the newest proposal.`,
    };
  }
  /*
   * "KATLIN" ANSWERED WITH "YES" TO "DID YOU MEAN KAITLYN SMITH?" is still the
   * same person: the manager chose the directory's spelling for what they
   * typed. Only a name they ACCEPTED in this conversation counts — see
   * `acceptedNameSuggestions`. The proposal path re-checked it against the
   * actor's scoped roster before the card ever offered it.
   */
  /*
   * FIRST_NAME_SUGGEST_ENABLED: a name accepted from "Is this for **…**?" /
   * "Did you mean …" covers what the manager typed for it — "katrin dov",
   * "katrin dovtail", "kit dov", "ashby": every word the conversation reads
   * begins a word of the accepted name, or the manager had already typed it
   * when they answered. A later turn naming somebody else is still a
   * correction.
   */
  /*
   * "This isn't for katrin dovetail" after "katrin dov" was accepted: the
   * manager excluded the card's own person, so neither acceptance below may
   * let the card through (audit, 29 Oct 2026). Only with those paths on.
   */
  if (
    (firstNameSuggestEnabled() || partialNameCardCurrentEnabled()) &&
    excluded.some((not) => samePerson(not, input.employeeName) || typedFor(not, input.employeeName))
  ) {
    return {
      current: false,
      reason: `This proposal is out of date: you said the form is not for ${input.employeeName}. Tell Sunny who it is for.`,
    };
  }
  const suggested = firstNameSuggestAccepted(input.conversation).some(
    ({ name, answeredAt }) =>
      name.trim().toLowerCase() === input.employeeName.trim().toLowerCase() &&
      resolution.kind === "resolved" &&
      (typedFor(resolution.employeeName, name) || typedBy(input.conversation.slice(0, answeredAt + 1), resolution.employeeName)),
  );
  /*
   * PARTIAL_NAME_CARD_CURRENT_ENABLED: the AI reader filled "katrin dov" as
   * the roster's Katrin Dovetail, with no question asked; the card is still
   * the person the manager typed.
   */
  const partial =
    partialNameCardCurrentEnabled() && resolution.kind === "resolved" && typedFor(resolution.employeeName, input.employeeName);
  const accepted = suggested || partial || acceptedNameSuggestions(input.conversation).some(
    (name) => name.trim().toLowerCase() === input.employeeName.trim().toLowerCase(),
  );
  if (
    resolution.kind === "resolved" &&
    !samePerson(resolution.employeeName, input.employeeName) &&
    !accepted &&
    !(checkedReadingEnabled() && partOfName(resolution.employeeName, input.employeeName))
  ) {
    return {
      current: false,
      reason: `This proposal is out of date: the conversation now says the form is for ${resolution.employeeName}, not ${input.employeeName}. Use the newest proposal.`,
    };
  }
  if (resolution.kind === "missing" && excluded.some((not) => samePerson(not, input.employeeName))) {
    return {
      current: false,
      reason: `This proposal is out of date: you said the form is not for ${input.employeeName}. Tell Sunny who it is for.`,
    };
  }

  for (const message of [...context.messages].reverse()) {
    if (isQuestion(message.content)) continue;
    const intent = detectTemplateIntent(message.content);
    const asked =
      intent.kind === "explicit"
        ? intent.templateKey
        : intent.kind === "corrective_action" && intent.requestedCreation
          ? "dpoa"
          : null;
    if (asked === null) continue;
    if (asked !== input.templateKey) {
      return {
        current: false,
        reason: "This proposal is out of date: the conversation has since asked for a different form. Use the newest proposal.",
      };
    }
    break;
  }

  return { current: true };
}

/**
 * AI_READS_CODE_CHECKS_ENABLED or LAST_FIRST_NAME_READ_ENABLED: the conversation's "Marlowe" (from "Marlowe,
 * Quinn") or "quinn" is part of the card's "Quinn Marlowe", not another
 * person. The card's full name came from the one roster person those words
 * fit (`ai/reader/check.ts`); the conversation reader only stops sooner.
 */
function partOfName(said: string, card: string): boolean {
  const words = (text: string) => text.toLowerCase().split(/[^a-z']+/).filter(Boolean);
  const full = words(card);
  const part = words(said);
  return part.length > 0 && part.every((word) => full.includes(word));
}

function notOtherPeople(
  resolution: ReturnType<typeof employeeState>["resolution"],
  input: { employeeName: string; rosterNames?: readonly string[] },
): ReturnType<typeof employeeState>["resolution"] {
  const roster = input.rosterNames;
  if (!staleNeedsRosterPersonEnabled() || resolution.kind !== "ambiguous" || !roster || roster.length === 0) return resolution;
  const cardPerson = (name: string) => samePerson(name, input.employeeName) || typedFor(name, input.employeeName);
  const onRoster = (name: string) => {
    const said = name.toLowerCase().match(/[a-z][a-z'’-]*/g) ?? [];
    return roster.some((person) => {
      const words = person.toLowerCase().match(/[a-z][a-z'’-]*/g) ?? [];
      return said.length > 0 && said[0] === words[0] && (said.length === 1 || typedFor(name, person));
    });
  };
  const people = resolution.candidates.filter((name) => cardPerson(name) || onRoster(name));
  if (!people.some(cardPerson) || people.some((name) => !cardPerson(name))) return resolution;
  return { kind: "resolved", employeeName: people.find(cardPerson)! };
}

/** A manager turn up to the answer already said `typed`. */
function typedBy(turns: readonly { readonly role: string; readonly content: string }[], typed: string): boolean {
  const plain = (text: string) => ` ${(text.toLowerCase().match(/[a-z][a-z'’-]*/g) ?? []).join(" ")} `;
  const said = plain(typed);
  return said.trim().length > 0 && turns.some((turn) => turn.role === "user" && plain(turn.content).includes(said));
}

/** Every word of `typed` begins a word of `name`: "katrin dov" and "ashby" were typed for Katrin Dovetail and Quinn Ashby. */
function typedFor(typed: string, name: string): boolean {
  const words = (text: string) => text.toLowerCase().match(/[a-z][a-z'’-]*/g) ?? [];
  const full = words(name);
  const said = words(typed);
  return said.length > 0 && said.every((word) => word.length >= 2 && full.some((part) => part.startsWith(word)));
}
