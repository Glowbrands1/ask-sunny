import { NextResponse } from "next/server";

import { UPLOAD_LIMITS } from "@/lib/config/models";
import {
  SUPABASE_URL_ENV,
  supabaseSecretKeyConfigured,
} from "@/lib/config/server-env";
import {
  APPROVED_SENDERS_ENV,
  approvedSendersConfigured,
  REQUIRED_SUBJECT_FRAGMENT,
} from "@/lib/reporting/inbound/delivery-gate";
import {
  intakeReceivedEmail,
  intakeReceivedSalesTotals,
} from "@/lib/reporting/inbound/email-intake";
import {
  RESEND_API_KEY_ENV,
  resendApiKeyConfigured,
  type ResendAttachment,
} from "@/lib/reporting/inbound/resend-client";
import {
  SIGNATURE_HEADERS,
  verifyWebhookSignature,
  WEBHOOK_SECRET_ENV,
  webhookSecretConfigured,
} from "@/lib/reporting/inbound/webhook-signature";
import { SalesTotalsStageError } from "@/lib/reporting/sales-totals/intake";
import { REPORT_PARSERS } from "@/lib/reporting";
import { familyReadiness, routeDelivery } from "@/lib/reporting/inbound/report-families";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * POST /api/reporting/inbound-email
 *
 * RESEND INBOUND EMAIL — the report arrives as a forwarded message.
 *
 *   Samuel emails Curt the Comp Report
 *     -> an Outlook rule forwards a copy to the Resend inbound address
 *     -> Resend emits `email.received`
 *     -> this route verifies the signature, gates the sender and subject,
 *        downloads the .xlsx, and hands it to the SAME intake orchestration
 *        `/api/reporting/intake` uses
 *     -> every applicable parser runs
 *     -> new periods and facts appear in the existing dashboard
 *
 * Replaces the Power Automate HTTP action, whose only problem was a Premium
 * licence. Nothing about the reporting pipeline changes: the parsers, the
 * idempotency layers, the supersession scope, the private Storage and the
 * dashboard are untouched, and this route adds a transport rather than a
 * second pipeline.
 *
 * NO IDENTITY PROVIDER IS INVOLVED, here or later. The delivery proves itself
 * with a webhook signature; the sender allowlist is a filter on top.
 *
 * THE ORDER OF CHECKS IS THE SECURITY MODEL:
 *
 *   1. THE SIGNATURE, over the RAW BODY, before the body is parsed and before
 *      any attachment is retrieved or Supabase is touched. `request.text()`
 *      first, `JSON.parse` second — parsing and re-serialising would change the
 *      bytes and break verification, which is why the raw string is read once
 *      and both the check and the parse work from it.
 *   2. THE EVENT TYPE. Only `email.received` is processed; every other Resend
 *      event is acknowledged and dropped.
 *   3. THE SENDER AND SUBJECT, before a byte is downloaded.
 *   4. THE ATTACHMENT, chosen on metadata and then confirmed from its bytes.
 *
 * WHY A REJECTED DELIVERY STILL ANSWERS 200. Resend retries anything that is
 * not 2xx. A wrong sender, an unrelated subject and a mail with no workbook are
 * all permanent conditions — retrying buys an endless loop and nothing else. So
 * they are acknowledged with an `ignored` outcome. Only an unverified signature
 * (401) and a configuration gap (503) are refusals, because those are the two
 * cases where a retry could legitimately succeed.
 *
 * NOTHING IS LOGGED. Not the payload, not a filename, not a byte. An inbound
 * email is somebody's mail and the workbook is salon financials.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The one event this route acts on. */
const HANDLED_EVENT = "email.received";

/**
 * Readiness, for wiring the webhook up without sending mail.
 *
 * Reports WHETHER each variable is configured and which parsers are registered.
 * Never a value, never the allowlist's contents, never a digest of a secret.
 */
