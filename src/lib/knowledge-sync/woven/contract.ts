/**
 * ============================================================================
 * THE WOVEN TEAM WEB-APP CONTRACT — every assumed Woven name, in one file
 * ============================================================================
 *
 * SOURCE OF TRUTH: "Woven Team → Ask Sunny: Read-Only Connector Handoff",
 * compiled from the authenticated JB & Associates pages and the JavaScript
 * those pages served. These are Woven Team's INTERNAL, authenticated web-app
 * routes (class B/D in the handoff), used deliberately: Ask Sunny reads the
 * same responses the signed-in web app reads. This file is the one place to
 * correct when Woven changes a name, and the one place to finish when browser
 * evidence resolves an `UNVERIFIED` item.
 *
 * MARKERS
 *
 *   VERIFIED    route, method and field names established by the handoff from
 *               page code and rendered records.
 *   UNVERIFIED  the handoff says it was not captured. Anything so marked is
 *               either not used, or used only in a way that FAILS CLOSED (an
 *               item held back, a run refused) when it turns out to be wrong.
 *
 * THIS CLIENT IS READ-ONLY. Every POST below is a list/search read or a
 * download-URL request the web app itself makes to show content. Nothing here
 * creates, edits, publishes, acknowledges or deletes anything in Woven.
 */

export const DEFAULT_WOVEN_TEAM_BASE_URL = "https://app.woven.team";

/** The tenant this build syncs. Configurable, checked after sign-in. */
export const DEFAULT_WOVEN_COMPANY = "JB & Associates";

/* ------------------------------------------------------ authentication -- */

/** VERIFIED: `GET /Login` returns the login form. */
export const LOGIN_PAGE_PATH = "/Login";
/** VERIFIED: the form posts here, `application/x-www-form-urlencoded`. */
export const LOGIN_SUBMIT_PATH = "/Login/Authenticate";
/** VERIFIED: form field names. */
export const LOGIN_FIELDS = {
  username: "AuthenticationRequestUser",
  password: "AuthenticationRequestPass",
  isLocationLogin: "IsLocationLogin",
  setTermsSignedDate: "SetTermsSignedDate",
  antiForgery: "__RequestVerificationToken",
} as const;

/**
 * VERIFIED: signs of a login page. Any authenticated read that answers with
 * one of these is an expired session, never "no content".
 */
