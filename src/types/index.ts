/**
 * Ask Sunny — domain types.
 *
 * These describe the product's real domain, not the prototype's shortcuts.
 * Mock providers and seeded demo data both conform to these shapes, so
 * swapping a mock for a live service (Claude, Supabase, SharePoint, Power BI,
 * Google Business Profile) is an implementation change, not a type change.
 */

/* ---------------------------------------------------------------- People --- */

/**
 * WHO SOMEBODY IS IN ASK SUNNY.
 *
 * `employee` is the frontline role — Ask Sunny, Knowledge Base, Videos, and
 * nothing else. It is listed FIRST because it is the least privileged and the
 * default for a new invitation: reading this list top to bottom is reading it
 * in order of access.
 *
 * `admin` is the CLIENT administrator, and is deliberately not `developer`.
 * They carry the same permissions today, and they are still different jobs:
 * one is the customer's own administrator, the other is internal build and
 * support. Labelling the developer role "Developer / Admin" left no way to name
 * the customer's administrator at all, which is what this splits apart.
 *
 * Mirrored by `public.app_user_role` in the database, and asserted against it.
 */
export type Role =
  | "employee"
  | "assistant_salon_director"
  | "salon_director"
  | "district_manager"
  | "regional_manager"
  | "admin"
  | "owner"
  | "developer";

export type ScopeLevel = "global" | "region" | "district" | "salon";

