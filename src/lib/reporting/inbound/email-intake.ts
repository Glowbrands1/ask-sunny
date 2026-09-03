import "server-only";

import { UPLOAD_LIMITS } from "@/lib/config/models";
import { XLSX_MIME } from "../ingest";
import {
  intakeReportWorkbook,
  ReportIntakeRejected,
  type IntakeDependencies,
  type ReportIntakeResult,
} from "../intake";
import { admitDelivery, type IgnoredReason } from "./delivery-gate";
import {
  downloadAttachment,
  isWorkbookCandidate,
  listReceivedAttachments,
  looksLikeXlsxBytes,
  ResendApiError,
  type ResendAttachment,
} from "./resend-client";

/**
 * FROM A RECEIVED EMAIL TO THE EXISTING INTAKE ENGINE.
 *
 * This module is the adapter and nothing else. It decides whether a delivery
 * may be ingested, finds the workbook in it, downloads the bytes, and hands
 * them to `intakeReportWorkbook` — the SAME orchestration `/api/reporting/intake`
 * calls. No parser logic is duplicated here, no idempotency is reimplemented,
 * and no supersession decision is made: those live behind that one function,
 * and the whole point of routing through it is that email and HTTP delivery
 * cannot drift apart in how they treat a report.
 *
 * WHAT REPLACING POWER AUTOMATE WITH EMAIL CHANGES, and does not:
 *
 *   The bytes still arrive once and every applicable parser still runs. A
 *   forwarded email is one delivery, exactly as one HTTP POST was.
 *
 *   Idempotency is unchanged and comes from the CONTENT. Resend retries a
 *   webhook it did not get a 2xx for, and a forwarding rule can fire twice;
 *   both re-deliver identical bytes, which the digest recognises and every
 *   parser reports as `already_ingested`, writing nothing.
 *
 *   The gates are new, because the transport is now open to anyone who can
 *   send mail. The webhook signature proves the delivery came from Resend; the
 *   sender allowlist and the subject filter decide whether this particular mail
 *   is the report. See `delivery-gate.ts` for why neither is authentication.
 *
 * NOTHING HERE LOGS. Not the payload, not a filename, not a byte. An inbound
 * email is somebody's mail and the workbook is salon financials.
 */

export type EmailIntakeStatus =
  /** The workbook was found and handed to the intake engine. */
  | "ingested"
  /** Deliberately not ingested. Acknowledge, do not retry. */
  | "ignored"
  /** Recognised as the report, but the workbook could not be used. */
  | "rejected";

/** What one `email.received` delivery resulted in. Structural only. */
export interface EmailIntakeOutcome {
  status: EmailIntakeStatus;
  /**
   * Why, in terms safe to return to the caller.
   *
   * Never names the allowlist, the configured senders, or which of the two
   * gates closed in a way a prober could use.
   */
  reason: string;
  code:
    | "ingested"
    | IgnoredReason
    | "no_workbook_attachment"
    | "attachment_unavailable"
    | "unreadable_workbook"
    | "template_drift"
    | "unsupported_workbook";
  /** Resend's id for the received email. Correlates back to their dashboard. */
  inboundEmailId: string;
  /** The attachment chosen, when one was. */
  attachment: { filename: string; contentType: string; sizeBytes: number } | null;
  /** The intake engine's own result, when it ran. Carries no financial values. */
  intake: ReportIntakeResult | null;
  /** Present when the workbook was refused before any parser ran. */
  rejection: {
    code: string;
    message: string;
    detections: { parserKey: string; sheetName: string | null; kind: string }[];
  } | null;
}

/** The fields this adapter needs out of an `email.received` payload. */
export interface ReceivedEmail {
  emailId: string;
  from: string | null;
  subject: string | null;
  /** The upstream `Message-ID`, when the forwarding transport preserved one. */
  messageId: string | null;
  /** When Resend received it. ISO 8601. */
  receivedAt: string | null;
  /** Attachment metadata from the webhook, used only as a fast path. */
  attachments: ResendAttachment[];
}

export interface EmailIntakeDependencies extends IntakeDependencies {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** Injected so a test can drive attachment listing without a network. */
  listAttachments?: typeof listReceivedAttachments;
  downloadBytes?: typeof downloadAttachment;
}

function ignored(code: IgnoredReason | EmailIntakeOutcome["code"], reason: string, emailId: string): EmailIntakeOutcome {
  return {
    status: "ignored",
    code: code as EmailIntakeOutcome["code"],
    reason,
    inboundEmailId: emailId,
    attachment: null,
    intake: null,
    rejection: null,
  };
}

/**
 * Handles one verified `email.received` delivery.
 *
 * THE SIGNATURE IS ALREADY VERIFIED BY THE TIME THIS RUNS. That ordering is
 * the route's job and is not re-checked here; this function's contract starts
 * at "a delivery we know came from Resend".
 */