export async function GET() {
  return NextResponse.json({
    endpoint: "/api/reporting/inbound-email",
    method: "POST",
    handledEvent: HANDLED_EVENT,
    signatureHeaders: Object.values(SIGNATURE_HEADERS),
    requiredSubjectFragment: REQUIRED_SUBJECT_FRAGMENT,
    maxAttachmentBytes: UPLOAD_LIMITS.maxBytes,
    configured: {
      [WEBHOOK_SECRET_ENV]: webhookSecretConfigured(),
      [RESEND_API_KEY_ENV]: resendApiKeyConfigured(),
      // WHETHER a list exists, never how many entries or which.
      [APPROVED_SENDERS_ENV]: approvedSendersConfigured(),
      supabaseUrl: Boolean(process.env[SUPABASE_URL_ENV]),
      supabaseSecret: supabaseSecretKeyConfigured(),
    },
    parsers: REPORT_PARSERS.map((parser) => ({
      parserKey: parser.key,
      parserVersion: parser.version,
      family: parser.family,
    })),
    /*
     * One endpoint now serves several report families. Each declares whether
     * its LIVE EMAIL ingestion is configured and, when it is not, which
     * variables are missing — names only, never values. Sales Totals is
     * expected to read `activated: false` until its real sender address and
     * subject line are known.
     */
    families: familyReadiness(),
  });
}

/** Acknowledged and dropped. 200, so Resend does not retry a settled outcome. */
function acknowledge(code: string, reason: string, extra: object = {}) {
  return NextResponse.json({ status: "ignored", code, reason, ...extra }, { status: 200 });
}

