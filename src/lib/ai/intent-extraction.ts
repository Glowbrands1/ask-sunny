import "server-only";

import { PRODUCTION_SALONS } from "@/data/salons";
import { CLAUDE_HAIKU_MODEL, CLAUDE_READER_MODEL } from "@/lib/config/models";
import { aiReadsCodeChecksEnabled, intentExtractionEnabled, lastFirstNameReadEnabled, remapIncidentFixEnabled } from "@/lib/config/chat-quality-flags";
import { readDirectoryFacts, loadScopedRoster, type DirectoryFact } from "@/lib/forms/employee-roster";
import { listTemplateSummaries } from "@/lib/forms/repository";
import { detectTemplateIntent } from "@/lib/forms/template-intent";
import { findManualSection, manualSectionHeadings } from "@/lib/forms/official-policy-manual";
import { SupabaseKnowledgeProvider } from "@/lib/knowledge/providers/supabase";

import { callClaudeTool } from "./call-claude";
import type { ChatActor } from "./form-proposal";
import { loadFormState, saveFormState } from "./form-state-store";
import { updateChatTrace } from "./chat-trace-store";
import { stateSentences } from "./form-state";
import type { GroundedPerson } from "./grounded-entities";
import {
  decideIntentTurn,
  INTENT_TOOL_DESCRIPTION,
  INTENT_TOOL_INPUT_SCHEMA,
  INTENT_TOOL_NAME,
} from "./intent-slots";
import { lastFirstReading } from "./reader/last-first";
import { readFormRequest, type ReaderResult } from "./reader/read";
import { priorShorthand, requestScopedHistory, startsNewForm } from "./remap-incident";
import type { AskRequest, AskResponse } from "./types";

/**
 * One tool call, then the slots are grounded and merged.
 *
 * The flag is off: this returns the request it was given and does not read
 * or write anything. A model failure, a missing table, or an empty manual
 * leaves the turn on the path it already had.
 */

const SYSTEM = `You read one manager's conversation and call record_intent_slots once.

Copy the employee, salon, job title, what happened, the date, the payroll amount, the warning level, the form, and the policy heading from what the manager said and from the stored state. Use their spelling. Leave a slot null when nobody has stated it.
incidentDate is the incident date in whatever form they wrote it. A follow-up date is not the incident date. Do not invent a date.
warningLevel is verbal or written only when they used that word, otherwise null.
policyHeading is the one heading from the manual list in the message that this account is about, or null when none of those headings fit. Do not invent a heading.
formTurn is true when they are filing a form or answering a question about one that is already open.
Do not answer the manager. Return only the tool call.`;

export async function applyIntentExtraction(input: {
  readonly request: AskRequest;
  readonly actor: ChatActor;
}): Promise<{ request: AskRequest; clarification: AskResponse | null; formTurn: boolean }> {
  if (!intentExtractionEnabled()) return { request: input.request, clarification: null, formTurn: false };
  try {
    // REMAP_INCIDENT_FIX_ENABLED: a later create request with its own incident
    // is a new form, so the old form's stored slots are not carried onto it.
    const newForm = remapIncidentFixEnabled() && startsNewForm(input.request.history, input.request.question);
    const saved = newForm ? null : await readSaved(input.actor.subject, input.request.conversationId);
    const [people, manual, templates] = await Promise.all([
      loadPeople(input.actor),
      loadManualIndex(input.request.scopeId),
      loadTemplates(),
    ]);
    const salons = PRODUCTION_SALONS.map((salon) => ({ id: salon.id, name: salon.name }));
    const turns = requestScopedHistory(input.request.history, input.request.question);
    const checkContext = {
      managerTurns: [...turns.filter((turn) => turn.role === "user").map((turn) => turn.content), input.request.question],
      people,
      locations: salons,
      headings: manual.headings,
      today: input.request.context.todayIso,
    };
    const readsForm = readsAForm(input.request, saved);
    // AI_READS_CODE_CHECKS_ENABLED: the reader runs beside the slot call, on a form turn only.
    const reading = aiReadsCodeChecksEnabled() && readsForm
      ? readFormRequest({ turns: [...turns, { role: "user", content: input.request.question }], context: checkContext })
      : null;
    const raw = await callClaudeTool({
      model: CLAUDE_HAIKU_MODEL,
      system: SYSTEM,
      maxTokens: 500,
      tool: {
        name: INTENT_TOOL_NAME,
        description: INTENT_TOOL_DESCRIPTION,
        input_schema: INTENT_TOOL_INPUT_SCHEMA,
      },
      messages: [
        {
          role: "user",
          content: userBlock(input.request, saved ? stateSentences(saved).join("\n") : "", manual.headings),
        },
      ],
    }).catch(() => null);
    // LAST_FIRST_NAME_READ_ENABLED: with no AI reader, "Marlowe, Quinn" is read by the reader's own checks, no model.
    const lastFirst = !reading && readsForm && lastFirstNameReadEnabled() ? lastFirstReading(checkContext) : null;
    const read: ReaderResult | { readonly fallback: string } | null = reading
      ? await reading
      : lastFirst
        ? { checked: lastFirst, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, ms: 0 }
        : null;
    const checked = read && "checked" in read ? read.checked : null;

    // REMAP_INCIDENT_FIX_ENABLED: "prior = manual ack 9/01" is a prior step, not the incident date.
    const fixed = remapIncidentFixEnabled();
    const decision = decideIntentTurn({
      question: fixed ? priorShorthand(input.request.question) : input.request.question,
      history: fixed
        ? requestScopedHistory(input.request.history, input.request.question).map((turn) =>
            turn.role === "user" ? { ...turn, content: priorShorthand(turn.content) } : turn,
          )
        : input.request.history,
      today: input.request.context.todayIso,
      saved,
      raw,
      people,
      salons,
      headings: manual.headings,
      headingPages: manual.pages,
      templates,
      formInProgress: Boolean(
        saved?.templateKey ||
          input.request.continueProposalTemplateKey ||
          input.request.openForm ||
          input.request.activeFormInstanceId,
      ),
      checked,
    });
    await writeSaved(input.actor.subject, input.request.conversationId, decision.state);
    updateChatTrace({
      slots: {
        employeeName: decision.state.employeeName,
        salonId: decision.state.salonId,
        formDate: decision.state.formDate,
        title: decision.state.title,
        policyHeading: decision.state.policyHeading,
        policyPage: decision.state.policyPage,
        templateKey: decision.state.templateKey,
        pendingConfirmation: decision.state.pendingConfirmation ?? null,
        ...(read ? { reader: readerTrace(read, decision.reader) } : {}),
      },
    });
    // A form turn keeps its card. A date, a salon, or a warning question used
    // to come back instead of the proposal, so the live replay showed no card.
    // The proposal asks what is still genuinely open and still carries the card.
    if (decision.clarification && !decision.formTurn) {
      return {
        request: input.request,
        clarification: {
          content: decision.clarification,
          citations: [],
          coverage: "not_applicable",
          recommendedVideoIds: [],
        },
        formTurn: false,
      };
    }
    const formTurn = decision.formTurn;
    if (decision.question === input.request.question) return { request: input.request, clarification: null, formTurn };
    return { request: { ...input.request, question: decision.question }, clarification: null, formTurn };
  } catch {
    return { request: input.request, clarification: null, formTurn: false };
  }
}

