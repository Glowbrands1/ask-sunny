import type { ChatReportContext } from "@/lib/reporting/read/chat-report-context";
import type {
  AnswerMode,
  ChatFormProposal,
  ChatMessage,
  SourceCitation,
} from "@/types";

export interface AskContext {
  /** Who is asking — used for the manager field on generated forms. */
  userName: string;
  /** Their salon or area — used for the location field. */
  locationName: string;
  /** ISO date the assistant should treat as "today". */
  todayIso: string;
}

export interface AskRequest {
  question: string;
  mode: AnswerMode;
  /** Prior turns in this conversation. */
  history: ChatMessage[];
  /**
   * Brand knowledge scope (see BrandConfig.knowledgeScopeId).
   *
   * SERVER-SET, ALWAYS. `/api/chat` fills this from `activeKnowledgeCorpus()`
   * and never from the request body — which is why the browser-facing shape
   * below does not carry it. The field stays on this internal contract because
   * `answerQuestion` and `knowledge.match` genuinely need an explicit corpus;
   * what changed is who is allowed to decide it.
   */
  scopeId: string;
  attachedDocumentIds?: string[];
  /**
   * Browser-local id of the message carrying `question`.
   *
   * PROVENANCE, NOT AUTHORITY — the same status as the ids on `history`. It
   * lets a form proposal record which of the manager's own turns it was read
   * from, and it is only ever echoed back to the browser that sent it.
   */
  questionMessageId?: string;
  /**
   * The template of the still-open proposal on the previous assistant turn.
   *
   * ORCHESTRATION, NOT AUTHORITY — it names a KIND of form and carries no
   * employee, salon, value or status. The server revalidates it against the
   * published library and the actor's permission, so a forged one produces
   * only what typing the template's name would have. See
   * `lib/forms/proposal-continuation.ts`.
   */
  continueProposalTemplateKey?: string;
  /**
   * What the manager was looking at when they asked, when they came from a
   * report tab's "Ask Sunny about this report".
   *
   * POINTERS ONLY — which family, which period, which salons, which measure.
   * There is nowhere in `ChatReportContext` to put a figure, so the browser
   * cannot send a number and have it treated as true; the server re-reads the
   * report for itself. See `reporting/read/chat-report-context.ts`.
   *
   * It travels with FOLLOW-UPS too, and that is what makes a cross-report
   * conversation work: "why is #1 the biggest problem?" names no report, and
   * the keyword routing reads the question only.
   */
  reportContext?: ChatReportContext | null;
  context: AskContext;
}

/**
 * What the BROWSER may send. Everything an `AskRequest` has except the corpus.
 *
 * Removed rather than left as an ignored field: a client that keeps sending an
 * authority-looking value is an invitation for a future server edit to start
 * trusting it again.
 */
export type ClientAskRequest = Omit<AskRequest, "scopeId">;

/**
 * How well the knowledge base covered the question.
 *
 * Carried explicitly rather than inferred from an empty citation list or from
 * the wording of the answer: "Sunny had nothing to go on" and "Sunny answered
 * but chose not to cite" are different situations that need different UI, and
 * pattern-matching the prose to tell them apart would be guesswork.
 */
export type KnowledgeCoverage =
  /** Retrieval returned supporting chunks and the answer used them. */
  | "grounded"
  /** Retrieval ran and found nothing above the relevance threshold. */
  | "insufficient"
  /** Coverage is not a meaningful question — a form flow, a greeting. */
  | "not_applicable";

export interface AskResponse {
  content: string;
  citations: SourceCitation[];
  /** Defaults to "not_applicable" when a provider does not report it. */
  coverage?: KnowledgeCoverage;
  recommendedVideoIds: string[];
  followUpSuggestions?: string[];
  /**
   * What Sunny is OFFERING to create. Present only on a form-request turn.
   *
   * REPLACES `formHandoff`, `pendingFormTemplateId` AND `pendingFormValues`,
   * which are gone rather than deprecated. Between them they carried a drafted
   * set of HR field values and a half-filled bag of pending ones through
   * browser-local chat state, and a fact missing on one turn was supplied from
   * a default on the next. A proposal carries no field values at all: it names
   * the template, who it is about and which salon, and nothing else. See
   * `lib/ai/form-proposal.ts`.
   */
  formProposal?: ChatFormProposal;
}

/**
 * AI ABSTRACTION
 * ---------------------------------------------------------------------------
 * The only surface the chat UI talks to. `MockAIProvider` implements it now;
 * `ClaudeProvider` implements it later. Nothing in `features/chat/` imports an
 * SDK, a model name, or an API key.
 */
export interface AIProvider {
  readonly name: string;
  /** False whenever the provider is a stand-in. Surfaced honestly in the UI. */
  readonly connected: boolean;
  ask(request: ClientAskRequest): Promise<AskResponse>;
  /** Short title for the conversation history sidebar. */
  titleForConversation(firstMessage: string): string;
}

/* ------------------------------------------------------------ Form drafting */

/**
 * ============================================================================
 * `draftForm` IS GONE FROM THIS INTERFACE, AND SO IS `POST /api/forms/draft`
 * ============================================================================
 *
 * They were the prototype's drafting path and they had no callers left: the
 * Create a Form workspace and the inline chat editor both draft through
 * `POST /api/forms/instances/[id]/draft`, against a real instance and its
 * pinned template version.
 *
 * REMOVED RATHER THAN RE-AUTHORIZED, because the shape was the problem and no
 * amount of permission checking fixes it. The route:
 *
 *   asked for `create_coaching_form` ON EVERY TEMPLATE, so a role that could
 *   draft a coaching form could have Claude write the prose of a Disciplinary
 *   Plan of Action;
 *
 *   took the FIELD LIST FROM THE REQUEST BODY, so the set of fields a model was
 *   allowed to write was whatever the browser said it was — the one decision
 *   that must come from the stored template version;
 *
 *   and addressed templates by the prototype's `tpl-*` ids, which no row in
 *   `form_templates` has answered to since the engine landed.
 *
 * The endpoint that replaced it derives all three from the server: it resolves
 * the instance, applies THAT TEMPLATE's `required_permission` through
 * `authorizeInstance`, reads the field list from the version the instance is
 * pinned to, and offers the model only the fields that version marks `ai`.
 * Keeping a second drafting endpoint alive beside it would have meant keeping
 * two sets of those guards in step.
 *
 * `lib/forms/fill-rules.ts` went with it. Its guard was expressed over the
 * prototype's `TemplateField`/`fillRule` shape; the live equivalent is
 * `enforceResponsibilities` and `AI_WRITABLE` in `lib/forms/responsibility.ts`,
 * which work over the stored document model and are what the live path runs.
 */
