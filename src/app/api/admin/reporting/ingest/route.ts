import { NextResponse } from "next/server";

import { assertWithinRateLimit, errorResponse } from "@/lib/api/respond";
import { UPLOAD_LIMITS } from "@/lib/config/models";
import {
  SUPABASE_URL_ENV,
  supabaseSecretKeyConfigured,
} from "@/lib/config/server-env";
import {
  allowlistEnforced,
  APPROVED_SOURCES,
  DEFAULT_SOURCE_CODE,
  findApprovedSource,
} from "@/lib/reporting/approved-sources";
import {
  authorizeIngestRequest,
  credentialConfigurationProblem,
  INGEST_SECRET_ENV,
  ingestCredentialConfigured,
} from "@/lib/reporting/ingest-credential";
import { ingestReportWorkbook, sha256Hex, XLSX_MIME } from "@/lib/reporting/ingest";
import { COMP_SALES_PARSER_KEY, parserByKey, REPORT_PARSERS } from "@/lib/reporting";

/**
 * POST /api/admin/reporting/ingest   (multipart/form-data, field `file`)
 *
 * THE CONTROLLED REPORT-INGESTION PATH.
 *
 *   bytes -> SHA-256 -> approved-digest check -> parser detection -> parse
 *         -> validation -> private Storage -> one transactional normalized write
 *
 * WHAT PROTECTS IT:
 *
 *   1. A MACHINE CREDENTIAL, and this is the front door.
 *      `REPORTING_INGEST_SECRET` is required on every call in every
 *      environment, verified in constant time against a rotatable list of
 *      credentials, rate limited on failures, and never exposed to a browser.
 *      See `lib/reporting/ingest-credential.ts` — it is production-capable on
 *      its own and depends on no external identity provider.
 *   2. AN APPROVED-DIGEST ALLOWLIST, as defence in depth, while it is
 *      populated. An authorized caller may then file only artifacts whose
 *      SHA-256 has been reviewed and committed.
 *   3. SERVER-SIDE CREDENTIALS ONLY. The Supabase secret key is read from the
 *      server environment by `getSupabaseAdmin()` and never crosses the
 *      boundary: this route returns counts and identifiers, never
 *      configuration.
 *   4. RATE LIMITED, like every other write route.
 *
 * `authorizeRequest` is deliberately NOT called, and this is not a gap. That
 * function answers "which PERSON is this, and may they do this?" — a question
 * with no answer for a scheduled pipeline, which is not a person and holds no
 * profile. A machine credential is the right primitive for machine-to-machine
 * delivery whatever employee login turns out to be, so this route does not wait
 * on that decision and does not change when it is made.
 *
 * NO EXTERNAL IDENTITY PROVIDER IS REQUIRED, HERE OR LATER. In particular
 * nothing about this path assumes Microsoft Entra client credentials, and Entra
 * is not assumed to ever be available. It would be an optional addition: one
 * more way to authenticate a caller, with this credential still working
 * alongside it.
 *
 * ENABLED IN PRODUCTION ONLY WITH A CREDENTIAL CONFIGURED. The route used to
 * refuse outright when `VERCEL_ENV` was "production", because it had no way to
 * tell an authorized caller from anyone else. It can now, so the refusal is
 * conditional on the credential rather than on the environment: no credential,
 * no ingestion, in every environment alike.
 *
 * Demo mode is not consulted. `NEXT_PUBLIC_DEMO_MODE` governs whether the CHAT
 * and knowledge experience uses seeded content; it says nothing about whether a
 * reviewed workbook may be filed into the reporting tables, and this route
 * carries its own, stricter gate.
 *
 * THE RESPONSE CARRIES NO REPORT CONTENT: counts, ids, the period and the
 * storage path. No figure, no salon name, no manager name. Nothing here logs
 * workbook contents either.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function disabled(reason: string, status: number) {
  return NextResponse.json({ error: reason, code: "ingest_unavailable" }, { status });
}

export async function GET() {
  // Readiness only. Reports WHETHER things are configured, never any value.
  const credentialProblem = credentialConfigurationProblem();
  return NextResponse.json({
    // Enabled where a credential exists, whatever the environment.
    enabled: ingestCredentialConfigured(),
    vercelEnv: process.env.VERCEL_ENV ?? "local",
    supabaseUrlConfigured: Boolean(process.env[SUPABASE_URL_ENV]),
    supabaseSecretConfigured: supabaseSecretKeyConfigured(),
    /*
     * WHETHER a credential is configured, and what is wrong if it is not.
     * Never the value, never a digest of it, never how many characters it has.
     * `authRequired` is always true: there is no unauthenticated path.
     */
    authRequired: true,
    ingestCredentialEnv: INGEST_SECRET_ENV,
    ingestCredentialConfigured: ingestCredentialConfigured(),
    ingestCredentialProblem: credentialProblem,
    allowlistEnforced: allowlistEnforced(),
    approvedSourceCount: APPROVED_SOURCES.length,
    // Which sheet each parser reads, so a caller can name one. Structure only:
    // no digest, no configuration, nothing from any report.
    parsers: REPORT_PARSERS.map((parser) => ({
      parserKey: parser.key,
      parserVersion: parser.version,
      family: parser.family,
    })),
    defaultParserKey: COMP_SALES_PARSER_KEY,
  });
}

