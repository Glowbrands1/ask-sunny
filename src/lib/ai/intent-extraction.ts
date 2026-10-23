import "server-only";

import { PRODUCTION_SALONS } from "@/data/salons";
import { CLAUDE_HAIKU_MODEL } from "@/lib/config/models";
import { intentExtractionEnabled } from "@/lib/config/chat-quality-flags";
import { readDirectoryFacts, loadScopedRoster, type DirectoryFact } from "@/lib/forms/employee-roster";
import { listTemplateSummaries } from "@/lib/forms/repository";
import { findManualSection, manualSectionHeadings } from "@/lib/forms/official-policy-manual";
import { SupabaseKnowledgeProvider } from "@/lib/knowledge/providers/supabase";

import { callClaudeTool } from "./call-claude";
import type { ChatActor } from "./form-proposal";
import { loadFormState, saveFormState } from "./form-state-store";
import { stateSentences } from "./form-state";
import type { GroundedPerson } from "./grounded-entities";
import {
  decideIntentTurn,
  INTENT_TOOL_DESCRIPTION,
  INTENT_TOOL_INPUT_SCHEMA,
  INTENT_TOOL_NAME,
} from "./intent-slots";
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
    const saved = await readSaved(input.actor.subject, input.request.conversationId);
    const [people, manual, templates] = await Promise.all([
      loadPeople(input.actor),
      loadManualIndex(input.request.scopeId),
      loadTemplates(),
    ]);
    const salons = PRODUCTION_SALONS.map((salon) => ({ id: salon.id, name: salon.name }));
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

    const decision = decideIntentTurn({
      question: input.request.question,
      history: input.request.history,
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
    });
    await writeSaved(input.actor.subject, input.request.conversationId, decision.state);
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

async function loadManualIndex(scopeId: string): Promise<{ headings: string[]; pages: Record<string, number> }> {
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