export interface AccessScope {
  /** Breadth of the assignment. */
  level: ScopeLevel;
  /** Primary area id — a location id, district id, or region id. */
  primaryAreaId: string | null;
  /**
   * "Also covers" — RMs and DMs frequently cover extra districts or regions
   * on top of their primary assignment.
   */
  alsoCoversAreaIds: string[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  scope: AccessScope;
  /** Salon-level accounts sign in under the salon email. */
  isSalonAccount: boolean;
  active: boolean;
  avatarInitials: string;
  title: string;
  lastActiveAt: string;
  createdAt: string;
}

export interface Location {
  id: string;
  name: string;
  city: string;
  state: string;
  districtId: string;
  districtName: string;
  regionId: string;
  regionName: string;
}

/* ----------------------------------------------------------- Permissions --- */

export type Permission =
  | "ask_questions"
  | "create_coaching"
  | "view_daily_stats"
  | "create_coaching_form"
  | "create_corrective_action"
  | "create_epp"
  | "create_policy_review"
  | "view_form_monitoring"
  | "manage_form_templates"
  | "manage_form_records"
  /**
   * VIEW THE OVERVIEW DASHBOARD.
   *
   * New, and the reason it is new: `/` had no permission at all, so every role
   * including the frontline one could open the salon's performance summary. An
   * Employee has no business on it, and "hide the sidebar item" is not a
   * boundary — so the page needs a permission to check.
   */
  | "view_overview"
  /**
   * READ the knowledge base. Separate from `manage_knowledge`, which uploads,
   * deletes and reindexes: an Employee needs the first and must never have the
   * second, and one permission cannot express both.
   */
  | "view_knowledge"
  /** Open Manager Resources. Not for the frontline role. */
  | "view_manager_resources"
  /**
   * REACH THE FORMS WORKSPACE AT ALL.
   *
   * `/forms/create` was ungated, which meant an Employee could open the form
   * builder even with no permission to create any particular form. This is the
   * page-level gate; WHICH forms somebody may create is still decided by the
   * per-template permissions, which is where that decision belongs.
   */
  | "view_forms_workspace"
  | "view_videos"
  | "manage_videos"
  | "view_reports"
  | "view_google_reviews"
  | "manage_knowledge"
  | "view_ai_usage"
  | "manage_users"
  | "manage_integrations";

export type PermissionMatrix = Record<Role, Permission[]>;

/* ------------------------------------------------------------- Knowledge --- */

export type KnowledgeCategory =
  | "policies_compliance"
  | "operations"
  | "training"
  | "leadership_coaching"
  | "sales_client_experience"
  | "reports_analytics"
  | "bonuses_compensation"
  | "safety"
  | "equipment_procedures"
  | "other";

export type DocumentStatus = "ready" | "processing" | "needs_review" | "failed";

/**
 * Where a document came from. Only `upload` is live in this phase — the other
 * three are the seams for SharePoint sync, Woven export, and system-seeded
 * demo content respectively.
 */
export type DocumentSource = "upload" | "sharepoint" | "woven" | "system";

export type DocumentFileType =
  | "pdf"
  | "docx"
  | "xlsx"
  | "txt"
  | "md"
  | "pptx"
  | "image"
  | "other";

export interface DocumentVersion {
  version: number;
  uploadedAt: string;
  uploadedBy: string;
  sizeBytes: number;
  note?: string;
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  description: string;
  category: KnowledgeCategory;
  fileName: string;
  fileType: DocumentFileType;
  sizeBytes: number;
  /** Approximate extracted character count, shown in the library listing. */
  characterCount: number;
  status: DocumentStatus;
  source: DocumentSource;
  version: number;
  previousVersions: DocumentVersion[];
  uploadedBy: string;
  uploadedAt: string;
  updatedAt: string;
  /** True once the ingestion pipeline has chunked + embedded it. */
  indexed: boolean;
  /**
   * Why the last processing run failed, in words a manager can act on.
   * Present only when status is "failed". Never contains document text.
   */
  failureReason?: string;
  tags: string[];
  /** Present only for prototype uploads persisted to IndexedDB. */
  blobKey?: string;
}

/**
 * A retrieval unit. Not produced in this phase — the future ingestion pipeline
 * (extract -> chunk -> embed -> store) emits these and the retriever returns
 * them. Defined now so citation plumbing does not have to be rewritten.
 */
export interface KnowledgeChunk {
  id: string;
  documentId: string;
  content: string;
  /** Page or section label surfaced in the citation, e.g. "Page 14". */
  locator: string;
  embedding?: number[];
}

export interface SourceCitation {
  documentId: string;
  documentTitle: string;
  /** e.g. "Page 14" or "Coaching Standards". */
  locator: string;
  category: KnowledgeCategory;
  excerpt: string;
  /** 0–1. In this phase a mock keyword score. */
  relevance: number;
}

export interface SearchResult {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  locator: string;
  content: string;
  score: number;
}

/* ---------------------------------------------------------------- Videos --- */

export type VideoCategory =
  | "sales"
  | "leadership"
  | "equipment"
  | "cleaning"
  | "troubleshooting"
  | "operations"
  | "training";

export type TranscriptStatus = "not_started" | "queued" | "ready" | "failed";

export interface VideoResource {
  id: string;
  title: string;
  description: string;
  category: VideoCategory;
  /** Seconds. */
  durationSeconds: number;
  uploadedBy: string;
  uploadedAt: string;
  /** Drives chat recommendations, exactly as in the reference platform. */
  equipment: string[];
  keywords: string[];
  tags: string[];
  /** Future capability — videos will be transcribed for retrieval. */
  transcriptStatus: TranscriptStatus;
  /**
   * Whether a playable file exists in the private `training-videos` bucket.
   *
   * OPTIONAL, AND ABSENT MEANS NO. Prototype-era records were created before
   * cloud video storage existed: their bytes went into the uploader's own
   * IndexedDB, which no other browser and no other device can read. Treating a
   * missing flag as "playable" would give every one of those records a player
   * that spins and fails, so the UI checks for `=== true`.
   */
  hasCloudAsset?: boolean;
  /** Transcript text. Present only when `transcriptStatus` is `ready`. */
  transcriptText?: string | null;
  /** Application-written failure wording. Never a provider's raw message. */
  transcriptErrorSafe?: string | null;
  /** Deterministic swatch pair for the placeholder thumbnail. */
  thumbnailTone: "sage" | "tan" | "blush" | "slate" | "gold";
  viewCount: number;
}

export type VideoActivityAction = "added" | "updated" | "deleted";

export interface VideoActivityEntry {
  id: string;
  action: VideoActivityAction;
  videoTitle: string;
  actor: string;
  at: string;
}

/* ------------------------------------------------------------------ Chat --- */

export type AnswerMode = "quick" | "standard" | "detailed";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  mode?: AnswerMode;
  citations?: SourceCitation[];
  recommendedVideoIds?: string[];
  /**
   * LEGACY, READ-ONLY. Never set on a new message.
   *
   * Conversations live in browser IndexedDB, so a manager can still open a
   * thread from before Phase 2 that carries one of these. The field stays on
   * the type so those stored messages deserialize and render as ordinary prose
   * instead of throwing — and `MessageBubble` no longer renders its
   * "Open in Create a Form" redirect for it. See `docs/chat-phase-2.md`.
   */
  formHandoff?: FormHandoff;
  /** Chips the user can click to continue a scripted flow. */
  followUpSuggestions?: string[];
  /**
   * Whether the knowledge base actually covered the question. Rendered as a
   * distinct state so "I do not have that" reads as an honest answer rather
   * than a failure — and so it is never mistaken for a grounded one.
   */
  coverage?: "grounded" | "insufficient" | "not_applicable";
  /**
   * What Sunny is offering to create. Rendered inline; creates nothing.
   *
   * This replaces `pendingFormTemplateId` / `pendingFormValues`, which
   * accumulated half-filled HR values in browser-local chat state and let a
   * missing fact become a demo fact on the next turn.
   */
  formProposal?: ChatFormProposal;
  /**
   * The REAL form this turn created, once the manager confirmed the proposal.
   *
   * A POINTER, NOT A COPY — see `ChatFormInstanceRef`.
   */
  formInstanceRef?: ChatFormInstanceRef;
  /**
   * Set instead of `content` when the turn failed. The chat surface renders
   * this as a distinct, actionable state rather than as an answer — a failure
   * must never be mistaken for something Sunny said.
   */
  error?: ChatTurnError;
}

