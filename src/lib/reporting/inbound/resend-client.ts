import "server-only";

import { XLSX_MIME } from "../ingest";

/**
 * THE RESEND RECEIVING API, AND CHOOSING THE WORKBOOK OUT OF AN EMAIL.
 *
 * The `email.received` webhook carries attachment METADATA only — an id, a
 * filename, a content type, a disposition. The bytes come from two further
 * calls: list the attachments, then fetch the signed `download_url` each one
 * carries. So this module exists because a webhook payload is not a file.
 *
 * WHAT IT WILL NOT DO:
 *
 *   IT DOES NOT SEND THE API KEY TO THE DOWNLOAD URL. That URL is already a
 *   signed, expiring capability pointing at object storage on a different host;
 *   attaching an Authorization header to it would leak the key to whatever is
 *   on the other end. The key goes to `api.resend.com` and nowhere else.
 *
 *   IT DOES NOT TRUST THE CONTENT TYPE ALONE. Mail transports mislabel
 *   attachments constantly, in both directions — a workbook arriving as
 *   `application/octet-stream` is ordinary, and so is a PDF arriving with a
 *   spreadsheet type because somebody renamed it. So a candidate is chosen on
 *   type OR extension, and then the BYTES are checked: an `.xlsx` is a ZIP
 *   container, so it starts `PK\\x03\\x04`. Anything else is not a workbook
 *   whatever it claims.
 *
 *   IT DOES NOT FETCH EVERY ATTACHMENT. A signature image, a logo and a PDF
 *   cover sheet are the normal contents of a forwarded corporate email, and
 *   downloading them to find out they are not workbooks would move megabytes
 *   for nothing. Candidates are filtered on metadata first.
 */

/** Server-side, and never NEXT_PUBLIC_. */
export const RESEND_API_KEY_ENV = "RESEND_API_KEY";

const RESEND_API_BASE = "https://api.resend.com";

/** Attachment metadata as the receiving API returns it. */
export interface ResendAttachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number | null;
  /** Signed and expiring. Fetched WITHOUT the API key. */
  downloadUrl: string | null;
  /** `inline` for a signature image or embedded logo. */
  contentDisposition: string | null;
}

export function resendApiKeyConfigured(): boolean {
  return (process.env[RESEND_API_KEY_ENV] ?? "").trim().length > 0;
}

/** The magic bytes every `.xlsx` starts with, being a ZIP container. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export function looksLikeXlsxBytes(bytes: Uint8Array): boolean {
  if (bytes.length < ZIP_MAGIC.length) return false;
  return ZIP_MAGIC.every((byte, index) => bytes[index] === byte);
}

/**
 * Whether an attachment is worth downloading as a candidate workbook.
 *
 * Metadata only, so this is cheap and runs before any byte is moved.
 */
/**
 * The attachments that are NEVER a report, whatever they are named.
 *
 * Shared by every family's rule, because "a signature image is not a report"
 * is not a per-family judgement — and because a footer logo arriving as
 * `logo.xls` should be refused once rather than once per family.
 */
export function isDefinitelyNotAReport(attachment: ResendAttachment): boolean {
  /*
   * An INLINE attachment is part of the message body — a signature image, an
   * embedded logo, a tracking pixel. A report is never inline, and excluding
   * the disposition is what keeps a corporate footer out of the candidates.
   */
  if ((attachment.contentDisposition ?? "").toLowerCase() === "inline") return true;

  const filename = (attachment.filename ?? "").trim().toLowerCase();
  const contentType = (attachment.contentType ?? "").trim().toLowerCase();

  if (contentType.startsWith("image/")) return true;
  if (contentType === "application/pdf" || filename.endsWith(".pdf")) return true;
  return false;
}

/** Legacy Excel's mime type. Mailers give it to anything named `.xls`. */
export const LEGACY_EXCEL_MIME = "application/vnd.ms-excel";

/**
 * A CANDIDATE FOR THE SALES TOTALS REPORT.
 *
 * Named `.xls` and NOT an `.xls` — proven from the real received file, which
 * begins `<html><title>Sales Totals</title>` and carries neither the ZIP magic
 * of an `.xlsx` nor the OLE2 magic of a genuine BIFF workbook. So the metadata
 * rule accepts what the mailer will actually label it — `.xls`, `.htm`,
 * `.html`, `application/vnd.ms-excel`, `text/html` — and the BYTES decide, in
 * `looksLikeHtmlReport`.
 *
 * DELIBERATELY NOT A RELAXATION OF `isWorkbookCandidate`. That rule still
 * refuses `.xls` outright, because a Comp Report is a real `.xlsx` and a file
 * claiming otherwise is not one. Two families, two rules, no shared middle
 * ground that admits more than either family wants.
 */
