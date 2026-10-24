import "server-only";

import {
  draftDedupeEnabled,
  fieldAccuracyEnabled,
  formStateEnabled,
  groundedEntitiesEnabled,
  intentExtractionEnabled,
  policyCitationEnabled,
  secondFormEnabled,
  slotRetentionEnabled,
} from "@/lib/config/chat-quality-flags";
import type { AskResponse } from "@/lib/ai/types";
import { formOpenedFor, openingLine } from "@/lib/forms/editable-draft";
import { withKeptTypedNames } from "@/lib/forms/kept-typed-names";
import { loadScopedRoster, readDirectoryFacts, withRosterLimit, type DirectoryFact } from "@/lib/forms/employee-roster";
import { findResentDraft } from "@/lib/forms/draft-reopen";
import { historyWantsSeparateDocument } from "@/lib/ai/second-form";
import type { ChatActor } from "./form-proposal";
import type { AskRequest } from "./types";

import { captureFormState, prependFormState, type ConversationFormState } from "./form-state";
import { oneSalonVisibleIn } from "./proposal-question";
import { managerContext } from "@/lib/forms/proposal";
import { loadFormState, saveFormState } from "./form-state-store";
import { enrichFormCard } from "./form-card-slots";
import { holdFilledSlots } from "./keep-filled-slots";
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
        });
    return holdFilledSlots({
      response: enriched,
      question: input.question,
      history: input.request.history,
      today: input.request.context.todayIso,
      people: [],
    });
  }

  const saved = await readSaved(stateOn, input.actor.subject, input.request.conversationId);
  const people = entities ? await loadPeople(input.actor) : [];
  const prep = entities
    ? prepareGroundedQuestion({
        question: input.question,
        history: input.request.history,
        people,
        saved,
      })
    : {
        ...EMPTY_PREP,
        question: stateOn ? prependFormState(input.question, saved) : input.question,
        keptTypedName: saved?.keptTypedName ?? null,
      };

  const proposed = await withRosterLimit(prep.rosterIds, () =>
    withKeptTypedNames(prep.keptTypedNames, () => input.propose(prep.question)),
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
      })
    : applied;

  const settled = withVisibleSalon(enriched, input);
  const held = holdFilledSlots({
    response: settled,
    question: input.question,
    history: input.request.history,
    today: input.request.context.todayIso,
    people,
  });
  const reopened = await reopenSameIncident(dedupe, input, held);
  if (reopened) {
    await writeSaved(stateOn, input, saved, held, prep);
    return reopened;
  }
  await writeSaved(stateOn, input, saved, held, prep);
  return held;
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
  const incident = [...input.request.history.filter((turn) => turn.role === "user").map((turn) => turn.content), input.request.question]
    .join("\n")
    .trim()
    .slice(0, 2000);
  try {
    const resent = await findResentDraft({
      templateKey: proposal.templateKey,
      employeeName: proposal.employeeName,
      createdBy: input.actor.subject,
      locationId: proposal.locationId,
      ...(incident ? { incident, formDate: proposal.formDate ?? null } : {}),
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