/**
 * ============================================================================
 * A POINTER TO A REAL FORM — NEVER A COPY OF ONE
 * ============================================================================
 *
 * ONCE THE INSTANCE EXISTS, POSTGRES IS THE SOURCE OF TRUTH. Chat lives in the
 * browser's IndexedDB; a form is an HR record that outlives the browser it was
 * created in, gets edited from Form Monitoring, gets finalized, and gets read by
 * people who were never in this conversation.
 *
 * So this carries an ID and nothing that can go stale against the server. No
 * field values, no checked options, no status, no follow-up date, no finalized
 * flag, no PDF path. Every render fetches the instance by id; a value shown in
 * chat is a value the server just returned.
 *
 * `templateName` is the single exception, and it is PRESENTATION ONLY — a label
 * so the collapsed card can say which form it points at before the fetch
 * resolves. Nothing decides anything from it.
 */
export interface ChatFormInstanceRef {
  /** The `form_instances` row. The only durable authority stored in chat. */
  instanceId: string;
  /** Which proposal became this form, for the audit trail a manager can read. */
  proposalId: string;
  /** Presentation only. The server's own name is used once the fetch lands. */
  templateName: string;
}

/** Why a chat turn failed, and what the manager can do about it. */
export interface ChatTurnError {
  kind:
    | "not_configured"
    | "unauthenticated"
    | "retrieval_failed"
    | "model_failed"
    | "rate_limited"
    | "bad_request"
    | "unknown";
  message: string;
  /** Environment variable NAMES that are unset. Never values. */
  missing?: string[];
  /** True when re-sending the same question is worth trying. */
  retryable: boolean;
  /** The question that failed, so the UI can offer to send it again. */
  question: string;
}

export interface ChatConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  /** Files attached to a conversation stay in context for its lifetime. */
  attachedDocumentIds: string[];
}