export async function POST(request: Request) {
  /*
   * THE RAW BODY, READ ONCE.
   *
   * The signature covers these exact bytes, so they are captured before
   * anything looks at them and the later `JSON.parse` works from the same
   * string. Reading the body twice is not possible, and parsing first is the
   * mistake this ordering exists to prevent.
   */
  const rawBody = await request.text();

  if (!webhookSecretConfigured()) {
    /*
     * 503 and not 401: this is our gap, not the caller's, and it is the one
     * rejection where a retry after somebody sets the variable will succeed.
     * The message names the variable and no value.
     */
    return NextResponse.json(
      {
        status: "not_configured",
        code: "webhook_secret_missing",
        reason: `Inbound email intake is closed: ${WEBHOOK_SECRET_ENV} is not configured in this runtime.`,
      },
      { status: 503 },
    );
  }

  const verdict = await verifyWebhookSignature({ headers: request.headers, rawBody });
  if (!verdict.valid) {
    /*
     * ONE ANSWER FOR EVERY SIGNATURE FAILURE. A missing header, a stale
     * timestamp and a forged signature are indistinguishable to the caller —
     * `verdict.reason` exists for an operator reading the code and is
     * deliberately not returned, because "your timestamp is stale" tells a
     * prober which half to fix.
     */
    return NextResponse.json(
      { status: "unauthorized", code: "invalid_signature", reason: "Invalid signature." },
      { status: 401 },
    );
  }

  // Only now is the body parsed.
  let event: {
    type?: unknown;
    data?: {
      email_id?: unknown;
      from?: unknown;
      subject?: unknown;
      message_id?: unknown;
      created_at?: unknown;
      attachments?: unknown;
    };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    // Signed but not JSON. Acknowledged: a retry would deliver the same bytes.
    return acknowledge("unparseable_payload", "The webhook payload was not valid JSON.");
  }

  if (event.type !== HANDLED_EVENT) {
    return acknowledge(
      "event_not_handled",
      `Only ${HANDLED_EVENT} is processed by this endpoint.`,
      { receivedEvent: typeof event.type === "string" ? event.type : null },
    );
  }

  const data = event.data ?? {};
  const emailId = typeof data.email_id === "string" ? data.email_id : "";
  if (emailId.length === 0) {
    return acknowledge("missing_email_id", "The payload carries no email id.");
  }

  /*
   * WHICH REPORT FAMILY IS THIS?
   *
   * One signed endpoint serves several reports. The signature above proved the
   * delivery is genuine; this decides which family's rules apply, on sender and
   * subject alone and therefore before any attachment is listed or fetched.
   *
   * A DELIVERY THAT ROUTES NOWHERE STILL FALLS THROUGH TO THE COMP REPORT PATH,
   * which re-applies its own gate and acknowledges the mail as `ignored`. That
   * is deliberate: the Comp Report's refusal codes and their ordering are what
   * its tests pin, and routing must not become a second place that decides
   * whether a Comp Report delivery is admitted.
   */
  const routing = routeDelivery({
    from: typeof data.from === "string" ? data.from : null,
    subject: typeof data.subject === "string" ? data.subject : null,
  });

  if (!resendApiKeyConfigured()) {
    return NextResponse.json(
      {
        status: "not_configured",
        code: "api_key_missing",
        reason: `The attachment cannot be retrieved: ${RESEND_API_KEY_ENV} is not configured in this runtime.`,
      },
      { status: 503 },
    );
  }
  if (!process.env[SUPABASE_URL_ENV] || !supabaseSecretKeyConfigured()) {
    return NextResponse.json(
      {
        status: "not_configured",
        code: "supabase_missing",
        reason: "Supabase is not configured in this runtime, so no report can be ingested.",
      },
      { status: 503 },
    );
  }

  /** Attachment metadata from the webhook. Used only to skip a pointless API call. */
  const attachments: ResendAttachment[] = Array.isArray(data.attachments)
    ? (data.attachments as Record<string, unknown>[]).map((entry) => ({
        id: String(entry.id ?? ""),
        filename: String(entry.filename ?? ""),
        contentType: String(entry.content_type ?? ""),
        sizeBytes: typeof entry.size === "number" ? entry.size : null,
        // The webhook never carries one; the receiving API supplies it.
        downloadUrl: null,
        contentDisposition:
          typeof entry.content_disposition === "string" ? entry.content_disposition : null,
      }))
    : [];

  const received = {
    emailId,
    from: typeof data.from === "string" ? data.from : null,
    subject: typeof data.subject === "string" ? data.subject : null,
    messageId: typeof data.message_id === "string" ? data.message_id : null,
    receivedAt: typeof data.created_at === "string" ? data.created_at : null,
    attachments,
  };

  try {
    /*
     * SALES TOTALS HAS ITS OWN PATH, because the report is genuinely different:
     * HTML wearing an `.xls` name, a report DATE rather than a period, two
     * windows per delivery, and its own transaction. It shares everything that
     * should be shared — this signature check, this endpoint, the attachment
     * search, the size cap, `begin_report_ingestion`'s replay protection — and
     * diverges exactly where the data does.
     */
    if (routing.routed && routing.family.key === "sales_totals") {
      const salesTotals = await intakeReceivedSalesTotals(received);
      return NextResponse.json({ family: "sales_totals", ...salesTotals }, { status: 200 });
    }

    const outcome = await intakeReceivedEmail(received, {
      knownPeriodIds: loadKnownPeriodIds,
    });

    /*
     * 200 for everything that reached a settled answer, including `ignored`
     * and `rejected`. A rejected workbook is a permanent fact about that
     * delivery — template drift will not fix itself on a retry — and Resend
     * retrying it would deliver the same file to the same refusal. The BODY
     * carries the outcome; the status carries only "we have handled this".
     */
    return NextResponse.json({ family: "comp_report", ...outcome }, { status: 200 });
  } catch (error) {
    /*
     * 500, deliberately, and this is the one place a retry is wanted: an
     * unexpected failure here is transient by definition — a database blip, a
     * storage timeout — and Resend's retry is the recovery. The message stays
     * generic because an upstream error string can carry constraint names and
     * occasionally a value from the offending row.
     *
     * WHAT IS NEW IS THE STAGE. The first real Sales Totals delivery failed
     * here and this response said only `intake_failed`, which took a database
     * investigation to localise — the upload was being refused by the bucket's
     * mime allowlist. `stage` is a fixed identifier from a closed set and
     * carries nothing else: no message, no path, no value, no constraint name.
     */
    const stage = error instanceof SalesTotalsStageError ? error.stage : null;
    return NextResponse.json(
      {
        status: "error",
        code: "intake_failed",
        ...(stage ? { stage } : {}),
        reason:
          "The delivery could not be processed. No partial report has been left behind; " +
          "any parser that succeeded is recorded and the delivery can be retried.",
      },
      { status: 500 },
    );
  }
}

/**
 * Period ids that exist right now, so `created` on each period is measured.
 *
 * Read before any write, inside the intake service. Reading it afterwards would
 * report every period as pre-existing — the opposite of the question, which is
 * whether this delivery brought a new reporting month.
 */
async function loadKnownPeriodIds(): Promise<Set<string>> {
  const { data, error } = await getSupabaseAdmin().from("report_periods").select("id");
  // Not fatal: an unknown answer must not fail an otherwise good delivery, so
  // periods are reported as pre-existing, which is the conservative claim.
  if (error) return new Set<string>();
  return new Set(((data ?? []) as { id: string }[]).map((row) => row.id));
}