/** A turn that files a form, or answers about one already open. */
function readsAForm(request: AskRequest, saved: { templateKey?: string | null } | null): boolean {
  if (saved?.templateKey || request.continueProposalTemplateKey || request.openForm || request.activeFormInstanceId) return true;
  return detectTemplateIntent(request.question).kind !== "none";
}

/** AI_READS_CODE_CHECKS_ENABLED: kept in the chat trace, so cost, fallbacks and disagreements can be counted. */
function readerTrace(
  read: ReaderResult | { readonly fallback: string },
  merged: { readonly filled: readonly string[]; readonly disputed: readonly string[] } | undefined,
): Record<string, unknown> {
  if ("fallback" in read) return { fallback: read.fallback };
  return {
    // The spend guard prices the reader's usage at this model (ai/spend-guard-reader.ts). The Last, First reading has none.
    ...(read.ms > 0 ? { model: CLAUDE_READER_MODEL } : { source: "last_first" }),
    ms: read.ms,
    usage: read.usage,
    rejected: read.checked.rejected,
    filled: merged?.filled ?? [],
    disputed: merged?.disputed ?? [],
  };
}

function userBlock(request: AskRequest, saved: string, headings: readonly string[]): string {
  const turns = [...request.history, { role: "user", content: request.question }]
    .filter((turn) => turn.content.trim() !== "")
    .slice(-12)
    .map((turn) => `${turn.role === "assistant" ? "Assistant" : "Manager"}: ${turn.content.trim().slice(0, 1500)}`);
  const state = saved ? `Stored form state:\n${saved}\n\n` : "";
  const manual = headings.length > 0 ? `Manual headings:\n${headings.map((heading) => `- ${heading}`).join("\n")}\n\n` : "";
  return `${state}${manual}Today is ${request.context.todayIso}.\n\n${turns.join("\n\n")}`;
}

async function readSaved(userId: string | undefined, conversationId: string | undefined) {
  if (!userId || !conversationId) return null;
  return loadFormState(userId, conversationId);
}

async function writeSaved(userId: string | undefined, conversationId: string | undefined, state: Parameters<typeof saveFormState>[2]) {
  if (!userId || !conversationId) return;
  await saveFormState(userId, conversationId, state);
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

const manualIndexCache = new Map<string, Promise<{ headings: string[]; pages: Record<string, number> }>>();

async function loadManualIndex(scopeId: string): Promise<{ headings: string[]; pages: Record<string, number> }> {
  const cached = manualIndexCache.get(scopeId);
  if (cached) return cached;
  const pending = loadManualIndexOnce(scopeId);
  manualIndexCache.set(scopeId, pending);
  return pending;
}

async function loadManualIndexOnce(scopeId: string): Promise<{ headings: string[]; pages: Record<string, number> }> {
  try {
    const manual = await new SupabaseKnowledgeProvider().fetchOfficialPolicyManual(scopeId);
    if (!manual.ok) return { headings: [], pages: {} };
    const headings = manualSectionHeadings(manual.chunks);
    const pages: Record<string, number> = {};
    for (const heading of headings) {
      const section = findManualSection(manual.chunks, [heading]);
      if (section && section.page > 0) pages[heading] = section.page;
    }
    return { headings, pages };
  } catch {
    return { headings: [], pages: {} };
  }
}

async function loadTemplates(): Promise<{ key: string; name: string }[]> {
  try {
    const rows = await listTemplateSummaries();
    return rows.filter((row) => row.active).map((row) => ({ key: row.key, name: row.name }));
  } catch {
    return [];
  }
}
