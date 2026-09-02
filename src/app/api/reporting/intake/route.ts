import { NextResponse } from "next/server";

import { UPLOAD_LIMITS } from "@/lib/config/models";
import {
  SUPABASE_URL_ENV,
  supabaseSecretKeyConfigured,
} from "@/lib/config/server-env";
import {
  authorizeIngestRequest,
  credentialConfigurationProblem,
  INGEST_SECRET_ENV,
  ingestCredentialConfigured,
} from "@/lib/reporting/ingest-credential";
import { intakeReportWorkbook, ReportIntakeRejected } from "@/lib/reporting/intake";
import { XLSX_MIME } from "@/lib/reporting/ingest";
import { REPORT_PARSERS } from "@/lib/reporting";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * POST /api/reporting/intake   (multipart/form-data)
 *
 * AUTOMATED REPORT INTAKE. One delivery, every compatible parser, once.
 *
 * The sender — Power Automate reading the Comp Report mailbox is the expected
 * first client — forwards the attachment and what it knows about the message.
 * It does not name a parser, does not know which sheets the workbook contains,
 * and does not submit the file three times. Adding a fourth sheet later means
 * registering a parser here; the flow is not touched.
 *
 * WHY THIS IS A SEPARATE ROUTE from `/api/admin/reporting/ingest`. That route
 * exists for a person doing a controlled, reviewed ingestion of ONE named sheet,
 * and its `parserKey` is a decision somebody makes. This route exists for a
 * machine that has no view to choose. Same credential, same pipeline, same
 * idempotency; different question, so a different endpoint rather than a mode
 * flag on the old one.
 *
 * WHAT PROTECTS IT:
 *
 *   1. THE MACHINE CREDENTIAL, checked before the body is read.
 *      `REPORTING_INGEST_SECRET`, verified in constant time against a rotatable
 *      list, rate limited on failures, never exposed to a browser. No
 *      credential configured means nobody is let in, in every environment.
 *   2. NO DIGEST ALLOWLIST, deliberately, and this is the difference that makes
 *      recurring intake possible: next month's workbook cannot be approved
 *      today. The credential is the gate, which is what it was built to be.
 *   3. STRUCTURAL VALIDATION BEFORE ANY WRITE. A workbook no parser recognises
 *      is refused with 422 and nothing is uploaded or written.
 *   4. SIZE CAP, and a content-type check that warns rather than refuses —
 *      mail transports mislabel attachments, and the workbook reader is the
 *      real authority on whether these bytes are a workbook.
 *
 * THE RESPONSE CARRIES NO FINANCIAL VALUES. Counts, identifiers, periods, sheet
 * names, warning codes. No figure, no salon number, no salon name, no manager
 * name. It also omits the storage bucket and object key: an automated caller has
 * no use for them and printing them into a response is a step towards fetching
 * a private object.
 *
 * NOTHING HERE DEPENDS ON AN EXTERNAL IDENTITY PROVIDER, now or later.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Multipart field names the sender must use. Documented, so they are stable. */
const FIELDS = {
  file: "file",
  originalFilename: "originalFilename",
  messageId: "messageId",
  senderEmail: "senderEmail",
  receivedAt: "receivedAt",
  archiveUrl: "archiveUrl",
} as const;

function refuse(code: string, message: string, status: number, extra: object = {}) {
  return NextResponse.json({ fileAccepted: false, code, error: message, ...extra }, { status });
}

/**
 * Readiness, for wiring the flow up without sending a file.
 *
 * Reports WHETHER things are configured and WHICH parsers are registered. Never
 * a credential, never a digest, never anything from a report.
 */
export async function GET() {
  return NextResponse.json({
    endpoint: "/api/reporting/intake",
    method: "POST",
    contentType: "multipart/form-data",
    authRequired: true,
    authHeader: "Authorization: Bearer <REPORTING_INGEST_SECRET>",
    alternateAuthHeader: "X-Reporting-Ingest-Secret: <REPORTING_INGEST_SECRET>",
    ingestCredentialEnv: INGEST_SECRET_ENV,
    ingestCredentialConfigured: ingestCredentialConfigured(),
    ingestCredentialProblem: credentialConfigurationProblem(),
    supabaseUrlConfigured: Boolean(process.env[SUPABASE_URL_ENV]),
    supabaseSecretConfigured: supabaseSecretKeyConfigured(),
    maxBytes: UPLOAD_LIMITS.maxBytes,
    fields: FIELDS,
    /*
     * Which parsers a delivery will be run through. Structure only: the sender
     * does not choose from this list and does not need to — it is here so an
     * operator can see that all three sheets are covered.
     */
    parsers: REPORT_PARSERS.map((parser) => ({
      parserKey: parser.key,
      parserVersion: parser.version,
      family: parser.family,
    })),
  });
}

