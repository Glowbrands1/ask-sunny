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
 * VERIFIED (browser evidence, Sept 2026): after sign-in, the authenticated
 * account dropdown `a.dropdown-toggle` carries the active company's name
 * ("JB & Associates"). This is the post-login company check.
 */
export const ACTIVE_COMPANY_TAG = "a";
export const ACTIVE_COMPANY_CLASS = "dropdown-toggle";

/**
 * VERIFIED as a sign: after credentials the web app can show a "Select
 * Company" step. Recognised so that landing on it is not mistaken for a
 * refused sign-in; it is answered by the company-selection request below.
 */
export const COMPANY_SELECTION_MARKER = /select\s+company/i;

/**
 * ============================================================================
 * COMPANY SELECTION — SOURCE-OBSERVED, NOT YET WIRE-VERIFIED
 * ============================================================================
 *
 * Observed in the authenticated Switch Account modal
 * (`ShowModal('#modal-switch-companies', '/Account/_Change_EmployeeCompany')`),
 * whose script posts:
 *
 *   POST /Account/_Change_EmployeeCompany
 *   Content-Type: application/json; charset=utf-8
 *   { "pCompanyID": "<company uuid>" }      ->  { "Success": true }
 *
 * reads `ErrorMessage` on failure, and sets `window.location = "/"` on
 * success. NOT PROVEN: that the login-time "Select Company" screen sends the
 * same request. So it is one replaceable `CompanySelector`, and a selection
 * is believed only when the reloaded `/` shows the company in the account
 * toggle (`ACTIVE_COMPANY_TAG` / `ACTIVE_COMPANY_CLASS`) — never because the POST said so.
 */
export const COMPANY_SWITCH_PATH = "/Account/_Change_EmployeeCompany";
export const COMPANY_SWITCH_FIELD = "pCompanyID";
/** The page the modal's script reloads after a successful switch. */
export const COMPANY_HOME_PATH = "/";
/** The modal's form; it carries a `__RequestVerificationToken` input. */
export const COMPANY_SWITCH_FORM_ID = "SwitchCompanyForm";

/**
 * UNVERIFIED: whether a POST needs an anti-forgery HEADER in addition to the
 * session cookie. The modal's form carries `__RequestVerificationToken`, but
 * the visible switch request sends only `pCompanyID`, and a global header may
 * or may not be added elsewhere. Default: none. It is switched on by setting
 * `WOVEN_TEAM_ANTIFORGERY_HEADER` to the header name live QA shows — no name
 * is guessed here.
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
 * VERIFIED header labels of the management table: Policy, Status, Audience,
 * Last Updated, Acknowledgement, plus an unlabeled document column. Cells are
 * read by header, not by position. A missing header leaves the value unknown,
 * and an unknown audience is held for review.
 */
export const POLICY_HEADER_HINTS = { audience: /^\s*audience\s*$/i, updated: /^\s*last\s+updated\s*$/i } as const;
/**
 * VERIFIED: Woven's policy audience setting is `Public` or `Targeted`. The
 * table's Audience cell is a DISPLAY summary ("All Teams 8 Positions") and is
 * never read as Public; only the exact label `Public` is company-wide.
 */
export const POLICY_AUDIENCE_PUBLIC = "Public";
export const POLICY_AUDIENCE_TARGETED = "Targeted";
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
/**
 * VERIFIED: the read-only policy detail structure.
 *   status      `.badge`
 *   version     `.dropdown-toggle` (the version picker; the account dropdown
 *               shares the class, so only text that reads as a version is used)
 *   body        inside `#policy-editor-column`: `label[for="ContentHTML"]`
 *               followed by `.read-only-label`
 *   attachments `#policy-attachments [data-document-id]`, file name
 *               `.wo-preview__name`; the temporary URL and content type are the
 *               arguments of `DownloadDocumentFromDashboard(...)`
 */
export const POLICY_DETAIL = {
  editorColumnId: "policy-editor-column",
  bodyLabelFor: "ContentHTML",
  bodyClass: "read-only-label",
  statusClass: "badge",
  versionClass: "dropdown-toggle",
  attachmentsId: "policy-attachments",
  attachmentIdAttr: "data-document-id",
  attachmentNameClass: "wo-preview__name",
  downloadHelper: "DownloadDocumentFromDashboard",
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

/** VERIFIED: the management view, which exposes attachment document ids. */
export const procedureManagementPath = (id: string) => `/KnowledgeCenter/Procedure/${encodeURIComponent(id)}/Management`;
/**
 * VERIFIED structure: employee detail steps are `.procedure-step-container`
 * with `data-procedure-step-id`, text in `#procedure-step-content`, and
 * attachments in `.procedure-step-attachment-list`. The management view marks
 * each attachment `data-attachment-id="<document-uuid>"`.
 * UNVERIFIED: the request `DownloadProcedureStepAttachment(name)` makes, so
 * attachment BYTES stay blocked.
 */
export const PROCEDURE_DETAIL = {
  stepClass: "procedure-step-container",
  stepIdAttr: "data-procedure-step-id",
  stepContentId: "procedure-step-content",
  attachmentListClass: "procedure-step-attachment-list",
  attachmentIdAttr: "data-attachment-id",
} as const;

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

/** VERIFIED: details page (links to content pages) and a content page. */
export const knowledgeElementDetailPath = (id: string) => `/KnowledgeElement/Details/${encodeURIComponent(id)}`;
export const knowledgeElementContentPath = (id: string, pageId: string) =>
  `/KnowledgeElement/Details/${encodeURIComponent(id)}/Content/${encodeURIComponent(pageId)}`;
/**
 * VERIFIED for the sampled content type: title `#Name`; body blocks
 * `.content[content-id]`. Other content types are not assumed: a page with no
 * such block is an unsupported structure and the element stays blocked.
 * Links inside a block are kept as references; an external URL (the sample has
 * a SharePoint video) is never downloaded.
 */
export const KNOWLEDGE_ELEMENT_CONTENT = {
  titleId: "Name",
  blockClass: "content",
  blockIdAttr: "content-id",
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

/**
 * VERIFIED route and headers (Order, Name, Type, Prerequisites, Version,
 * Tag(s), Last Update); page scripts indicate rows are `.entity-row[data-pk]`.
 * UNVERIFIED: a POPULATED row — none exists in this account — so course items
 * are not parsed and course content stays blocked.
 */
export const courseItemsPath = (id: string) => `/Course/_Course_Items?pCourseID=${encodeURIComponent(id)}`;

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
  /** `DownloadProcedureStepAttachment(name)` — request not captured. */
  procedureAttachmentDownload: "procedure_attachment_download",
  /** A procedure page without the verified step structure. */
  procedureContent: "procedure_content",
  /** A policy page without the verified read-only body structure. */
  policyBody: "policy_body",
  /** A Knowledge Element with no content page of the verified `.content[content-id]` kind. */
  knowledgeElementContent: "knowledge_element_content",
  /** A populated `_Course_Items` row — not seen in this account. */
  courseContent: "course_content",
} as const;
