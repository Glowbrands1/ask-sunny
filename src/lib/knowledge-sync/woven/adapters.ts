import { createHash } from "node:crypto";

import { SUPPORTED_KINDS, normalizeMimeType } from "@/lib/ingestion/validation";
import type { Publication, SourcePart, SourceRecord } from "../types";
import {
  CAPABILITY,
  COURSE_COLUMNS,
  FILE_LIBRARY_COLUMNS,
  FILE_LIBRARY_INDEXABLE_TYPES,
  FILE_LIBRARY_PUBLISHED_STATUSES,
  FILE_LIBRARY_UNPUBLISHED_STATUSES,
  HANDBOOK_COLUMNS,
  HANDBOOK_PUBLISHED_STATUSES,
  HANDBOOK_UNPUBLISHED_STATUSES,
  HANDBOOK_VARS,
  KNOWLEDGE_ELEMENT_COLUMNS,
  LEARNING_PUBLISHED_STATUSES,
  LEARNING_UNPUBLISHED_STATUSES,
  POLICY_ATTACHMENTS_VAR,
  POLICY_ATTACHMENT_FIELDS,
  POLICY_HEADER_HINTS,
  POLICY_PUBLISHED_STATUSES,
  POLICY_ROW_ATTRS,
  POLICY_UNPUBLISHED_STATUSES,
  PROCEDURE_CARD_ATTR,
} from "./contract";
import {
  HtmlShapeError,
  attr,
  childrenByTag,
  closest,
  elementsByTag,
  elementsWithAttr,
  hrefs,
  htmlText,
  pageContentText,
  parseHtmlDocument,
  parseHtmlFragment,
  readInlineVar,
  textOf,
  type HtmlElement,
} from "./html";

/**
 * ============================================================================
 * THE SIX WOVEN ADAPTERS — responses in, normalised records out
 * ============================================================================
 *
 * PURE: every function here takes a response body Woven sent and returns
 * `SourceRecord`s, so each is tested against a redacted fixture of the
 * handoff's shapes with no network at all. `connector.ts` makes the requests.
 *
 * A SHAPE THAT DOES NOT MATCH IS AN ERROR, NOT AN EMPTY LIST. A missing
 * `list` array, a `Success: false`, a page without the policy table, or rows
 * that mostly lack an id throw `WovenShapeError`; the connector turns that into
 * a failed listing, and a failed listing removes nothing.
 *
 * NO SIGNED URL SURVIVES PARSING. `AzureFileURL` is read only by
 * `policyAttachmentUrl`, at download time, and is never put on a record.
 */

export class WovenShapeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "WovenShapeError";
    this.code = code;
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,199}$/;

export function validId(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const id = String(value).trim();
  return ID_PATTERN.test(id) ? id : null;
}

