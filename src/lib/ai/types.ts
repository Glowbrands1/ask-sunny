import type {
  AnswerMode,
  ChatFormProposal,
  ChatMessage,
  SourceCitation,
  TemplateField,
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
  /** Drafts the AI-populated fields of a form template. */
  draftForm(request: FormDraftRequest): Promise<FormDraftResponse>;
  /** Short title for the conversation history sidebar. */
  titleForConversation(firstMessage: string): string;
}

/* ------------------------------------------------------------ Form drafting */

export interface FormDraftInput {
  employeeName: string;
  employeeRole: string;
  locationName: string;
  managerName: string;
  formDate: string;
  topic: string;
  incidentDetails: string;
  followUpDate: string;
  /** Checkbox selections the manager made during the guided flow. */
  selections: Record<string, string[]>;
}

export interface FormDraftRequest {
  templateId: string;
  templateName: string;
  /** Only fields with fillRule "ai_populate" may be written. */
  fields: TemplateField[];
  input: FormDraftInput;
}

export interface FormDraftResponse {
  values: Record<string, string>;
  checkedOptions: Record<string, string[]>;
}