/**
 * ============================================================================
 * A FORM PROPOSAL — WHAT SUNNY IS OFFERING TO CREATE, AND WHAT IS STILL MISSING
 * ============================================================================
 *
 * THE PROPOSAL IS NOT THE HR RECORD. Nothing here is a form: there is no
 * template version, no instance id, no field values, no follow-up date, no
 * status and no signature. Those belong to `form_instances`, which is the one
 * source of truth, and none of them exist until a manager confirms.
 *
 * SO WHAT IS IT FOR? Showing the manager, before anything is written, exactly
 * which form Sunny matched, who it thinks the form is about, and which salon it
 * would be filed against — with anything it could not establish named as
 * missing rather than filled in with something plausible.
 *
 * `sourceMessageIds` IS THE DURABLE PART. It points at the manager's own turns
 * rather than copying them, so when a form is eventually drafted the authority
 * is what the manager actually said — not a summary of it, and never Sunny's
 * paraphrase of it.
 */
export interface ChatFormProposal {
  /** Identifies this proposal within the conversation. Not a form instance id. */
  proposalId: string;
  /** Validated against the published, active template library, server-side. */
  templateKey: string;
  templateName: string;
  /**
   * Whether this proposal can become a real form WITHOUT LEAVING CHAT.
   *
   * SERVER-DECIDED, and carried rather than inferred, so no chat component has
   * to know which templates inline creation supports. Phase 3 ships the Coaching
   * Form only; every other published template still proposes, and its card
   * offers no create action rather than a control that does nothing.
   *
   * It is a presentation hint and nothing more. `POST /api/forms/instances`
   * re-checks the template, its published version, the actor's permission and
   * the salon on every call, so a browser that flips this to `true` gains
   * exactly nothing.
   */
  supportsInlineDraft: boolean;
  /** Null until the manager names one. Never inferred from an assistant turn. */
  employeeName: string | null;
  /** Null unless the authenticated scope proves exactly one salon. */
  locationId: string | null;
  /**
   * Display name for the resolved salon, when one is available.
   *
   * Absent today: there is no salon roster to resolve a name from an id, and
   * inventing one would put a fictional salon in front of a manager about to
   * file a disciplinary record. See `docs/chat-phase-2.md`.
   */
  locationName: string | null;
  locationResolution: "resolved" | "needs_selection" | "unavailable";
  /**
   * What is still needed. `ready` means nothing is — NOT that anything exists.
   *
   * There is no "needs_template" state, because a proposal without a validated
   * template is not a proposal: when Sunny cannot tell which form was asked
   * for, or the library does not publish it, the turn carries a question and no
   * proposal at all rather than a card with an empty frame.
   */
  status: "needs_employee" | "needs_location" | "ready";
  /**
   * The MANAGER turns this proposal was built from, oldest first. Ids, not
   * text: the conversation keeps the words, and this keeps the pointer.
   */
  sourceMessageIds: string[];
}

export interface FormHandoff {
  templateId: string;
  templateName: string;
  values: Record<string, string>;
  checkedOptions: Record<string, string[]>;
}

/* ----------------------------------------------------------------- Forms --- */

export type TemplateFieldType =
  | "text"
  | "long_text"
  | "date"
  | "select"
  | "checkbox_group"
  | "signature";

/** Who is responsible for putting content in a field. */
export type FieldFillRule =
  | "ai_populate"
  | "manager_completes"
  | "signature_never_ai";

export interface TemplateField {
  id: string;
  label: string;
  type: TemplateFieldType;
  fillRule: FieldFillRule;
  required: boolean;
  helpText?: string;
  options?: string[];
  /** Section header this field renders under in the printed form. */
  section: string;
}

export interface UploadedPdfTemplate {
  id: string;
  templateId: string;
  fileName: string;
  isBundledDefault: boolean;
  replacedBy?: string;
  replacedAt?: string;
  sizeBytes: number;
}