export function publicationOf(status: string | null, published: readonly string[], unpublished: readonly string[]): Publication {
  const value = (status ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (published.includes(value)) return "published";
  if (unpublished.includes(value)) return "unpublished";
  return "unknown";
}

/** "5/13/2026" → "2026-05-13"; an ISO date or date-time keeps its date (and time). Anything else: null. */
export function toIsoDate(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  const iso = /^(\d{4}-\d{2}-\d{2})(T[\d:.]+Z?)?/.exec(text);
  if (iso) return iso[2] ? `${iso[1]}${iso[2]}`.slice(0, 40) : iso[1]!;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(text);
  if (us) return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
  return null;
}

/** Audience labels from a cell such as "Public" or "Managers, Directors". Empty → null (none stated). */
export function audienceLabels(text: string): string[] | null {
  const labels = text
    .split(/[,;\n]/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
  return labels.length > 0 ? labels : null;
}

function fallbackTitle(label: string, id: string): string {
  return `${label} ${id.slice(0, 8)}`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** A part whose bytes are not obtainable yet. */
function blockedPart(partKey: string, title: string, capability: string): SourcePart {
  return { partKey, title, fileName: null, documentId: null, versionId: null, mimeType: null, sizeBytes: null, retrieval: { kind: "blocked", capability } };
}

function isIndexableMime(mimeType: string | null, fileName: string | null): boolean {
  const mime = mimeType ? normalizeMimeType(mimeType) : "";
  const ext = (fileName ?? "").split(".").pop()?.toLowerCase() ?? "";
  return SUPPORTED_KINDS.some((kind) => kind.mimeTypes.includes(mime) || kind.extensions.includes(ext));
}

/** Refuses a read where more rows lacked an id than had one: the field names have drifted. */
function assertMostlyReadable(accepted: number, rejected: number, what: string): void {
  if (rejected > 0 && rejected >= accepted) {
    throw new WovenShapeError("mostly_unreadable", `${rejected} ${what} rows had no usable id, against ${accepted} that did.`);
  }
}

/* --------------------------------------------------- DataTables shapes -- */

/** `{ list: [...] }`, the verified DataTables shape. Anything else is a changed endpoint. */
export function requireList(body: unknown, what: string): Record<string, unknown>[] {
  if (typeof body !== "object" || body === null || !Array.isArray((body as { list?: unknown }).list)) {
    throw new WovenShapeError("unexpected_shape", `Woven's ${what} response did not contain the expected list.`);
  }
  const list = (body as { list: unknown[] }).list;
  if (list.some((row) => typeof row !== "object" || row === null)) {
    throw new WovenShapeError("unexpected_shape", `Woven's ${what} list contained rows Ask Sunny could not read.`);
  }
  return list as Record<string, unknown>[];
}

/** `{ Success: true, HTML: "..." }`, the verified card-list shape. */
export function requireSuccessHtml(body: unknown, what: string): string {
  const record = body as { Success?: unknown; HTML?: unknown } | null;
  if (!record || typeof record !== "object" || record.Success !== true || typeof record.HTML !== "string") {
    throw new WovenShapeError("unexpected_shape", `Woven's ${what} response was not a successful list.`);
  }
  return record.HTML;
}

/** A DataTables date cell: the hidden ISO span when present, else the visible date. */
export function dateCell(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.includes("<")) {
    const fragment = parseHtmlFragment(value);
    for (const span of elementsByTag(fragment, "span")) {
      if (/\bhidden\b/.test(attr(span, "class") ?? "")) {
        const iso = toIsoDate(textOf(span));
        if (iso) return iso;
      }
    }
  }
  return toIsoDate(htmlText(value));
}

/* --------------------------------------------------------------- policy -- */

export interface PolicyListing {
  records: Omit<SourceRecord, "parts" | "attachmentIds" | "documentIds">[];
  hasAttachments: Map<string, boolean>;
  diagnostics: { headers: string[]; audienceColumnFound: boolean; updatedColumnFound: boolean; rejected: number };
}

/** `GET /Policy` — the management table. */
export function parsePolicyList(html: string): PolicyListing {
  const doc = parseHtmlDocument(html);
  const rows = elementsWithAttr(doc, POLICY_ROW_ATTRS.id);
  if (rows.length === 0 && elementsByTag(doc, "table").length === 0) {
    throw new WovenShapeError("unexpected_shape", "Woven's policy page did not contain the policy table.");
  }

  const table = rows[0] ? closest(rows[0], "table") : elementsByTag(doc, "table")[0]!;
  const headers = table ? elementsByTag(table, "th").map((th) => textOf(th)) : [];
  const audienceIndex = headers.findIndex((h) => POLICY_HEADER_HINTS.audience.test(h));
  const updatedIndex = headers.findIndex((h) => POLICY_HEADER_HINTS.updated.test(h));

  const records: PolicyListing["records"] = [];
  const hasAttachments = new Map<string, boolean>();
  let rejected = 0;
  const seen = new Set<string>();

  for (const row of rows) {
    const id = validId(attr(row, POLICY_ROW_ATTRS.id));
    if (!id) {
      rejected += 1;
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);

    const cells = childrenByTag(row, "td");
    const link = elementsByTag(row, "a").find((a) => (attr(a, "href") ?? "").toLowerCase().includes(`/policy/details/${id.toLowerCase()}`));
    const title = (link ? textOf(link) : "") || fallbackTitle("Policy", id);
    const disabled = (attr(row, POLICY_ROW_ATTRS.disabled) ?? "").toLowerCase() === "true";
    const status = attr(row, POLICY_ROW_ATTRS.status);
    const audienceText = audienceIndex >= 0 && cells[audienceIndex] ? textOf(cells[audienceIndex]!) : "";
    const updatedText = updatedIndex >= 0 && cells[updatedIndex] ? textOf(cells[updatedIndex]!) : "";

    hasAttachments.set(id, (attr(row, POLICY_ROW_ATTRS.hasAttachments) ?? "").toLowerCase() === "true");
    records.push({
      source: "woven",
      contentType: "policy",
      entityId: id,
      title,
      status,
      publication: disabled ? "unpublished" : publicationOf(status, POLICY_PUBLISHED_STATUSES, POLICY_UNPUBLISHED_STATUSES),
      audience: audienceLabels(audienceText),
      version: null,
      versionId: null,
      updatedAt: toIsoDate(updatedText),
      contentFingerprint: null,
      sourceMetadata: { disabled },
    });
  }
  assertMostlyReadable(records.length, rejected, "policy");

  return {
    records,
    hasAttachments,
    diagnostics: { headers, audienceColumnFound: audienceIndex >= 0, updatedColumnFound: updatedIndex >= 0, rejected },
  };
}

export interface PolicyAttachment {
  documentId: string;
  name: string;
  sizeBytes: number | null;
  contentType: string | null;
}

function readAttachmentArray(html: string, expectAttachments: boolean): Record<string, unknown>[] {
  const value = readInlineVar(parseHtmlDocument(html), POLICY_ATTACHMENTS_VAR);
  if (value === undefined) {
    if (expectAttachments) {
      throw new WovenShapeError("unexpected_shape", "A policy marked as having attachments did not list them.");
    }
    return [];
  }
  if (!Array.isArray(value) || value.some((v) => typeof v !== "object" || v === null)) {
    throw new WovenShapeError("unexpected_shape", "A policy's attachment list was not in the expected form.");
  }
  return value as Record<string, unknown>[];
}

/** `GET /Policy/Details/{id}` — the attachment metadata. The signed URL is deliberately not returned. */
export function parsePolicyAttachments(html: string, expectAttachments: boolean): PolicyAttachment[] {
  const out: PolicyAttachment[] = [];
  for (const raw of readAttachmentArray(html, expectAttachments)) {
    const documentId = validId(raw[POLICY_ATTACHMENT_FIELDS.documentId]);
    if (!documentId) throw new WovenShapeError("unexpected_shape", "A policy attachment had no usable document id.");
    const size = Number(raw[POLICY_ATTACHMENT_FIELDS.size]);
    out.push({
      documentId,
      name: typeof raw[POLICY_ATTACHMENT_FIELDS.name] === "string" ? String(raw[POLICY_ATTACHMENT_FIELDS.name]) : `${documentId}.pdf`,
      sizeBytes: Number.isFinite(size) && size >= 0 ? size : null,
      contentType: typeof raw[POLICY_ATTACHMENT_FIELDS.contentType] === "string" ? String(raw[POLICY_ATTACHMENT_FIELDS.contentType]) : null,
    });
  }
  return out;
}

/** The FRESH temporary URL for one attachment, read at download time and used once. */
export function policyAttachmentUrl(html: string, documentId: string): string | null {
  for (const raw of readAttachmentArray(html, false)) {
    if (validId(raw[POLICY_ATTACHMENT_FIELDS.documentId]) === documentId) {
      const url = raw[POLICY_ATTACHMENT_FIELDS.url];
      return typeof url === "string" && url.length > 0 ? url : null;
    }
  }
  return null;
}

function stem(fileName: string): string {
  return fileName.replace(/\.[A-Za-z0-9]{1,8}$/, "");
}

export function policyRecord(base: PolicyListing["records"][number], attachments: PolicyAttachment[]): SourceRecord {
  const parts: SourcePart[] = [blockedPart("content", base.title, CAPABILITY.policyBody)];
  for (const a of attachments) {
    const indexable = isIndexableMime(a.contentType, a.name);
    parts.push({
      partKey: `attachment:${a.documentId}`,
      title: attachments.length === 1 ? base.title : `${base.title} — ${stem(a.name)}`,
      fileName: a.name,
      documentId: a.documentId,
      versionId: null,
      mimeType: a.contentType,
      sizeBytes: a.sizeBytes,
      retrieval: indexable
        ? { kind: "available", locator: { policyId: base.entityId, documentId: a.documentId } }
        : { kind: "unsupported_format", detail: a.contentType ?? "unknown" },
    });
  }
  const ids = attachments.map((a) => a.documentId);
  return { ...base, documentIds: ids, attachmentIds: ids, parts };
}

/* -------------------------------------------------------------- handbook -- */

export interface HandbookRow {
  id: string;
  title: string;
  status: string | null;
  audience: string[] | null;
  updatedAt: string | null;
}

/** `POST /KnowledgeCenter/_Handbooks_List_ForDataTable`. */
export function parseHandbookList(body: unknown): HandbookRow[] {
  const rows: HandbookRow[] = [];
  let rejected = 0;
  for (const row of requireList(body, "handbook")) {
    const id = validId(row[HANDBOOK_COLUMNS.id]);
    if (!id) {
      rejected += 1;
      continue;
    }
    rows.push({
      id,
      title: htmlText(row[HANDBOOK_COLUMNS.name]) || fallbackTitle("Handbook", id),
      status: htmlText(row[HANDBOOK_COLUMNS.status]) || null,
      audience: audienceLabels(htmlText(row[HANDBOOK_COLUMNS.audience])),
      updatedAt: dateCell(row[HANDBOOK_COLUMNS.updated]),
    });
  }
  assertMostlyReadable(rows.length, rejected, "handbook");
  return rows;
}

export interface HandbookManage {
  currentVersionId: string | null;
  draftVersionId: string | null;
  updatedOn: string | null;
  name: string | null;
}

/** `GET /KnowledgeCenter/Handbooks/{id}/manage` — the inline version variables. */
export function parseHandbookManage(html: string, expectedId: string): HandbookManage {
  const doc = parseHtmlDocument(html);
  const id = readInlineVar(doc, HANDBOOK_VARS.id);
  if (id === undefined) throw new WovenShapeError("unexpected_shape", "A handbook page did not carry its handbook id.");
  if (validId(id) !== expectedId) throw new WovenShapeError("unexpected_shape", "A handbook page was for a different handbook.");
  const read = (name: string): string | null => {
    const value = readInlineVar(doc, name);
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  };
  return {
    currentVersionId: validId(read(HANDBOOK_VARS.currentVersionId)),
    draftVersionId: validId(read(HANDBOOK_VARS.draftVersionId)),
    updatedOn: toIsoDate(read(HANDBOOK_VARS.updatedOn)),
    name: read(HANDBOOK_VARS.name),
  };
}

export function handbookRecord(row: HandbookRow, manage: HandbookManage): SourceRecord {
  const listed = publicationOf(row.status, HANDBOOK_PUBLISHED_STATUSES, HANDBOOK_UNPUBLISHED_STATUSES);
  /* Published with no current version is nothing to read. */
  const publication: Publication = listed === "published" && !manage.currentVersionId ? "unpublished" : listed;
  const title = row.title;
  const part: SourcePart = {
    partKey: "current-version",
    title,
    fileName: null,
    documentId: null,
    versionId: manage.currentVersionId,
    mimeType: null,
    sizeBytes: null,
    retrieval: manage.currentVersionId
      ? { kind: "available", locator: { handbookId: row.id, versionId: manage.currentVersionId } }
      : blockedPart("current-version", title, "handbook_no_current_version").retrieval,
  };
  return {
    source: "woven",
    contentType: "handbook",
    entityId: row.id,
    title,
    status: row.status,
    publication,
    audience: row.audience,
    version: null,
    versionId: manage.currentVersionId,
    updatedAt: manage.updatedOn ?? row.updatedAt,
    documentIds: [],
    attachmentIds: [],
    contentFingerprint: null,
    sourceMetadata: { hasDraft: manage.draftVersionId !== null },
    parts: [part],
  };
}

/** `POST /KnowledgeCenter/_Handbook_DownloadVersion` — the fresh download link. */
export function parseHandbookDownload(body: unknown): { url: string; fileName: string } {
  const record = body as { Success?: unknown; Download?: { DownloadURL?: unknown; FileName?: unknown } } | null;
  if (!record || record.Success !== true || !record.Download || typeof record.Download.DownloadURL !== "string") {
    throw new WovenShapeError("download_refused", "Woven did not provide a download for this handbook version.");
  }
  const fileName = typeof record.Download.FileName === "string" && record.Download.FileName.trim() ? record.Download.FileName.trim() : "handbook.pdf";
  return { url: record.Download.DownloadURL, fileName };
}

/* ------------------------------------------------------------- procedure -- */

export interface ProcedureCard {
  id: string;
  title: string;
}

/** `POST /KnowledgeCenter/_Search_Procedures` — cards carrying `data-procedure-id`. */
export function parseProcedureSearch(body: unknown): ProcedureCard[] {
  const fragment = parseHtmlFragment(requireSuccessHtml(body, "procedure"));
  const cards: ProcedureCard[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  for (const card of elementsWithAttr(fragment, PROCEDURE_CARD_ATTR)) {
    const id = validId(attr(card, PROCEDURE_CARD_ATTR));
    if (!id) {
      rejected += 1;
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    /* UNVERIFIED card markup: the first heading, else the first link, is the title. Display only. */
    const heading = [...elementsByTag(card, "h1"), ...elementsByTag(card, "h2"), ...elementsByTag(card, "h3"), ...elementsByTag(card, "h4"), ...elementsByTag(card, "h5")][0];
    const link = elementsByTag(card, "a")[0];
    cards.push({ id, title: (heading ? textOf(heading) : link ? textOf(link) : "") || fallbackTitle("Procedure", id) });
  }
  assertMostlyReadable(cards.length, rejected, "procedure");
  return cards;
}

/**
 * A procedure's change fingerprint: its detail page's normalised content text.
 * Procedures carry no dependable updated date, so the monthly scan reads each
 * detail page and compares this. Scripts, styles and form values never
 * contribute, so a rotating token is not a change.
 */
export function procedureFingerprint(html: string): string {
  const text = pageContentText(parseHtmlDocument(html));
  if (text.length === 0) throw new WovenShapeError("unexpected_shape", "A procedure page had no readable content.");
  return digest(text);
}

export function procedureRecord(card: ProcedureCard, fingerprint: string): SourceRecord {
  return {
    source: "woven",
    contentType: "procedure",
    entityId: card.id,
    title: card.title,
    /* Listed in the employee Knowledge Center search: what Woven shows employees. */
    status: "Listed",
    publication: "published",
    audience: null,
    version: null,
    versionId: null,
    updatedAt: null,
    documentIds: [],
    attachmentIds: [],
    contentFingerprint: fingerprint,
    sourceMetadata: {},
    parts: [blockedPart("content", card.title, CAPABILITY.procedureContent)],
  };
}

/* ---------------------------------------------------------- file library -- */

/** `POST /FileLibrary/_FileLibrary_Management_List_ForDataTable`. */
export function parseFileLibraryList(body: unknown): { records: SourceRecord[]; typeLabels: Record<string, number> } {
  const records: SourceRecord[] = [];
  const typeLabels: Record<string, number> = {};
  let rejected = 0;
  for (const row of requireList(body, "file library")) {
    const id = validId(row[FILE_LIBRARY_COLUMNS.id]);
    if (!id) {
      rejected += 1;
      continue;
    }
    const type = htmlText(row[FILE_LIBRARY_COLUMNS.type]);
    typeLabels[type || "(none)"] = (typeLabels[type || "(none)"] ?? 0) + 1;
    const title = htmlText(row[FILE_LIBRARY_COLUMNS.title]) || fallbackTitle("File", id);
    const status = htmlText(row[FILE_LIBRARY_COLUMNS.status]) || null;
    const size = htmlText(row[FILE_LIBRARY_COLUMNS.size]);
    const indexable = FILE_LIBRARY_INDEXABLE_TYPES.find((t) => t.pattern.test(type));
    records.push({
      source: "woven",
      contentType: "file_library",
      entityId: id,
      title,
      status,
      publication: publicationOf(status, FILE_LIBRARY_PUBLISHED_STATUSES, FILE_LIBRARY_UNPUBLISHED_STATUSES),
      audience: audienceLabels(htmlText(row[FILE_LIBRARY_COLUMNS.audience])),
      version: null,
      versionId: null,
      updatedAt: dateCell(row[FILE_LIBRARY_COLUMNS.updated]),
      documentIds: [id],
      attachmentIds: [],
      contentFingerprint: digest(`${type}|${size}`),
      sourceMetadata: { type, size, library: htmlText(row[FILE_LIBRARY_COLUMNS.library]) || null },
      parts: [
        indexable
          ? { ...blockedPart("file", title, CAPABILITY.fileLibraryDownload), documentId: id, mimeType: indexable.mimeType }
          : {
              partKey: "file",
              title,
              fileName: null,
              documentId: id,
              versionId: null,
              mimeType: null,
              sizeBytes: null,
              retrieval: { kind: "unsupported_format", detail: type || "unknown" },
            },
      ],
    });
  }
  assertMostlyReadable(records.length, rejected, "file library");
  return { records, typeLabels };
}

/* ------------------------------------------------- learning (KE, course) -- */

function learningRecords(
  body: unknown,
  what: string,
  contentType: "knowledge_element" | "course",
  columns: { id: string; status: string; title: string; version: string; tags: string; updated: string },
  capability: string,
): SourceRecord[] {
  const records: SourceRecord[] = [];
  let rejected = 0;
  for (const row of requireList(body, what)) {
    const id = validId(row[columns.id]);
    if (!id) {
      rejected += 1;
      continue;
    }
    const titleCell = row[columns.title];
    const title = htmlText(titleCell) || fallbackTitle(contentType === "course" ? "Course" : "Knowledge Element", id);
    const status = htmlText(row[columns.status]) || null;
    records.push({
      source: "woven",
      contentType,
      entityId: id,
      title,
      status,
      publication: publicationOf(status, LEARNING_PUBLISHED_STATUSES, LEARNING_UNPUBLISHED_STATUSES),
      audience: null,
      version: htmlText(row[columns.version]) || null,
      versionId: null,
      updatedAt: dateCell(row[columns.updated]),
      documentIds: [],
      attachmentIds: [],
      contentFingerprint: null,
      sourceMetadata: {
        tags: htmlText(row[columns.tags]) || null,
        linked: typeof titleCell === "string" && hrefs(parseHtmlFragment(titleCell)).length > 0,
      },
      parts: [blockedPart("content", title, capability)],
    });
  }
  assertMostlyReadable(records.length, rejected, what);
  return records;
}

/** `POST /KnowledgeElement/_KnowledgeElement_List_ForDataTable`. */
export function parseKnowledgeElementList(body: unknown): SourceRecord[] {
  return learningRecords(body, "knowledge element", "knowledge_element", KNOWLEDGE_ELEMENT_COLUMNS, CAPABILITY.knowledgeElementContent);
}

/** `POST /Course/_Course_List_ForDataTable`. */
export function parseCourseList(body: unknown): SourceRecord[] {
  return learningRecords(body, "course", "course", COURSE_COLUMNS, CAPABILITY.courseContent);
}

export { HtmlShapeError };
export type { HtmlElement };
