import "server-only";

import {
  draftDedupeEnabled,
  draftReuseSameChatOnlyEnabled,
  fieldAccuracyEnabled,
  formStateEnabled,
  groundedEntitiesEnabled,
  intentExtractionEnabled,
  policyCitationEnabled,
  secondFormEnabled,
  slotRetentionEnabled,
  wholeTeamCoachingEnabled,
  secondRequestOwnAccountEnabled,
} from "@/lib/config/chat-quality-flags";
import type { AskResponse } from "@/lib/ai/types";
import { withAccountTurnSources } from "@/lib/ai/account-turn-sources";
import { conversationKeyOf } from "@/lib/forms/conversation-key";
import { formOpenedFor, openingLine } from "@/lib/forms/editable-draft";
import { withKeptTypedNames } from "@/lib/forms/kept-typed-names";
import { withRosterAnchor } from "@/lib/forms/roster-anchor-store";
import { loadScopedRoster, readDirectoryFacts, withRosterLimit, type DirectoryFact } from "@/lib/forms/employee-roster";
import { reopenIncidentText } from "@/lib/forms/current-request";
import { findResentDraft } from "@/lib/forms/draft-reopen";
import { historyWantsSeparateDocument } from "@/lib/ai/second-form";
import type { ChatActor } from "./form-proposal";
import type { AskRequest } from "./types";
import { isTeamCardTurn } from "@/lib/forms/whole-team-coaching";

import { captureFormState, prependFormState, type ConversationFormState } from "./form-state";
import { oneSalonVisibleIn } from "./proposal-question";
import { managerContext } from "@/lib/forms/proposal";
import { loadFormState, saveFormState } from "./form-state-store";
import { enrichFormCard } from "./form-card-slots";
import { holdFilledSlots } from "./keep-filled-slots";
import { startsFormForAnotherPerson } from "./new-person-request";
import { applyEditDateRules } from "./edit-date-rules";
import { withoutFutureCardDate } from "@/lib/forms/future-card-date";
import { withTypedEmployeeOnCard } from "./typed-employee-card";
import { applyGroundedProposal, prepareGroundedQuestion, type GroundedPerson, type GroundedPrep } from "./grounded-entities";

/**
 * Form proposal with the grounded-entity and form-state flags.
 *
 * Both off, and draft dedupe off: the question is proposed and decorated
 * exactly as the caller passed it, and nothing is read. A missing form-state
 * table does not fail the turn.
 */

const EMPTY_PREP: GroundedPrep = {
  question: "",
  rosterIds: null,
  keptTypedNames: [],
  unmatched: [],
  ambiguous: [],
  ambiguousTyped: null,
  keptTypedName: null,
  employeeId: null,
};