export async function intakeReceivedEmail(
  email: ReceivedEmail,
  dependencies: EmailIntakeDependencies = {},
): Promise<EmailIntakeOutcome> {
  /*
   * 1. THE GATES, BEFORE ANY ATTACHMENT IS TOUCHED.
   *
   * A wrong sender or an unrelated subject must not cause a single byte to be
   * downloaded, and must not cost an API call. This is also why the gate runs
   * on the webhook payload rather than after listing attachments.
   */
  const gate = admitDelivery({ from: email.from, subject: email.subject });
  if (!gate.admit) {
    return ignored(gate.code, gate.operatorReason, email.emailId);
  }

  /*
   * 2. FIND THE WORKBOOK.
   *
   * The webhook's own attachment list has no download URLs, so the receiving
   * API is called for them — but only when the metadata already shows a
   * plausible candidate. A mail with nothing but a signature image never
   * reaches the API at all.
   */
  const fromWebhook = email.attachments.filter(isWorkbookCandidate);
  if (email.attachments.length > 0 && fromWebhook.length === 0) {
    return ignored(
      "no_workbook_attachment",
      "The email carries no .xlsx attachment, so there is no report to ingest.",
      email.emailId,
    );
  }

  const list = dependencies.listAttachments ?? listReceivedAttachments;
  let candidates: ResendAttachment[];
  try {
    candidates = (
      await list(email.emailId, {
        apiKey: dependencies.apiKey,
        fetchImpl: dependencies.fetchImpl,
      })
    ).filter(isWorkbookCandidate);
  } catch (error) {
    return {
      status: "rejected",
      code: "attachment_unavailable",
      reason:
        error instanceof ResendApiError
          ? error.message
          : "The email's attachments could not be retrieved.",
      inboundEmailId: email.emailId,
      attachment: null,
      intake: null,
      rejection: null,
    };
  }

  if (candidates.length === 0) {
    return ignored(
      "no_workbook_attachment",
      "The email carries no .xlsx attachment, so there is no report to ingest.",
      email.emailId,
    );
  }

  /*
   * 3. DOWNLOAD, AND CHECK THE BYTES.
   *
   * Candidates are tried in order, largest first: where a forwarded mail
   * carries both the report and a smaller spreadsheet — a cover sheet, an
   * older copy — the report is the substantial one. A candidate whose bytes
   * are not a ZIP container is not an `.xlsx` whatever it was labelled, and
   * the next candidate is tried rather than the delivery being failed.
   */
  const download = dependencies.downloadBytes ?? downloadAttachment;
  const ordered = [...candidates].sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));

  let chosen: { attachment: ResendAttachment; bytes: Uint8Array } | null = null;
  let lastProblem: string | null = null;

  for (const attachment of ordered) {
    try {
      const bytes = await download(attachment, {
        maxBytes: UPLOAD_LIMITS.maxBytes,
        fetchImpl: dependencies.fetchImpl,
      });
      if (!looksLikeXlsxBytes(bytes)) {
        lastProblem =
          "An attachment named as a workbook did not contain one. Nothing was ingested from it.";
        continue;
      }
      chosen = { attachment, bytes };
      break;
    } catch (error) {
      lastProblem =
        error instanceof ResendApiError
          ? error.message
          : "An attachment could not be downloaded.";
    }
  }

  if (!chosen) {
    return {
      status: "rejected",
      code: lastProblem?.includes("did not contain") ? "unreadable_workbook" : "attachment_unavailable",
      reason: lastProblem ?? "No usable workbook attachment was found.",
      inboundEmailId: email.emailId,
      attachment: null,
      intake: null,
      rejection: null,
    };
  }

  /*
   * 4. HAND IT TO THE EXISTING ENGINE.
   *
   * Every guarantee from here on — SHA-256 and parser-level idempotency,
   * period creation and reuse, supersession scope, template-drift rejection,
   * private Storage, one upload per delivery — is `intakeReportWorkbook`'s,
   * unchanged and not re-implemented.
   *
   * LINEAGE. `externalMessageId` prefers the UPSTREAM `Message-ID` when the
   * forwarding transport preserved one, because that identifies the original
   * mail Samuel sent rather than the forwarded copy; it falls back to Resend's
   * id, prefixed so the two can never be confused when read back.
   */
  try {
    const intake = await intakeReportWorkbook(
      {
        bytes: chosen.bytes,
        // Exactly as the attachment was named. Not the transport's name.
        originalFilename: chosen.attachment.filename || "workbook.xlsx",
        mimeType: chosen.attachment.contentType || XLSX_MIME,
        externalMessageId: email.messageId ?? `resend-email:${email.emailId}`,
        senderEmail: email.from,
        receivedAt: email.receivedAt,
        inboundEmailId: email.emailId,
        externalArchiveUrl: null,
      },
      dependencies,
    );

    return {
      status: "ingested",
      code: "ingested",
      reason:
        intake.parsersFailed.length === 0
          ? "The workbook was ingested."
          : "The workbook was ingested, and at least one parser failed. See the per-parser attempts.",
      inboundEmailId: email.emailId,
      attachment: {
        filename: chosen.attachment.filename,
        contentType: chosen.attachment.contentType,
        sizeBytes: chosen.bytes.byteLength,
      },
      intake,
      rejection: null,
    };
  } catch (error) {
    if (error instanceof ReportIntakeRejected) {
      /*
       * FAIL CLOSED. Template drift, an unrecognised workbook, or a file that
       * is not readable as a spreadsheet: nothing was uploaded and nothing was
       * written, so existing dashboard data is exactly as it was. Every
       * parser's reason is returned, because "the workbook changed" is only
       * actionable if it says which sheet and which marker.
       */
      return {
        status: "rejected",
        code: error.code,
        reason: error.message,
        inboundEmailId: email.emailId,
        attachment: {
          filename: chosen.attachment.filename,
          contentType: chosen.attachment.contentType,
          sizeBytes: chosen.bytes.byteLength,
        },
        intake: null,
        rejection: {
          code: error.code,
          message: error.message,
          detections: error.detections.map((entry) => ({
            parserKey: entry.parserKey,
            sheetName: entry.sheetName,
            kind: entry.kind,
          })),
        },
      };
    }
    throw error;
  }
}
