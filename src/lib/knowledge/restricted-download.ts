import {
  KNOWLEDGE_DOCUMENT_ROLES,
  hasRoleTag,
  matchesRoleFallback,
  type RoleCandidateDocument,
} from "./document-roles";

/**
 * ============================================================================
 * WHICH ORIGINAL FILES ONLY AN ADMINISTRATOR MAY TAKE AWAY
 * ============================================================================
 *
 * A citation opens the document it names, for every role Sunny answers for.
 * That is the point of the read-only source route and it does not change here.
 *
 * WHAT DOES CHANGE is the ORIGINAL FILE for one narrow class of document: the
 * frameworks. They are not reference material a manager consults — they are
 * Sunny's own reasoning, the operating rules and escalation guards that decide
 * how employee metrics become coaching, written as plain-text source. Handing
 * that file to somebody is handing them the assistant's instructions, which is
 * a different act from showing them the policy they were quoted.
 *
 * RETRIEVAL IS UNTOUCHED, and that is the whole shape of this. Sunny still
 * reads these documents, still grounds answers in them and still cites them for
 * every role. Only the stored .txt itself stops being downloadable.
 *
 * ============================================================================
 * IDENTIFIED BY THE MECHANISM THAT ALREADY EXISTS
 * ============================================================================
 *
 * `document-roles.ts` has answered "is this document a framework?" since the
 * mandatory-grounding work, and answers it in the order that module argues for:
 *
 *   TAG FIRST — `hasRoleTag`, the durable `tags` marker curated by whoever owns
 *   the corpus. A re-upload under a tidied filename keeps its tag and keeps
 *   being protected.
 *
 *   EXACT FILENAME OR TITLE SECOND — `matchesRoleFallback`, normalised
 *   whole-string equality against the spellings that module already records.
 *   NOT a substring search: "framework" appearing in some manual's title must
 *   not silently make it undownloadable.
 *
 * Reusing it means a fourth framework added there is protected here on the same
 * day, with nothing to remember.
 *
 * ============================================================================
 * AND THE TEXT-SOURCE RULE, WHICH IS THE SAFETY NET
 * ============================================================================
 *
 * Tags may not be set yet and a filename may have been tidied past both
 * fallbacks, so plain text is treated as source in its own right. This is
 * deliberately broader than the frameworks: a .txt in this corpus is a raw
 * source file rather than something a manager was meant to read, and the cost
 * of being wrong runs the safe way — an administrator can always download it.
 *
 * PDFs, DOCX, XLSX AND PPTX ARE UNAFFECTED. The training and policy material
 * managers actually open keeps working exactly as it did, for every role.
 */

/**
 * The fields this decision reads.
 *
 * Named for the CLIENT type's spelling because `KnowledgeDocument` satisfies it
 * as-is; the server maps its snake_case row onto it at the one call site. Both
 * sides therefore run the same predicate rather than two that must agree.
 */
export interface RestrictedDownloadCandidate {
  readonly title?: string | null;
  readonly fileName?: string | null;
  readonly fileType?: string | null;
  /** Server-side only — the browser's `KnowledgeDocument` carries no MIME type. */
  readonly mimeType?: string | null;
  readonly tags?: readonly string[] | null;
}

/** Plain-text source, by any of the three things that can say so. */
export function isTextSourceDocument(document: RestrictedDownloadCandidate): boolean {
  if ((document.fileType ?? "").trim().toLowerCase() === "txt") return true;

  // `text/plain; charset=utf-8` is the same type as `text/plain`.
  const mime = (document.mimeType ?? "").split(";")[0]!.trim().toLowerCase();
  if (mime === "text/plain") return true;

  const name = (document.fileName ?? "").trim().toLowerCase();
  return name.endsWith(".txt") || name.endsWith(".text");
}

/** Carries a framework role — by its tag, or by an exact recorded filename/title. */
export function isFrameworkDocument(document: RestrictedDownloadCandidate): boolean {
  const candidate: RoleCandidateDocument = {
    // Identity plays no part: neither matcher reads `id`, and a uuid would tie
    // this to one database — the argument `document-roles.ts` already makes.
    id: "",
    title: document.title ?? "",
    original_filename: document.fileName ?? "",
    tags: document.tags ?? null,
  };

  return KNOWLEDGE_DOCUMENT_ROLES.some(
    (role) => hasRoleTag(candidate, role) || matchesRoleFallback(candidate, role),
  );
}

/**
 * Whether the ORIGINAL FILE is administrators-only.
 *
 * Per document, never per endpoint — the file route serves the whole corpus and
 * must keep serving a manager their training PDF unchanged.
 */
export function isAdminOnlyDownload(document: RestrictedDownloadCandidate): boolean {
  return isFrameworkDocument(document) || isTextSourceDocument(document);
}

/** The one sentence shown in place of the controls. */
export const RESTRICTED_DOWNLOAD_MESSAGE =
  "You need admin access to download frameworks.";