export async function deliverFormProposal(input: {
  readonly request: AskRequest;
  readonly actor: ChatActor;
  readonly question: string;
  readonly propose: (question: string) => Promise<AskResponse | null>;
  readonly decorate: (response: AskResponse) => Promise<AskResponse>;
}): Promise<AskResponse | null> {
  const entities = groundedEntitiesEnabled();
  const stateOn = formStateEnabled();
  const dedupe = draftDedupeEnabled();
  if (!entities && !stateOn && !dedupe) {
    const proposed = await input.propose(input.question);
    if (!proposed) return null;
    const decorated = await input.decorate(withVisibleSalon(proposed, input));
    const enriched = !cardSlotsEnabled()
      ? decorated
      : enrichFormCard({
          response: decorated,
          question: input.question,
          said: [
            ...input.request.history.filter((turn) => turn.role === "user").map((turn) => turn.content),
            input.question,
          ].join("\n"),
          today: input.request.context.todayIso,
          people: [],
          saved: null,
          wovenNoteShown: input.request.history.some((turn) => /Woven has \*\*/.test(turn.content)),
        });
    // KEEP_FORM_EMPLOYEE_ENABLED: "for Test Employee" stays Test Employee on the card. See `withTypedEmployeeOnCard`.
    // ACCOUNT_BEFORE_REQUEST_ENABLED: the account the card shows, given before its request, is cited (`ai/account-turn-sources.ts`).
    return futureCardDate(input, withAccountTurnSources(withEditDateRules(
      withTypedEmployeeOnCard(
        holdFilledSlots({
          response: enriched,
          question: input.question,
          history: heldHistory(input.request),
          today: input.request.context.todayIso,
          people: [],
        }),
        input.request.question,
      ),
      input,
    ), input.request.history));
  }

  /*
   * WHOLE_TEAM_COACHING_ENABLED (ported from Ask Bubbles, 3 Nov 2026): the
   * team card's subject is the team, not the person this conversation's saved
   * form state remembers ("The employee is …" was put back in front of
   * "Coaching Form for the whole team"). While the team card is being made or
   * is the card on screen, the saved state is neither read nor written.
   */
  const team = wholeTeamCoachingEnabled() && (isTeamCardTurn(input.request) || isTeamCardTurn({ ...input.request, question: input.question }));
  const keepState = stateOn && !team;
  const saved = await readSaved(keepState, input.actor.subject, input.request.conversationId);
  const people = entities ? await loadPeople(input.actor) : [];
  const prep = entities
    ? prepareGroundedQuestion({
        question: input.question,
        history: heldHistory(input.request),
        people,
        saved,
      })
    : {
        ...EMPTY_PREP,
        question: stateOn
          ? prependFormState(input.question, saved, input.request.history.filter((turn) => turn.role === "user").map((turn) => turn.content))
          : input.question,
        keptTypedName: saved?.keptTypedName ?? null,
      };

  const proposed = await withRosterLimit(prep.rosterIds, () =>
    withKeptTypedNames(prep.keptTypedNames, () => withRosterAnchor(prep.rosterAnchored === true, () => input.propose(prep.question))),
  );
  if (!proposed) return null;
  const decorated = await input.decorate(proposed);
  const applied = entities
    ? applyGroundedProposal(decorated, { people, prep, rosterEmpty: people.length === 0 })
    : decorated;

  const said = [
    ...input.request.history.filter((turn) => turn.role === "user").map((turn) => turn.content),
    input.question,
  ].join("\n");
  const enriched = cardSlotsEnabled()
    ? enrichFormCard({
        response: applied,
        question: input.question,
        said,
        today: input.request.context.todayIso,
        people,
        saved,
        wovenNoteShown: input.request.history.some((turn) => /Woven has \*\*/.test(turn.content)),
      })
    : applied;

  const settled = withVisibleSalon(enriched, input);
  // ACCOUNT_BEFORE_REQUEST_ENABLED: the account the card shows, given before its request, is cited (`ai/account-turn-sources.ts`).
  const held = futureCardDate(input, withAccountTurnSources(withEditDateRules(
    withTypedEmployeeOnCard(
      holdFilledSlots({
        response: settled,
        question: input.question,
        history: heldHistory(input.request),
        today: input.request.context.todayIso,
        people,
      }),
      input.request.question,
    ),
    input,
  ), input.request.history));
  const reopened = await reopenSameIncident(dedupe, input, held);
  if (reopened) {
    await writeSaved(keepState, input, saved, held, prep);
    return reopened;
  }
  await writeSaved(keepState, input, saved, held, prep);
  return held;
}

/** FORM_EDIT_DATE_RULES_ENABLED: read from the manager's own turns, not the state sentences. See `edit-date-rules.ts`. */
function withEditDateRules(response: AskResponse, input: { readonly request: AskRequest }): AskResponse {
  return applyEditDateRules(response, {
    question: input.request.question,
    history: input.request.history,
    today: input.request.context.todayIso,
  });
}

function withVisibleSalon(
  response: AskResponse,
  input: { readonly request: AskRequest; readonly question: string },
): AskResponse {
  const proposal = response.formProposal;
  if (!proposal || proposal.locationId || proposal.locationResolution !== "not_applicable") return response;
  const locationId = oneSalonVisibleIn(managerContext(input.request.history, { content: input.question }).text);
  if (!locationId) return response;
  return {
    ...response,
    formProposal: {
      ...proposal,
      locationId,
      locationResolution: "resolved",
      status: proposal.employeeName ? "ready" : proposal.status,
    },
  };
}

function cardSlotsEnabled(): boolean {
  return (
    slotRetentionEnabled() ||
    fieldAccuracyEnabled() ||
    groundedEntitiesEnabled() ||
    intentExtractionEnabled() ||
    policyCitationEnabled() ||
    secondFormEnabled()
  );
}

async function loadPeople(actor: ChatActor): Promise<GroundedPerson[]> {
  try {
    const facts = await readDirectoryFacts(actor.scope);
    if (facts.length > 0) return facts.map(asPerson);
    const roster = await loadScopedRoster(actor.scope);
    return roster.map((person) => ({ ...person, title: null, primaryLocationName: null, primarySalonId: null }));
  } catch {
    return [];
  }
}

