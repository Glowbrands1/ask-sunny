import "server-only";

import { UPLOAD_LIMITS } from "@/lib/config/models";
import { SUPPORTED_KINDS, extensionOf, normalizeMimeType } from "@/lib/ingestion/validation";
import {
  PartFetchError,
  type ConnectionInfo,
  type ContentType,
  type FetchedFile,
  type KnowledgeSourceConnector,
  type ListingResult,
  type SourceRecord,
} from "../types";
import {
  WovenShapeError,
  handbookRecord,
  parseCourseList,
  parseFileLibraryList,
  parseHandbookDownload,
  parseHandbookList,
  parseHandbookManage,
  parseKnowledgeElementList,
  knowledgeElementPageIds,
  knowledgeElementText,
  parseKnowledgeElementPage,
  parsePolicyDetail,
  parsePolicyList,
  parseProcedureAttachments,
  parseProcedureSearch,
  parseProcedureSteps,
  policyAttachmentUrl,
  policyBodyText,
  policyRecord,
  procedureRecord,
  procedureText,
  textDocument,
  withKnowledgeElementContent,
} from "./adapters";
import type { WovenTeamCredentials } from "./config";
import {
  COURSE_LIST_BODY,
  COURSE_LIST_PATH,
  FILE_LIBRARY_LIST_BODY,
  FILE_LIBRARY_LIST_PATH,
  HANDBOOK_DOWNLOAD_FIELDS,
  HANDBOOK_DOWNLOAD_PATH,
  HANDBOOK_LIST_PATH,
  KNOWLEDGE_ELEMENT_LIST_BODY,
  KNOWLEDGE_ELEMENT_LIST_PATH,
  POLICY_LIST_PATH,
  PROCEDURE_SEARCH_BODY,
  PROCEDURE_SEARCH_PATH,
  handbookManagePath,
  knowledgeElementContentPath,
  knowledgeElementDetailPath,
  policyDetailPath,
  procedureDetailPath,
  procedureManagementPath,
} from "./contract";
import { HtmlShapeError } from "./html";
import { WovenTeamClient, WovenTeamError } from "./http";
import { establishSession, type CompanySelector, type CompanyVerifier } from "./session";

/**
 * ============================================================================
 * THE WOVEN KNOWLEDGE CONNECTOR — the Woven side of the source-neutral engine
 * ============================================================================
 *
 *   connect()    sign in, select and CONFIRM the company, or throw
 *   list(type)   read one content type completely, or report exactly why not
 *   fetchPart()  obtain a FRESH temporary link and the bytes, immediately
 *
 * SESSION RECOVERY IS AUTOMATIC. Any read that finds the session expired signs
 * in again once and repeats the read. A second expiry is a real failure.
 *
 * ONE CONTENT TYPE FAILING NEVER FAILS ANOTHER. `list` never throws for an
 * adapter problem; it returns `ok: false` with a code, and the engine leaves
 * that type's items exactly as they were.
 *
 * DOWNLOADS: handbook versions (verified `_Handbook_DownloadVersion`) and
 * policy attachments (the detail page's own fresh temporary URL, fetched at the
 * moment of download). TEXT: policy bodies, procedure steps and Knowledge
 * Element pages, read from their verified page structure. File Library files,
 * Procedure attachment files and Course items are BLOCKED until their requests
 * or row schema are captured; their parts never reach `fetchPart`.
 */

export interface WovenConnectorOptions {
  client: WovenTeamClient;
  credentials: WovenTeamCredentials;
  company: string;
  /** The company's Woven id, sent only if sign-in lands on another company. */
  companyId?: string | null;
  selector?: CompanySelector;
  verifier?: CompanyVerifier;
  maxBytes?: number;
}

/** A connector-level failure, with a `woven_` code the run ledger and admin screen understand. */
export class WovenConnectorError extends Error {
  readonly code: string;
  readonly sessionLost: boolean;
  constructor(code: string, message: string, sessionLost = false) {
    super(message);
    this.name = "WovenConnectorError";
    this.code = code;
    this.sessionLost = sessionLost;
  }
}

const NOT_RETRYABLE = new Set(["too_large", "download_host_not_allowed", "not_found"]);