export function isSalesTotalsCandidate(attachment: ResendAttachment): boolean {
  if (isDefinitelyNotAReport(attachment)) return false;

  const filename = (attachment.filename ?? "").trim().toLowerCase();
  const contentType = (attachment.contentType ?? "").trim().toLowerCase();

  /*
   * An `.xlsx` is never this report: the real one is HTML, and accepting a
   * genuine workbook here would send it to a parser that cannot read it while
   * looking like the right family.
   */
  if (filename.endsWith(".xlsx") || contentType === XLSX_MIME) return false;

  return (
    filename.endsWith(".xls") ||
    filename.endsWith(".htm") ||
    filename.endsWith(".html") ||
    contentType === LEGACY_EXCEL_MIME ||
    contentType === "text/html"
  );
}

export function isWorkbookCandidate(attachment: ResendAttachment): boolean {
  if (isDefinitelyNotAReport(attachment)) return false;

  const filename = (attachment.filename ?? "").trim().toLowerCase();
  const contentType = (attachment.contentType ?? "").trim().toLowerCase();

  /*
   * A `.xls` IS STILL REFUSED HERE. The Comp Report is a genuine `.xlsx` and
   * the parsers read nothing else; a legacy or HTML file wearing that name is
   * a different report or a mistake. Excluded explicitly rather than left to
   * the ZIP check, so the reason is legible — and note this rule did not
   * loosen when Sales Totals arrived, which has its own rule above.
   */
  if (filename.endsWith(".xls")) return false;

  return contentType === XLSX_MIME || filename.endsWith(".xlsx");
}

/** Lists one received email's attachments. */
export async function listReceivedAttachments(
  emailId: string,
  options: { apiKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<ResendAttachment[]> {
  const apiKey = (options.apiKey ?? process.env[RESEND_API_KEY_ENV] ?? "").trim();
  if (apiKey.length === 0) {
    throw new ResendApiError(`${RESEND_API_KEY_ENV} is not configured.`);
  }

  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(
    `${RESEND_API_BASE}/emails/receiving/${encodeURIComponent(emailId)}/attachments`,
    { headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" } },
  );

  if (!response.ok) {
    /*
     * The status, never the body. An upstream error body can echo the request
     * — including the Authorization header on some gateways — and this message
     * ends up in a response.
     */
    throw new ResendApiError(
      `Resend returned ${response.status} when listing the email's attachments.`,
    );
  }

  const payload = (await response.json()) as {
    data?: {
      id?: string;
      filename?: string;
      content_type?: string;
      size?: number;
      download_url?: string;
      content_disposition?: string;
    }[];
  };

  return (payload.data ?? []).map((entry) => ({
    id: String(entry.id ?? ""),
    filename: String(entry.filename ?? ""),
    contentType: String(entry.content_type ?? ""),
    sizeBytes: typeof entry.size === "number" ? entry.size : null,
    downloadUrl: entry.download_url ? String(entry.download_url) : null,
    contentDisposition: entry.content_disposition ? String(entry.content_disposition) : null,
  }));
}

/**
 * Downloads one attachment's bytes from its signed URL.
 *
 * NO AUTHORIZATION HEADER. The URL carries its own signature and points at a
 * host that is not `api.resend.com`; sending the API key there would hand it
 * to a third party.
 */
export async function downloadAttachment(
  attachment: ResendAttachment,
  options: { maxBytes: number; fetchImpl?: typeof fetch },
): Promise<Uint8Array> {
  if (!attachment.downloadUrl) {
    throw new ResendApiError("The attachment has no download URL.");
  }

  /*
   * Refused on the DECLARED size before the body is read, when one is
   * declared. A cap enforced only after buffering is not a cap.
   */
  if (attachment.sizeBytes !== null && attachment.sizeBytes > options.maxBytes) {
    throw new ResendApiError(
      `The attachment is larger than the ${options.maxBytes}-byte limit.`,
    );
  }

  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(attachment.downloadUrl);
  if (!response.ok) {
    throw new ResendApiError(
      `The attachment download returned ${response.status}.`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  // And again on what actually arrived, in case no size was declared.
  if (bytes.byteLength > options.maxBytes) {
    throw new ResendApiError(
      `The attachment is larger than the ${options.maxBytes}-byte limit.`,
    );
  }
  return bytes;
}

/** An upstream failure, with a message that is safe to return. */
export class ResendApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResendApiError";
  }
}