export const LOGIN_PATH_PREFIXES = ["/login"];
export const LOGIN_FORM_MARKER = /action\s*=\s*["']\/Login\/Authenticate["']/i;

/**
 * UNVERIFIED: the company-selection exchange. After credentials, the web app
 * displayed a "Select Company" step. Its request, fields and response were not
 * captured, so this is recognised (to fail precisely) and never answered.
 */
export const COMPANY_SELECTION_MARKER = /select\s+company/i;

/**
 * UNVERIFIED: whether list POSTs need an anti-forgery HEADER in addition to
 * the session cookie. Null sends none. If Woven turns out to require one, set
 * the header name here and the client sends the page's
 * `__RequestVerificationToken` value with every POST.
 */
export const ANTIFORGERY_HEADER: string | null = null;

/** Recognised in error pages, so an anti-forgery refusal is named as such. */
export const ANTIFORGERY_ERROR_MARKER = /anti-?forgery|RequestVerificationToken/i;

/* --------------------------------------------------------------- policies -- */

/** VERIFIED: server-rendered management table; rows carry `data-policy-id`. */
export const POLICY_LIST_PATH = "/Policy";
export const POLICY_ROW_ATTRS = {
  id: "data-policy-id",
  status: "data-status",
  disabled: "data-disabled",
  hasAttachments: "data-has-attachments",
} as const;
/**
 * UNVERIFIED: the column order of the management table. The title comes from
 * the row's `/Policy/Details/{id}` link (verified); the audience and updated
 * date are read by the table's own HEADER labels, matched loosely. A missing
 * header leaves the value unknown — an unknown audience is held for review.
 */
export const POLICY_HEADER_HINTS = { audience: /audience|assigned|shared/i, updated: /updated|modified/i } as const;
export const policyDetailPath = (id: string) => `/Policy/Details/${encodeURIComponent(id)}`;
/** VERIFIED: inline `var mPolicyAttachments = [...]` on the detail page. */
export const POLICY_ATTACHMENTS_VAR = "mPolicyAttachments";
export const POLICY_ATTACHMENT_FIELDS = {
  documentId: "DocumentID",
  name: "DocumentName",
  size: "SizeInBytes",
  url: "AzureFileURL",
  contentType: "ContentType",
} as const;
/** VERIFIED: `data-status` values seen, and what they mean here. */
export const POLICY_PUBLISHED_STATUSES = ["current", "published"];
export const POLICY_UNPUBLISHED_STATUSES = ["draft", "archived", "retired", "inactive", "unpublished"];

/* -------------------------------------------------------------- handbooks -- */

/** VERIFIED: POST, JSON content type, no body; answers `{ list: [...] }`. */
export const HANDBOOK_LIST_PATH = "/KnowledgeCenter/_Handbooks_List_ForDataTable";
export const HANDBOOK_COLUMNS = { id: "EntityID", name: "Column1", status: "Column2", audience: "Column3", updated: "Column4" } as const;
export const handbookManagePath = (id: string) => `/KnowledgeCenter/Handbooks/${encodeURIComponent(id)}/manage`;
/** VERIFIED: inline variables on the manage page. */
export const HANDBOOK_VARS = {
  id: "mHandbookID",
  name: "mHandbookName",
  updatedOn: "mUpdatedOn",
  currentVersionId: "mCurrentVersionID",
  draftVersionId: "mDraftVersionID",
} as const;
/** VERIFIED: form POST `pHandbookID`, `pHandbookVersionID`; answers `{ Success, Download: { DownloadURL, FileName } }`. */
export const HANDBOOK_DOWNLOAD_PATH = "/KnowledgeCenter/_Handbook_DownloadVersion";
export const HANDBOOK_DOWNLOAD_FIELDS = { handbookId: "pHandbookID", versionId: "pHandbookVersionID" } as const;
export const HANDBOOK_PUBLISHED_STATUSES = ["published"];
export const HANDBOOK_UNPUBLISHED_STATUSES = ["draft", "unpublished", "archived", "not shared"];

/* ------------------------------------------------------------- procedures -- */

/** VERIFIED: POST JSON search; answers `{ Success, HTML }`; cards carry `data-procedure-id`. */
export const PROCEDURE_SEARCH_PATH = "/KnowledgeCenter/_Search_Procedures";
export const PROCEDURE_SEARCH_BODY = {
  pModel: { FilterText: "", Categories: [], Frequencies: [], Positions: [], Tags: [] },
} as const;
export const PROCEDURE_CARD_ATTR = "data-procedure-id";
/** VERIFIED: the employee detail link's query names. */
export const procedureDetailPath = (id: string) =>
  `/KnowledgeCenter/Procedure/${encodeURIComponent(id)}?pFilterText=&pIsCategoryFilterUsed=false&pIsPositionFilterUsed=false&pIsFrequencyFilterUsed=false&pIsTagFilterUsed=false`;

/* ----------------------------------------------------------- file library -- */

/** VERIFIED: POST JSON; answers `{ list: [...] }`, the whole filtered collection (`serverSide:false`). */
export const FILE_LIBRARY_LIST_PATH = "/FileLibrary/_FileLibrary_Management_List_ForDataTable";
export const FILE_LIBRARY_LIST_BODY = {
  pModel: { Name: "", FileAltText: "", FileLibraryTypes: [], FileLibrarySources: [], Tags: [] },
} as const;
export const FILE_LIBRARY_COLUMNS = {
  id: "EntityID",
  type: "Column1",
  title: "Column2",
  status: "Column3",
  audience: "Column4",
  size: "Column5",
  updated: "Column6",
  tags: "Column7",
  library: "Column8",
} as const;
export const FILE_LIBRARY_PUBLISHED_STATUSES = ["published"];
export const FILE_LIBRARY_UNPUBLISHED_STATUSES = ["unpublished", "draft", "archived", "not shared"];
/**
 * The File Library type labels Ask Sunny can index, mapped to a file type.
 * "PDF" is VERIFIED; the Word label is UNVERIFIED and matched loosely. Anything
 * else (video, image, link) is an unsupported format, not a failure.
 */
export const FILE_LIBRARY_INDEXABLE_TYPES: { pattern: RegExp; extension: string; mimeType: string }[] = [
  { pattern: /^pdf$/i, extension: "pdf", mimeType: "application/pdf" },
  {
    pattern: /^(docx|word)$/i,
    extension: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
];

/* ----------------------------------------------------- knowledge elements -- */

/** VERIFIED: POST JSON; `LearningElementStatus: "null"` is the page's "all statuses". */
export const KNOWLEDGE_ELEMENT_LIST_PATH = "/KnowledgeElement/_KnowledgeElement_List_ForDataTable";
export const KNOWLEDGE_ELEMENT_LIST_BODY = { pModel: { LearningElementStatus: "null", Tags: [] } } as const;
export const KNOWLEDGE_ELEMENT_COLUMNS = {
  id: "EntityID",
  status: "Column1",
  title: "Column2",
  version: "Column3",
  type: "Column4",
  tags: "Column5",
  updated: "Column6",
} as const;

/* ---------------------------------------------------------------- courses -- */

/** VERIFIED: POST JSON; archived courses are excluded by `IsArchived: false`. */
export const COURSE_LIST_PATH = "/Course/_Course_List_ForDataTable";
export const COURSE_LIST_BODY = { pModel: { LearningElementStatus: "null", Tags: [], IsArchived: false } } as const;
export const COURSE_COLUMNS = {
  id: "EntityID",
  status: "Column1",
  title: "Column3",
  version: "Column4",
  tags: "Column5",
  updated: "Column6",
} as const;

/** VERIFIED: learning statuses seen in the status filter. */
export const LEARNING_PUBLISHED_STATUSES = ["current"];
export const LEARNING_UNPUBLISHED_STATUSES = ["draft", "archived", "retired"];

/* --------------------------------------------------------------- audience -- */

/**
 * VERIFIED for Handbooks and the File Library: "Public" is the company-wide
 * audience ("Audience UI distinguishes Public and Targeted"). Nothing else is
 * treated as company-wide without an administrator's decision.
 */
export const COMPANY_WIDE_AUDIENCE_LABELS = ["Public"];

/* -------------------------------------------------------------- downloads -- */

/**
 * Temporary signed storage URLs are fetched only from these hosts, over HTTPS,
 * WITHOUT the Woven session cookie. VERIFIED: policy attachments are on
 * `woven.blob.core.windows.net` with SAS parameters; File Library originals on
 * `wovenversioned.blob.core.windows.net`. The handbook `DownloadURL` host was
 * not recorded, so it is held to the same allowlist.
 */
export const DOWNLOAD_HOST_PATTERN = /^[a-z0-9-]+\.blob\.core\.windows\.net$/i;

/**
 * The capabilities not yet established. A part that needs one is BLOCKED —
 * tracked, compared, never guessed at — and named by one of these codes in the
 * admin screen's Advanced section and in the evidence request.
 */
export const CAPABILITY = {
  /** `DownloadFileLibraryDocument(id, 'FileLibrary')` — request not captured. */
  fileLibraryDownload: "file_library_download",
  /** `DownloadProcedureStepAttachment(name)` — request not captured; attachment ids' markup not captured. */
  procedureContent: "procedure_content",
  /** The policy body's selector on `/Policy/Details/{id}` — not captured. */
  policyBody: "policy_body",
  /** Knowledge Element content-page selectors — not captured. */
  knowledgeElementContent: "knowledge_element_content",
  /** `/Course/_Course_Items` fields — not captured. */
  courseContent: "course_content",
} as const;