function codeOf(error: unknown): string {
  if (error instanceof WovenTeamError) return `woven_${error.code}`;
  if (error instanceof WovenShapeError) return `woven_${error.code}`;
  if (error instanceof HtmlShapeError) return "woven_unexpected_shape";
  return "woven_unexpected";
}

function messageOf(error: unknown): string {
  if (error instanceof WovenTeamError || error instanceof WovenShapeError || error instanceof HtmlShapeError) return error.message;
  return "Woven returned something Ask Sunny did not expect.";
}

export class WovenKnowledgeConnector implements KnowledgeSourceConnector {
  readonly source = "woven" as const;
  private readonly options: WovenConnectorOptions;
  private connection: ConnectionInfo | null = null;

  constructor(options: WovenConnectorOptions) {
    this.options = options;
  }

  get requestsMade(): number {
    return this.options.client.requestsMade;
  }

  async connect(): Promise<ConnectionInfo> {
    try {
      const session = await establishSession(this.options.client, this.options);
      this.connection = { companyLabel: session.companyLabel, companyVerified: true };
      return this.connection;
    } catch (error) {
      throw new WovenConnectorError(codeOf(error), messageOf(error));
    }
  }

  /** Runs a read; if the session expired, signs in once more and repeats it. */
  private async withSession<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (!(error instanceof WovenTeamError) || error.code !== "session_expired") throw error;
      try {
        await establishSession(this.options.client, this.options);
      } catch (again) {
        throw new WovenConnectorError(codeOf(again), messageOf(again), true);
      }
      return read();
    }
  }

  async list(contentType: ContentType): Promise<ListingResult> {
    if (!this.connection) return { ok: false, contentType, code: "woven_not_connected", message: "Not signed in to Woven." };
    try {
      const { records, diagnostics } = await this.read(contentType);
      return { ok: true, contentType, records, diagnostics };
    } catch (error) {
      return { ok: false, contentType, code: error instanceof WovenConnectorError ? error.code : codeOf(error), message: messageOf(error) };
    }
  }

  private async read(contentType: ContentType): Promise<{ records: SourceRecord[]; diagnostics: Record<string, unknown> }> {
    const client = this.options.client;
    switch (contentType) {
      case "policy": {
        const listing = parsePolicyList(await this.withSession(() => client.getHtml(POLICY_LIST_PATH)));
        const records: SourceRecord[] = [];
        for (const base of listing.records) {
          const html = await this.withSession(() => client.getHtml(policyDetailPath(base.entityId)));
          records.push(policyRecord(base, parsePolicyDetail(html, listing.hasAttachments.get(base.entityId) === true)));
        }
        return { records, diagnostics: listing.diagnostics };
      }
      case "handbook": {
        const rows = parseHandbookList(await this.withSession(() => client.postJson(HANDBOOK_LIST_PATH, undefined)));
        const records: SourceRecord[] = [];
        for (const row of rows) {
          const html = await this.withSession(() => client.getHtml(handbookManagePath(row.id)));
          records.push(handbookRecord(row, parseHandbookManage(html, row.id)));
        }
        return { records, diagnostics: { rows: rows.length } };
      }
      case "procedure": {
        const cards = parseProcedureSearch(await this.withSession(() => client.postJson(PROCEDURE_SEARCH_PATH, PROCEDURE_SEARCH_BODY)));
        const records: SourceRecord[] = [];
        let managementUnreadable = 0;
        for (const card of cards) {
          const html = await this.withSession(() => client.getHtml(procedureDetailPath(card.id)));
          /*
           * The management view is where attachment ids are exposed. It is an
           * enrichment: attachment bytes are blocked anyway, so a management page
           * this account cannot read leaves the attachments unknown this run
           * rather than failing the procedure listing.
           */
          let attachments: ReturnType<typeof parseProcedureAttachments> | null = null;
          try {
            attachments = parseProcedureAttachments(await this.withSession(() => client.getHtml(procedureManagementPath(card.id))));
          } catch (error) {
            if (error instanceof WovenTeamError && error.sessionLost) throw error;
            managementUnreadable += 1;
          }
          records.push(procedureRecord(card, html, attachments));
        }
        return { records, diagnostics: { cards: cards.length, managementUnreadable } };
      }
      case "file_library": {
        const parsed = parseFileLibraryList(await this.withSession(() => client.postJson(FILE_LIBRARY_LIST_PATH, FILE_LIBRARY_LIST_BODY)));
        return { records: parsed.records, diagnostics: { typeLabels: parsed.typeLabels } };
      }
      case "knowledge_element": {
        const listed = parseKnowledgeElementList(await this.withSession(() => client.postJson(KNOWLEDGE_ELEMENT_LIST_PATH, KNOWLEDGE_ELEMENT_LIST_BODY)));
        /* Content is read only for published elements: a draft is never synced, so its pages are not fetched. */
        const records: SourceRecord[] = [];
        let unsupported = 0;
        for (const record of listed) {
          if (record.publication !== "published") {
            records.push(record);
            continue;
          }
          const content = await this.readKnowledgeElement(record.entityId);
          if (content.text === null) unsupported += 1;
          records.push(withKnowledgeElementContent(record, content.pages, content.text));
        }
        return { records, diagnostics: { unsupportedContent: unsupported } };
      }
      case "course": {
        const records = parseCourseList(await this.withSession(() => client.postJson(COURSE_LIST_PATH, COURSE_LIST_BODY)));
        return { records, diagnostics: {} };
      }
    }
  }

  /**
   * A Knowledge Element's pages, read in order. `text: null` when it has no
   * content page, or any page is not the verified `.content[content-id]` kind:
   * partial content is never synced as if it were the whole element.
   */
  private async readKnowledgeElement(elementId: string): Promise<{ pages: number; text: string | null }> {
    const client = this.options.client;
    const details = await this.withSession(() => client.getHtml(knowledgeElementDetailPath(elementId)));
    const pageIds = knowledgeElementPageIds(details, elementId);
    if (pageIds.length === 0) return { pages: 0, text: null };
    const pages: NonNullable<ReturnType<typeof parseKnowledgeElementPage>>[] = [];
    for (const pageId of pageIds) {
      const page = parseKnowledgeElementPage(await this.withSession(() => client.getHtml(knowledgeElementContentPath(elementId, pageId))), pageId);
      if (!page) return { pages: pageIds.length, text: null };
      pages.push(page);
    }
    const text = knowledgeElementText(pages);
    return { pages: pageIds.length, text: text.length > 0 ? text : null };
  }

  /* ------------------------------------------------------------ files -- */

  async fetchPart(item: Parameters<KnowledgeSourceConnector["fetchPart"]>[0]): Promise<FetchedFile> {
    try {
      if (item.contentType === "handbook" && item.partKey === "current-version") {
        return await this.fetchHandbook(item.locator);
      }
      if (item.contentType === "policy" && item.partKey.startsWith("attachment:")) {
        return await this.fetchPolicyAttachment(item.locator, item.fileName, item.mimeType);
      }
      if (item.partKey === "content") {
        return await this.fetchText(item.contentType, item.locator, item.entityId, item.title);
      }
      throw new PartFetchError("capability_unavailable", "Ask Sunny cannot download this kind of Woven item yet.", false);
    } catch (error) {
      if (error instanceof PartFetchError) throw error;
      if (error instanceof WovenConnectorError) {
        throw new PartFetchError(error.code, error.message, true, { sessionLost: error.sessionLost });
      }
      if (error instanceof WovenTeamError) {
        throw new PartFetchError(`woven_${error.code}`, error.message, !NOT_RETRYABLE.has(error.code), { sessionLost: error.sessionLost });
      }
      throw new PartFetchError(codeOf(error), messageOf(error), true);
    }
  }

  /**
   * A text part (policy body, procedure steps, Knowledge Element pages), read
   * fresh from its page and handed to the pipeline as a plain-text document.
   * A page that no longer has the verified structure is a per-item failure.
   */
  private async fetchText(contentType: ContentType, locator: Record<string, string>, entityId: string, title: string): Promise<FetchedFile> {
    const client = this.options.client;
    let body: string | null = null;
    if (contentType === "policy" && locator.policyId) {
      const html = await this.withSession(() => client.getHtml(policyDetailPath(locator.policyId!)));
      body = policyBodyText(html);
    } else if (contentType === "procedure" && locator.procedureId) {
      const steps = parseProcedureSteps(await this.withSession(() => client.getHtml(procedureDetailPath(locator.procedureId!))));
      body = steps ? procedureText(steps) : null;
    } else if (contentType === "knowledge_element" && locator.elementId) {
      body = (await this.readKnowledgeElement(locator.elementId)).text;
    } else {
      throw new PartFetchError("capability_unavailable", "Ask Sunny cannot read this kind of Woven page yet.", false);
    }
    if (body === null) {
      throw new PartFetchError("woven_unexpected_shape", "This Woven page no longer has the layout Ask Sunny reads.", true);
    }
    if (body.trim().length === 0) throw new PartFetchError("empty_file", "This Woven item has no text.", true);
    return {
      bytes: textDocument(title, body),
      fileName: `${contentType}-${entityId}.txt`,
      mimeType: "text/plain",
    };
  }

  private maxBytes(): number {
    return this.options.maxBytes ?? UPLOAD_LIMITS.maxBytes;
  }

  /**
   * Handbook: ask Woven for a fresh download link for this exact version, and
   * use it at once. An expired link is asked for again, once.
   */
  private async fetchHandbook(locator: Record<string, string>): Promise<FetchedFile> {
    const { handbookId, versionId } = locator;
    if (!handbookId || !versionId) throw new PartFetchError("no_locator", "This handbook has no version to download.", false);
    for (let attempt = 0; ; attempt += 1) {
      const link = parseHandbookDownload(
        await this.withSession(() =>
          this.options.client.postForm(HANDBOOK_DOWNLOAD_PATH, {
            [HANDBOOK_DOWNLOAD_FIELDS.handbookId]: handbookId,
            [HANDBOOK_DOWNLOAD_FIELDS.versionId]: versionId,
          }),
        ),
      );
      try {
        const file = await this.options.client.downloadSigned(link.url, this.maxBytes());
        return indexableFile(file.bytes, link.fileName, file.contentType);
      } catch (error) {
        if (attempt === 0 && error instanceof WovenTeamError && error.code === "download_link_expired") continue;
        throw error;
      }
    }
  }

  /**
   * Policy attachment: re-read the policy's detail page for a FRESH temporary
   * URL for this document id, and download it at once. An expired link means
   * reading the page again, once.
   */
  private async fetchPolicyAttachment(locator: Record<string, string>, fileName: string | null, mimeType: string | null): Promise<FetchedFile> {
    const { policyId, documentId } = locator;
    if (!policyId || !documentId) throw new PartFetchError("no_locator", "This attachment cannot be located.", false);
    for (let attempt = 0; ; attempt += 1) {
      const html = await this.withSession(() => this.options.client.getHtml(policyDetailPath(policyId)));
      const url = policyAttachmentUrl(html, documentId);
      if (!url) {
        throw new PartFetchError("attachment_missing", "This attachment is no longer on the policy in Woven.", true);
      }
      try {
        const file = await this.options.client.downloadSigned(url, this.maxBytes());
        return indexableFile(file.bytes, fileName ?? `${documentId}.pdf`, mimeType ?? file.contentType);
      } catch (error) {
        if (attempt === 0 && error instanceof WovenTeamError && error.code === "download_link_expired") continue;
        throw error;
      }
    }
  }
}

/**
 * Settles the file name and MIME type Ask Sunny's validator will accept, from
 * the extension first and the declared type second. A file Ask Sunny cannot
 * index is a permanent, per-item outcome, not a retry.
 */
export function indexableFile(bytes: Uint8Array, fileName: string, declaredMime: string): FetchedFile {
  const ext = extensionOf(fileName);
  const mime = normalizeMimeType(declaredMime);
  const byExt = SUPPORTED_KINDS.find((k) => k.extensions.includes(ext));
  const byMime = SUPPORTED_KINDS.find((k) => k.mimeTypes.includes(mime));
  const kind = byExt ?? byMime;
  if (!kind) {
    throw new PartFetchError("unsupported_format", "This Woven file is not a format Ask Sunny can read.", false);
  }
  if (bytes.byteLength === 0) throw new PartFetchError("empty_file", "Woven returned an empty file.", true);
  return {
    bytes,
    fileName: byExt ? fileName : `${fileName.replace(/\.[^.]*$/, "")}.${kind.extensions[0]}`,
    mimeType: kind.mimeTypes.includes(mime) ? mime : kind.mimeTypes[0]!,
  };
}
