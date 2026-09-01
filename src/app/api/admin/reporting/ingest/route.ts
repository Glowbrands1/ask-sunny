import { NextResponse } from "next/server";

import { assertWithinRateLimit, errorResponse } from "@/lib/api/respond";
import { UPLOAD_LIMITS } from "@/lib/config/models";
import {
  SUPABASE_URL_ENV,
  supabaseSecretKeyConfigured,
} from "@/lib/config/server-env";
import { findApprovedSource, APPROVED_SOURCES } from "@/lib/reporting/approved-sources";
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
 * WHAT PROTECTS IT, and why it is not the usual `authorizeRequest`:
 *
 *   1. AN APPROVED-DIGEST ALLOWLIST. The endpoint ingests only bytes whose
 *      SHA-256 is already committed in `approved-sources.ts`. It therefore
 *      cannot function as a general upload endpoint — see that file for the
 *      full reasoning. This is the primary gate.
 *   2. NEVER IN PRODUCTION. Refused outright when VERCEL_ENV is "production".
 *   3. SERVER-SIDE CREDENTIALS ONLY. The secret key is read from the server
 *      environment by `getSupabaseAdmin()` and never crosses the boundary: this
 *      route returns counts and identifiers, never configuration.
 *   4. RATE LIMITED, like every other write route.
 *
 * `authorizeRequest` is deliberately not called: with no identity provider
 * configured it refuses every request, so it would gate this route shut rather
 * than protect it. When authentication ships, this route should be folded into
 * the real ingest endpoint behind a permission and a service identity, and the
 * allowlist emptied.
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
  return NextResponse.json({
    enabled: process.env.VERCEL_ENV !== "production",
    vercelEnv: process.env.VERCEL_ENV ?? "local",
    supabaseUrlConfigured: Boolean(process.env[SUPABASE_URL_ENV]),
    supabaseSecretConfigured: supabaseSecretKeyConfigured(),
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
    if (process.env.VERCEL_ENV === "production") {
      return disabled("Controlled report ingestion is not available in production.", 404);
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

    // THE GATE. An unapproved artifact is refused before it is even parsed.
    const approved = findApprovedSource(sha256);
    if (!approved) {
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
      sourceCode: approved.sourceCode,
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