export interface FormTemplate {
  id: string;
  name: string;
  shortName: string;
  description: string;
  /** Permission required to create this form. */
  permission: Permission;
  active: boolean;
  updatedAt: string;
  updatedBy: string;
  fields: TemplateField[];
  acknowledgement: string;
  /** True when a saved document template overrides the uploaded PDF. */
  hasDocumentTemplate: boolean;
  pdf: UploadedPdfTemplate;
}

export type GeneratedFormStatus =
  | "draft"
  | "open"
  | "due_soon"
  | "overdue"
  | "followed_up"
  | "completed";

export interface GeneratedForm {
  id: string;
  templateId: string;
  templateName: string;
  employeeName: string;
  employeeRole: string;
  locationId: string;
  locationName: string;
  createdBy: string;
  createdAt: string;
  formDate: string;
  followUpDate: string | null;
  status: GeneratedFormStatus;
  values: Record<string, string>;
  checkedOptions: Record<string, string[]>;
  archived: boolean;
}

export interface FormFollowUp {
  formId: string;
  employeeName: string;
  templateName: string;
  dueDate: string;
  daysUntilDue: number;
  status: GeneratedFormStatus;
}

/* --------------------------------------------------------------- Reviews --- */

export interface ReviewMetric {
  locationId: string;
  locationName: string;
  districtName: string;
  totalReviews: number;
  reviewsGainedThisWeek: number;
  reviewsGainedLastWeek: number;
  averageRating: number;
  weeklyGoal: number;
}

export interface CustomerReview {
  id: string;
  locationId: string;
  locationName: string;
  authorName: string;
  rating: number;
  text: string;
  postedAt: string;
  responded: boolean;
}

/* ------------------------------------------------------------- Reporting --- */

export type MetricTrend = "up" | "down" | "flat";

export interface DashboardMetric {
  id: string;
  label: string;
  value: string;
  helper?: string;
  changeLabel?: string;
  trend?: MetricTrend;
}

export interface TimeSeriesPoint {
  label: string;
  [series: string]: string | number;
}

/* ------------------------------------------------- Resources & platform --- */

export type ResourceCategory =
  | "meetings"
  | "reporting"
  | "documents"
  | "training"
  | "people"
  | "support"
  | "other";

export interface ExternalResource {
  id: string;
  name: string;
  description: string;
  category: ResourceCategory;
  url: string;
  /** External apps open in a new tab; internal ones route inside Ask Sunny. */
  openMode: "new_tab" | "internal" | "modal";
  owner: string;
  /** Honest status — nothing is wired up in this phase. */
  availability: "available" | "coming_soon";
  iconKey: string;
}

export type IntegrationStatus = "connected" | "not_connected" | "planned";

export interface Integration {
  id: string;
  name: string;
  vendor: string;
  description: string;
  status: IntegrationStatus;
  /** What it unlocks once connected. */
  unlocks: string;
  category: "ai" | "documents" | "reporting" | "reviews" | "communication" | "storage";
  iconKey: string;
  notes?: string;
}

export interface AIUsageRecord {
  id: string;
  at: string;
  feature: string;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  status: "succeeded" | "failed";
}

/* ----------------------------------------------------------------- Brand --- */

export interface BrandConfig {
  /** Machine id — also the knowledge scope id. */
  id: string;
  /** e.g. "Sun Tan City". */
  brandName: string;
  /** e.g. "Ask Sunny". */
  productName: string;
  /** e.g. "Sunny". */
  assistantName: string;
  operatorName: string;
  wordmark: {
    lead: string;
    trail: string;
  };
  tagline: string;
  /**
   * Maps the semantic aliases in globals.css to this brand's raw values.
   * Applied at the app shell, so a second brand is a config swap.
   */
  paletteTokens: Record<string, string>;
  /** Scopes knowledge retrieval to one brand's corpus. */
  knowledgeScopeId: string;
  vocabulary: {
    salonNoun: string;
    salonNounPlural: string;
    dailyReportName: string;
  };
}
