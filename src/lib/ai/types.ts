import type {
  AnswerMode,
  ChatMessage,
  FormHandoff,
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
  /** Brand knowledge scope (see BrandConfig.knowledgeScopeId). */
  scopeId: string;
  attachedDocumentIds?: string[];
  context: AskContext;
}

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
  formHandoff?: FormHandoff;
  followUpSuggestions?: string[];
  pendingFormTemplateId?: string;
  pendingFormValues?: Record<string, string>;
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
  ask(request: AskRequest): Promise<AskResponse>;
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