export async function POST(request: Request) {
  /*
   * THE CREDENTIAL, BEFORE THE BODY IS READ.
   *
   * An unauthorized caller must not be able to make this route parse a
   * multipart body, hash bytes or touch Supabase.
   */
  const auth = await authorizeIngestRequest(request.headers);

  if (auth.status === "unconfigured") {
    return refuse(
      "intake_closed",
      `Report intake is closed: ${INGEST_SECRET_ENV} is not configured in this runtime.`,
      503,
    );
  }
  if (auth.status === "rate_limited") {
    return NextResponse.json(
      {
        fileAccepted: false,
        code: "rate_limited",
        error: `Too many failed attempts. Try again in ${auth.retryAfterSeconds} seconds.`,
      },
      { status: 429, headers: { "retry-after": String(auth.retryAfterSeconds) } },
    );
  }
  if (auth.status === "unauthorized") {
    // One answer for every failure: missing, wrong and revoked are identical.
    return NextResponse.json(
      { fileAccepted: false, code: "unauthorized", error: "Not authorized." },
      { status: 401, headers: { "www-authenticate": "Bearer" } },
    );
  }

  if (!process.env[SUPABASE_URL_ENV] || !supabaseSecretKeyConfigured()) {
    return refuse(
      "not_configured",
      "Supabase is not configured in this runtime, so no report can be ingested.",
      503,
    );
  }

  try {
    const form = await request.formData().catch(() => null);
    if (!form) return refuse("bad_request", "The upload could not be read.", 400);

    const file = form.get(FIELDS.file);
    if (!(file instanceof File)) {
      return refuse("no_file", `No file was included in the \`${FIELDS.file}\` field.`, 400);
    }
    if (file.size === 0) return refuse("empty_file", "The uploaded file is empty.", 400);
    if (file.size > UPLOAD_LIMITS.maxBytes) {
      return refuse(
        "too_large",
        `The workbook is larger than the ${UPLOAD_LIMITS.maxBytes}-byte upload limit.`,
        413,
      );
    }

    const text = (name: string): string | null => {
      const value = form.get(name);
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed;
    };

    /*
     * THE ATTACHMENT NAME AS THE SENDER WROTE IT, preferred over the multipart
     * part's filename. For a scripted or flow-driven upload the part name is
     * whatever the transport called it — `blob`, or the flow's variable name —
     * and `report_files.original_filename` is meant to hold what arrived in the
     * mailbox.
     */
    const originalFilename =
      text(FIELDS.originalFilename) ?? (file.name || "workbook.xlsx");

    /*
     * The arrival time, validated as a real instant. A caller that sends
     * nonsense gets a refusal rather than having it silently become `now()` —
     * a wrong arrival time is worse than a missing one, because it looks
     * authoritative.
     */
    const receivedAtRaw = text(FIELDS.receivedAt);
    let receivedAt: string | null = null;
    if (receivedAtRaw !== null) {
      const parsed = new Date(receivedAtRaw);
      if (Number.isNaN(parsed.getTime())) {
        return refuse(
          "bad_received_at",
          `\`${FIELDS.receivedAt}\` is not a valid timestamp. Send an ISO 8601 instant, for example 2026-09-01T08:59:00Z.`,
          400,
        );
      }
      receivedAt = parsed.toISOString();
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    const result = await intakeReportWorkbook(
      {
        bytes,
        originalFilename,
        mimeType: file.type || XLSX_MIME,
        externalMessageId: text(FIELDS.messageId),
        senderEmail: text(FIELDS.senderEmail),
        receivedAt,
        externalArchiveUrl: text(FIELDS.archiveUrl),
      },
      { knownPeriodIds: loadKnownPeriodIds },
    );

    /*
     * WHICH CREDENTIAL DELIVERED IT. An operator label, never the secret, so
     * "which pipeline filed this" and "which credential do I revoke" have an
     * answer without anything sensitive being written down.
     */
    const body = { ...result, credentialId: auth.credentialId };

    /*
     * 200 when every attempted parser landed, 207 when some did not.
     *
     * A distinct status because a flow's "was this successful" branch has to be
     * able to tell those apart without parsing the body. A partial load is not
     * a success, and it is not a failure either — some of the report is in.
     */
    const status = result.parsersFailed.length === 0 ? 200 : 207;
    return NextResponse.json(body, { status });
  } catch (error) {
    if (error instanceof ReportIntakeRejected) {
      /*
       * TEMPLATE DRIFT, OR AN UNRECOGNISED FILE. Every parser's reason is
       * returned, because "the workbook changed" is only actionable if it says
       * which sheet and which marker. Nothing was uploaded and nothing written.
       */
      return NextResponse.json(
        {
          fileAccepted: false,
          code: error.code,
          error: error.message,
          detections: error.detections.map((entry) => ({
            parserKey: entry.parserKey,
            parserVersion: entry.parserVersion,
            sheetName: entry.sheetName,
            supported: entry.supported,
            kind: entry.kind,
            reason: entry.reason,
            markersMissing: entry.markersMissing,
          })),
        },
        { status: error.status },
      );
    }

    /*
     * Anything else is reduced to a generic 500 on purpose. A database or
     * storage error string can carry column names, constraint names and
     * occasionally a value from the offending row, and this response leaves the
     * building. Per-parser failures never reach here — they are reported inside
     * the body with their own safe reasons.
     */
    return refuse(
      "intake_failed",
      "The intake could not be completed. No partial report has been left behind; " +
        "any parser that succeeded is recorded and any that failed can be retried.",
      500,
    );
  }
}

/**
 * Period ids that exist right now, so `created` on each period is a measured
 * fact rather than an assumption.
 *
 * Read BEFORE any write, inside the intake service. Reading it afterwards would
 * report every period as pre-existing, which is the exact opposite of the
 * question — "did this delivery bring a new reporting period?" is what tells an
 * operator whether the dashboard just gained a month.
 */
async function loadKnownPeriodIds(): Promise<Set<string>> {
  const { data, error } = await getSupabaseAdmin().from("report_periods").select("id");
  if (error) {
    // Not fatal. An unknown answer must not fail an otherwise good delivery, so
    // periods are reported as pre-existing — the conservative claim.
    return new Set<string>();
  }
  return new Set(((data ?? []) as { id: string }[]).map((row) => row.id));
}
