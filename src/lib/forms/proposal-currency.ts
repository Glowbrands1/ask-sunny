import "server-only";

import { differentEmployeeNewFormEnabled } from "@/lib/config/chat-quality-flags";

import { acceptedNameSuggestions } from "./employee-match";
import { isQuestion } from "./employment-change";
import { namingTheForm } from "./other-employee";
import { employeeState, managerContext, samePerson } from "./proposal";
import { detectTemplateIntent } from "./template-intent";
import { dateAnswerTurns } from "./incident-dates";
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
}): ProposalCurrency {
  // An answer to "Which date goes on the form?" ("most recent") is not a name: see `dateAnswerTurns`.
  const answers = dateAnswerTurns(input.conversation);
  const turns = input.conversation.filter(
    (message) =>
      message.role === "user" &&
      typeof message.content === "string" &&
      message.content.trim() !== "" &&
      !answers.has(message.content.trim()),
  );
  const latest = turns[turns.length - 1];
  if (!latest) return { current: true };
  /*
   * "NOW ONE FOR CASEY …" read as the chat read it when it made the card
   * (DIFFERENT_EMPLOYEE_NEW_FORM_ENABLED): the form named in place of "one".
   * See `other-employee.ts`.
   */
  const last = differentEmployeeNewFormEnabled()
    ? { ...latest, content: namingTheForm(latest.content, "form") }
    : latest;

  // An id is provenance only; one the history arrived without is simply absent.
  const prior = turns.slice(0, -1).map((turn) => ({ id: turn.id ?? "", role: turn.role, content: turn.content }));
  const context = managerContext(prior, { id: last.id, content: last.content });
  const { resolution, excluded } = employeeState(context);

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
  const accepted = acceptedNameSuggestions(input.conversation).some(
    (name) => name.trim().toLowerCase() === input.employeeName.trim().toLowerCase(),
  );
  if (
    resolution.kind === "resolved" &&
    !samePerson(resolution.employeeName, input.employeeName) &&
    !accepted
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