export async function POST(request: Request) {
  try {
    /*
     * THE CREDENTIAL, CHECKED BEFORE ANYTHING ELSE IS READ.
     *
     * Before the body is parsed, before a digest is computed, before Supabase
     * is touched. An unauthorized caller must not be able to make this route do
     * work, and must not learn anything from how long it took.
     */
    const auth = await authorizeIngestRequest(request.headers);

    if (auth.status === "unconfigured") {
      // A deployment with no credential lets NOBODY in. The caller is told the
      // route is closed; the reason names the variable and no value, and is
      // safe because it is a configuration fact rather than a secret.
      return disabled(
        `Report ingestion is closed: ${INGEST_SECRET_ENV} is not configured in this runtime.`,
        503,
      );
    }

    if (auth.status === "rate_limited") {
      return NextResponse.json(
        {
          error: `Too many failed attempts. Try again in ${auth.retryAfterSeconds} seconds.`,
          code: "ingest_unavailable",
        },
        { status: 429, headers: { "retry-after": String(auth.retryAfterSeconds) } },
      );
    }

    if (auth.status === "unauthorized") {
      /*
       * ONE ANSWER FOR EVERY FAILURE. A missing header, a wrong secret and a
       * revoked credential are indistinguishable, and nothing hints at how
       * close a value was or how many credentials exist.
       */
      return NextResponse.json(
        { error: "Not authorized.", code: "ingest_unauthorized" },
        { status: 401, headers: { "www-authenticate": "Bearer" } },
      );
    }

    if (!process.env[SUPABASE_URL_ENV] || !supabaseSecretKeyConfigured()) {
      return disabled(
        "Supabase is not configured in this runtime, so no report can be ingested.",
        503,
      );
    }
    assertWithinRateLimit(request, "upload");

    const form = await request.formData().catch(() => null);
    if (!form) return disabled("The upload could not be read.", 400);

    const file = form.get("file");
    if (!(file instanceof File)) return disabled("No file was included in the upload.", 400);
    if (file.size > UPLOAD_LIMITS.maxBytes) {
      return disabled("The workbook is larger than the upload limit.", 413);
    }

    /**
     * WHICH SHEET TO READ.
     *
     * The workbook contains more than one sheet that a parser can read, so the
     * caller names one. Validated against the registry rather than passed
     * through: an unknown key must be a clear refusal, never a silent fall back
     * to a different sheet whose figures would then be filed under the wrong
     * view. Omitting it keeps the original behaviour.
     */
    const requestedParserKey = form.get("parserKey");
    const parserKey =
      typeof requestedParserKey === "string" && requestedParserKey.trim() !== ""
        ? requestedParserKey.trim()
        : COMP_SALES_PARSER_KEY;

    if (!parserByKey(parserKey)) {
      return NextResponse.json(
        {
          error: `No reporting parser is registered under the key "${parserKey}".`,
          code: "unknown_parser_key",
          available: REPORT_PARSERS.map((parser) => parser.key),
        },
        { status: 400 },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = sha256Hex(bytes);

    /*
     * DEFENCE IN DEPTH, while the allowlist is populated. The caller is already
     * authorized by this point; this narrows WHICH artifact they may file.
     * Emptying the list for recurring production ingestion is a configuration
     * decision — see `approved-sources.ts` — and the credential remains the
     * gate either way.
     */
    const approved = findApprovedSource(sha256);
    if (allowlistEnforced() && !approved) {
      return NextResponse.json(
        {
          error:
            "This workbook is not an approved reporting source. Controlled ingestion " +
            "accepts only artifacts whose content digest has been reviewed and committed.",
          code: "source_not_approved",
          // Echoing the digest is safe and is what makes the refusal actionable.
          sha256,
        },
        { status: 403 },
      );
    }

    const outcome = await ingestReportWorkbook({
      bytes,
      originalFilename: file.name || "workbook.xlsx",
      mimeType: file.type || XLSX_MIME,
      sourceCode: approved?.sourceCode ?? DEFAULT_SOURCE_CODE,
      parserKey,
      externalMessageId: null,
      externalArchiveUrl: null,
    });

    const { report } = outcome;
    const skippedByReason: Record<string, number> = {};
    for (const row of report.skippedRows) {
      skippedByReason[row.reason] = (skippedByReason[row.reason] ?? 0) + 1;
    }
    const warningsByCode: Record<string, number> = {};
    for (const warning of report.warnings) {
      warningsByCode[warning.code] = (warningsByCode[warning.code] ?? 0) + 1;
    }
    const factsByBasisYear: Record<string, number> = {};
    for (const fact of report.facts) {
      const key = String(fact.basisYear ?? "none");
      factsByBasisYear[key] = (factsByBasisYear[key] ?? 0) + 1;
    }

    return NextResponse.json({
      outcome: outcome.outcome,
      /*
       * WHICH CREDENTIAL FILED THIS. An operator label, never the secret — so
       * "who ingested the August report" and "which credential do I revoke"
       * have an answer without anything sensitive being written down.
       */
      credentialId: auth.credentialId,
      ingestionId: outcome.ingestionId,
      fileId: outcome.fileId,
      periodId: outcome.periodId,
      sha256: outcome.sha256,
      storageBucket: outcome.storageBucket,
      storagePath: outcome.storagePath,
      fileCreated: outcome.fileCreated,
      failureReason: outcome.failureReason,
      // Structural summary only.
      parserKey: report.parserKey,
      parserVersion: report.parserVersion,
      sourceSheet: report.diagnostics.sheetSelected,
      period: {
        grain: report.period.grain,
        periodStart: report.period.periodStart,
        periodEnd: report.period.periodEnd,
        fiscalYear: report.period.fiscalYear,
        labelRaw: report.period.labelRaw,
      },
      salonsParsed: report.salons.length,
      factsParsed: report.facts.length,
      factsWritten: outcome.factCount,
      salonsWritten: outcome.salonCount,
      supersededFacts: outcome.supersededFacts,
      supersededAttributes: outcome.supersededAttributes,
      factsByBasisYear,
      warningsByCode,
      skippedByReason,
      metricCodes: [...new Set(report.facts.map((fact) => fact.metricCode))].sort(),
      requiresReview: report.diagnostics.requiresReview,
    });
  } catch (error) {
    // errorResponse redacts, and maps unrecognised errors to a generic 500 so
    // no upstream message carrying request content is reflected back.
    return errorResponse(error, "admin/reporting/ingest");
  }
}