function asPerson(fact: DirectoryFact): GroundedPerson {
  return {
    id: fact.id,
    firstName: fact.firstName,
    lastName: fact.lastName,
    preferredFirstName: fact.preferredFirstName,
    salonIds: fact.salonIds,
    title: fact.title,
    primaryLocationName: fact.primaryLocationName,
    primarySalonId: fact.primarySalonId,
  };
}

async function readSaved(
  enabled: boolean,
  userId: string | undefined,
  conversationId: string | undefined,
): Promise<ConversationFormState | null> {
  if (!enabled || !userId || !conversationId) return null;
  return loadFormState(userId, conversationId);
}

async function writeSaved(
  enabled: boolean,
  input: { actor: ChatActor; request: AskRequest },
  previous: ConversationFormState | null,
  response: AskResponse,
  prep: GroundedPrep,
): Promise<void> {
  if (!enabled || !input.actor.subject || !input.request.conversationId) return;
  const proposal = response.formProposal ?? null;
  const next = captureFormState(previous, {
    proposal,
    employeeId: prep.employeeId,
    keptTypedName: prep.keptTypedName,
    userText: input.request.question,
    policyHeading: null,
    policyPage: null,
  });
  await saveFormState(input.actor.subject, input.request.conversationId, next);
}

async function reopenSameIncident(
  enabled: boolean,
  input: { actor: ChatActor; request: AskRequest },
  response: AskResponse,
): Promise<AskResponse | null> {
  const proposal = response.formProposal;
  if (!enabled || !proposal?.employeeName || !proposal.templateKey || !input.actor.subject) return null;
  if (historyWantsSeparateDocument([...input.request.history, { role: "user", content: input.request.question }])) {
    return null;
  }
  const said = [...input.request.history.filter((turn) => turn.role === "user").map((turn) => turn.content), input.request.question];
  /*
   * SECOND_REQUEST_OWN_ACCOUNT_ENABLED (QA's audit, 7 Nov 2026): the incident is the request now being written, never
   * the whole chat. Joined, "a CA for <A>, late opening" and "another CA for <A>, cash drawer short" matched the first
   * draft (its narrative's words were all in the chat), so the first draft was reopened and no second form was made.
   * A resend of the same request is still the same incident.
   */
  const incident = reopenIncidentText(said, secondRequestOwnAccountEnabled());
  try {
    const resent = await findResentDraft({
      templateKey: proposal.templateKey,
      employeeName: proposal.employeeName,
      createdBy: input.actor.subject,
      locationId: proposal.locationId,
      ...(incident ? { incident, formDate: proposal.formDate ?? null } : {}),
      /*
       * DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED: only a draft this chat made, as
       * the create route already keeps (QA B22, 25 Oct 2026: a new chat's
       * no-call-no-show reopened another chat's tardiness draft through this
       * lookup). No chat id keeps nothing. See `draft-same-chat.ts`.
       */
      ...(draftReuseSameChatOnlyEnabled()
        ? { sameChat: { conversationKey: conversationKeyOf({ conversationId: input.request.conversationId }) } }
        : {}),
    });
    if (!resent) return null;
    const draft = {
      instanceId: resent.id,
      templateName: resent.templateName,
      employeeName: resent.employeeName,
      status: resent.status,
      revisesInstanceId: resent.revisesInstanceId,
      opened: false,
    };
    const { formProposal, ...rest } = response;
    void formProposal;
    return { ...rest, content: openingLine(draft), formOpened: formOpenedFor(draft) };
  } catch {
    return null;
  }
}

/**
 * NEW_PERSON_REQUEST_ENABLED (QA, live, 30 Oct 2026): "also create a ca for
 * <another> …" kept the first employee's sentence in the new card's
 * Observation of Offense ("<first>. she was late on 10/20. also create a ca
 * for <another> …"). A turn that starts another person's form holds nothing
 * from the turns before it.
 */
function heldHistory(request: { readonly history: readonly HistoryTurnLike[]; readonly question: string }): readonly HistoryTurnLike[] {
  return startsFormForAnotherPerson(request.history, request.question) ? [] : request.history;
}

type HistoryTurnLike = { readonly role: string; readonly content: string };

/** FUTURE_INCIDENT_DATE_ASK_ENABLED: the turn's card is never dated after today (`forms/future-card-date.ts`). */
function futureCardDate(input: { request: AskRequest }, response: AskResponse): AskResponse {
  return withoutFutureCardDate(response, {
    question: input.request.question,
    history: input.request.history,
    today: input.request.context.todayIso,
  });
}
