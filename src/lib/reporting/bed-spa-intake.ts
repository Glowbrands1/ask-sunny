import "server-only";

import { detectBedUsage, parseBedUsage, BED_USAGE_PARSER_KEY } from "./bed-usage/parser";
import { ReportParseError } from "./errors";
import { sha256Hex, XLSX_MIME } from "./ingest";
import {
  detectSpaEngagement,
  parseSpaEngagement,
  SPA_ENGAGEMENT_PARSER_KEY,
} from "./spa-engagement/parser";
import {
  detectSpaWellness,
  parseSpaWellness,
  SPA_WELLNESS_PARSER_KEY,
} from "./spa-wellness/parser";
import {
  SupabaseBedSpaRepository,
  windowParserKey,
  type BedSpaIngestionResult,
} from "./repository/bed-spa-repository";
import {
  buildReportStoragePath,
  SupabaseReportSourceStorage,
  type ReportSourceStorage,
} from "./repository/source-storage";
import { REPORTING_BUCKET } from "./repository/supabase-reporting-repository";
import { readWorkbook, type WorkbookView } from "./workbook";

/**
 * ============================================================================
 * INTAKE FOR THE THREE NEW REPORT FAMILIES
 * ============================================================================
 *
 * Deliberately the SAME SHAPE as `intake.ts` and deliberately a separate
 * function rather than a branch inside it. The Comp Report's intake exists to
 * run several parsers over ONE workbook that contains several sheets of the
 * same family; these three families arrive as three different files from three
 * different senders, and exactly one of them recognises any given delivery.
 *
 * So the flow is:
 *
 *   1. Digest the bytes, before anything else, so what arrived has an identity
 *      even if every later step fails.
 *   2. Ask each family's detector. NO WRITE, NO UPLOAD.
 *   3. Refuse the whole delivery if none recognises it.
 *   4. Parse and validate — still no write. A file that cannot become rows is
 *      recorded as a failure BEFORE its bytes are stored, so a delivery in
 *      which parsing fails leaves no object behind.
 *   5. Upload ONCE, only if parsing succeeded.
 *   6. Write. Bed Usage and Spa Engagement are one transaction; SPA Wellness is
 *      one per window, and a window's failure is that window's alone.
 *
 * A DELIVERY IS AT MOST ONE FAMILY. The three detectors look for three
 * different headings, so a file cannot be two of them — and if a future file
 * ever were, this refuses rather than guessing, because filing one report's
 * figures under another's name is the failure that would be hardest to notice.
 *
 * THE RESPONSE CARRIES NO FIGURES. Counts, identifiers, periods, sheet names
 * and warning text. No session count, no tan count, no salon financials.
 */

export type BedSpaFamilyKey = "bed_usage" | "spa_wellness" | "spa_engagement";

/** One family's detector and writer, as data. */
interface BedSpaFamily {
  readonly key: BedSpaFamilyKey;
  readonly label: string;
  readonly parserKey: string;
  readonly sourceCode: string;
  detect(workbook: WorkbookView): { supported: boolean; kind: string; reason: string; markersMissing: string[] };
  ingest(
    bytes: Uint8Array,
    file: BedSpaFileRecord,
    repository: SupabaseBedSpaRepository,
    company?: string,
  ): Promise<BedSpaIngestionResult[]>;
  /**
   * Parses without writing, so validation precedes the upload.
   *
   * Returns everything the caller needs from the parse — the attempt keys, the
   * sheets read, the period and the warnings — in ONE pass. An earlier revision
   * parsed twice, once for the attempt keys and once for the period, which
   * doubled the work on a 2,900-row workbook and left two places for the two
   * answers to disagree.
   */
  preflight(workbook: WorkbookView, company?: string): BedSpaPreflight;
}

/** What one parse tells the intake layer, before anything is written. */
interface BedSpaPreflight {
  /** One per unit of work: one for most families, one per window for SPA. */
  readonly attemptKeys: string[];
  readonly sheetNames: string[];
  readonly period: { grain: string; periodEnd: string };
  readonly warnings: string[];
}

/** The lineage a delivery carries. Mirrors `SourceFileRecord`. */
export interface BedSpaFileRecord {
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storagePath: string;
  storageBucket: string;
  externalMessageId: string | null;
  externalArchiveUrl: string | null;
  senderEmail: string | null;
  receivedAt: string | null;
  inboundEmailId: string | null;
}

const bedUsage: BedSpaFamily = {
  key: "bed_usage",
  label: "Bed Usage Report",
  parserKey: BED_USAGE_PARSER_KEY,
  sourceCode: "bed_usage_email",
  detect: (workbook) => normalizeDetection(detectBedUsage(workbook)),
  preflight: (workbook, company) => {
    const report = parseBedUsage(workbook, { company });
    return {
      attemptKeys: [report.parserKey],
      sheetNames: [...report.sourceSheetNames],
      period: { grain: report.period.grain, periodEnd: report.period.periodEnd },
      warnings: [...report.warnings],
    };
  },
  ingest: async (bytes, file, repository, company) => [
    await repository.ingestBedUsage({
      file,
      report: parseBedUsage(await readWorkbook(bytes), { company }),
    }),
  ],
};

const spaWellness: BedSpaFamily = {
  key: "spa_wellness",
  label: "STC SPA Wellness Tracking",
  parserKey: SPA_WELLNESS_PARSER_KEY,
  sourceCode: "spa_wellness_email",
  detect: (workbook) => normalizeDetection(detectSpaWellness(workbook)),
  preflight: (workbook, company) => {
    const report = parseSpaWellness(workbook, { company });
    return {
      // One attempt per window, because each window is its own period.
      attemptKeys: report.windows.map((window) =>
        windowParserKey(report.parserKey, window.window),
      ),
      sheetNames: [...report.sourceSheetNames],
      /*
       * The FIRST window's period names the storage path. Which one it is does
       * not matter for correctness — the path also carries the content digest,
       * which is what makes it unique — and taking the first keeps the path
       * deterministic for a given file.
       */
      period: {
        grain: report.windows[0].period.grain,
        periodEnd: report.windows[0].period.periodEnd,
      },
      warnings: [...report.warnings],
    };
  },
  ingest: async (bytes, file, repository, company) =>
    repository.ingestSpaWellness({
      file,
      report: parseSpaWellness(await readWorkbook(bytes), { company }),
    }),
};

const spaEngagement: BedSpaFamily = {
  key: "spa_engagement",
  label: "Spa Sessions per Unique Tanner per Spa Bed",
  parserKey: SPA_ENGAGEMENT_PARSER_KEY,
  sourceCode: "spa_engagement_email",
  detect: (workbook) => normalizeDetection(detectSpaEngagement(workbook)),
  preflight: (workbook, company) => {
    const report = parseSpaEngagement(workbook, { company });
    return {
      attemptKeys: [report.parserKey],
      sheetNames: [...report.sourceSheetNames],
      period: { grain: report.period.grain, periodEnd: report.period.periodEnd },
      warnings: [...report.warnings],
    };
  },
  ingest: async (bytes, file, repository, company) => [
    await repository.ingestSpaEngagement({
      file,
      report: parseSpaEngagement(await readWorkbook(bytes), { company }),
    }),
  ],
};

export const BED_SPA_FAMILIES: readonly BedSpaFamily[] = [bedUsage, spaWellness, spaEngagement];

function normalizeDetection(result: {
  supported: boolean;
  reason?: string;
  kind?: string;
  markersMissing?: string[];
}) {
  return {
    supported: result.supported,
    kind: result.supported ? "supported" : (result.kind ?? "unsupported"),
    reason: result.reason ?? "",
    markersMissing: result.markersMissing ?? [],
  };
}

/** One family's verdict on a delivery. */
export interface BedSpaDetection {
  familyKey: BedSpaFamilyKey;
  label: string;
  parserKey: string;
  supported: boolean;
  kind: string;
  reason: string;
  markersMissing: string[];
}

/**
 * Every family's verdict on one workbook. Never throws for an unreadable file —
 * that is a refusal the caller reports, not an error.
 */
export async function detectBedSpaReport(bytes: Uint8Array): Promise<BedSpaDetection[]> {
  const workbook = await readWorkbook(bytes);
  return BED_SPA_FAMILIES.map((family) => {
    const result = family.detect(workbook);
    return {
      familyKey: family.key,
      label: family.label,
      parserKey: family.parserKey,
      supported: result.supported,
      kind: result.kind,
      reason: result.reason,
      markersMissing: result.markersMissing,
    };
  });
}

export type BedSpaAttemptStatus = "succeeded" | "already_ingested" | "failed";

export interface BedSpaAttempt {
  familyKey: BedSpaFamilyKey;
  parserKey: string;
  status: BedSpaAttemptStatus;
  period: { grain: string; periodStart: string; periodEnd: string; label: string } | null;
  periodId: string | null;
  factsWritten: number;
  salonsWritten: number;
  supersededFacts: number;
  /** Salon names the delivery named that could not be placed. */
  unresolvedSalons: string[];
  ingestionId: string | null;
  failure: { code: string; message: string; details: string[] } | null;
}

export interface BedSpaIntakeResult {
  fileAccepted: boolean;
  sha256: string;
  sizeBytes: number;
  originalFilename: string;
  familyKey: BedSpaFamilyKey | null;
  familyLabel: string | null;
  attempts: BedSpaAttempt[];
  factsWritten: number;
  supersededFacts: number;
  /** Every distinct salon name across the attempts that could not be placed. */
  unresolvedSalons: string[];
  /** Structural warnings the parser raised. Never a figure. */
  warnings: string[];
}

export class BedSpaIntakeRejected extends Error {
  readonly status = 422;
  readonly code: "unreadable_workbook" | "unsupported_workbook" | "template_drift" | "ambiguous_workbook";
  readonly detections: BedSpaDetection[];

  constructor(
    detections: BedSpaDetection[],
    options: { unreadable?: string; ambiguous?: BedSpaFamilyKey[] } = {},
  ) {
    const drifted = detections.filter((entry) => entry.kind === "template_drift");
    const code = options.unreadable
      ? "unreadable_workbook"
      : options.ambiguous
        ? "ambiguous_workbook"
        : drifted.length > 0
          ? "template_drift"
          : "unsupported_workbook";
    super(
      options.unreadable
        ? `The delivery could not be read as an .xlsx workbook: ${options.unreadable}`
        : options.ambiguous
          ? `The workbook carries the markers of more than one report (${options.ambiguous.join(", ")}), so it was refused rather than filed under one of them.`
          : drifted.length > 0
            ? `The workbook no longer matches the reviewed mapping: ${drifted.map((entry) => entry.reason).join(" ")}`
            : "No Bed Usage or Spa report parser recognised this workbook.",
    );
    this.name = "BedSpaIntakeRejected";
    this.code = code;
    this.detections = detections;
  }
}

/** A parse failure, reduced to something safe to return to a caller. */
function describeFailure(error: unknown): { code: string; message: string; details: string[] } {
  if (error instanceof ReportParseError) {
    return {
      code: error.code,
      message: error.message,
      details: Array.isArray(error.details) ? error.details.map(String) : [],
    };
  }
  /*
   * Anything else is reduced on purpose. A database error string can carry
   * column names, constraint names and occasionally a value from the offending
   * row, and this response goes to an external caller.
   */
  return {
    code: "ingestion_failed",
    message: "The ingestion could not be completed. The attempt is recorded.",
    details: [],
  };
}

export interface BedSpaIntakeInput {
  bytes: Uint8Array;
  originalFilename: string;
  mimeType?: string;
  externalMessageId?: string | null;
  senderEmail?: string | null;
  receivedAt?: string | null;
  externalArchiveUrl?: string | null;
  inboundEmailId?: string | null;
}

export interface BedSpaIntakeDependencies {
  repository?: SupabaseBedSpaRepository;
  storage?: ReportSourceStorage;
  /**
   * Which company to scope this delivery to. Defaults to the authorized one.
   *
   * A DEPENDENCY, NOT AN INPUT, and the distinction is the security boundary.
   * `BedSpaIntakeInput` is what an HTTP or email caller supplies; this object
   * is constructed server-side by the route handler alongside the repository
   * and the storage client. So the tests can scope to an invented company
   * without there being any request field that widens the slice.
   */
  company?: string;
}

/** Runs one delivery through whichever of the three families recognises it. */
export async function intakeBedSpaWorkbook(
  input: BedSpaIntakeInput,
  dependencies: BedSpaIntakeDependencies = {},
): Promise<BedSpaIntakeResult> {
  const repository = dependencies.repository ?? new SupabaseBedSpaRepository();
  const storage = dependencies.storage ?? new SupabaseReportSourceStorage();

  // 1. Identity first.
  const sha256 = sha256Hex(input.bytes);

  // 2. Every family's verdict, from one read of the workbook.
  let detections: BedSpaDetection[];
  try {
    detections = await detectBedSpaReport(input.bytes);
  } catch (error) {
    throw new BedSpaIntakeRejected([], {
      unreadable:
        error instanceof ReportParseError ? error.message : "The file is not a readable spreadsheet.",
    });
  }

  const applicable = detections.filter((entry) => entry.supported);

  // 3. Nothing recognised it, or more than one did. Refuse the whole delivery.
  if (applicable.length === 0) throw new BedSpaIntakeRejected(detections);
  if (applicable.length > 1) {
    throw new BedSpaIntakeRejected(detections, {
      ambiguous: applicable.map((entry) => entry.familyKey),
    });
  }

  const detection = applicable[0];
  const family = BED_SPA_FAMILIES.find((entry) => entry.key === detection.familyKey)!;

  /*
   * 4. PARSE BEFORE STORING ANYTHING. A file that cannot become rows is a
   * failure recorded here, with nothing uploaded and nothing written — so a
   * delivery whose parse fails leaves no object in the bucket at all.
   */
  let preflight: BedSpaPreflight;
  try {
    preflight = family.preflight(await readWorkbook(input.bytes), dependencies.company);
  } catch (error) {
    return {
      fileAccepted: true,
      sha256,
      sizeBytes: input.bytes.byteLength,
      originalFilename: input.originalFilename,
      familyKey: family.key,
      familyLabel: family.label,
      attempts: [
        {
          familyKey: family.key,
          parserKey: family.parserKey,
          status: "failed",
          period: null,
          periodId: null,
          factsWritten: 0,
          salonsWritten: 0,
          supersededFacts: 0,
          unresolvedSalons: [],
          ingestionId: null,
          failure: describeFailure(error),
        },
      ],
      factsWritten: 0,
      supersededFacts: 0,
      unresolvedSalons: [],
      warnings: [],
    };
  }

  /*
   * 5. ONE UPLOAD, ONE OBJECT. The path carries the content digest, so
   * "exists" means "these exact bytes are already stored" — and a retrying
   * pipeline re-delivering the same report is the COMMON case. A failure to
   * answer is treated as absent, because an overwrite of identical bytes is
   * harmless and a missing object is not.
   */
  const storagePath = buildReportStoragePath({
    reportFamily: family.key,
    grain: preflight.period.grain,
    periodEnd: preflight.period.periodEnd,
    sha256,
    originalFilename: input.originalFilename,
  });

  /*
   * THE CONTENT TYPE IS THE ONE WE PROVED, NOT THE ONE THE CALLER CLAIMED.
   *
   * By this point `detectBedSpaReport` has read the bytes and identified them
   * as exactly one of the three families, every one of which is a real `.xlsx`.
   * So the type is known, and `input.mimeType` is only ever a hint from the
   * transport.
   *
   * IT IS A HINT THAT WAS WRONG IN PRACTICE, AND EXPENSIVELY SO. `curl -F
   * "file=@report.xlsx"` sends `application/octet-stream` — curl does not
   * consult the system mime table — and the route passed that through as
   * `file.type || XLSX_MIME`, where the `||` never fires because
   * octet-stream is truthy. The `reporting-sources` bucket allows only four
   * spreadsheet and CSV types, so Storage refused the object, the upload threw,
   * and the whole delivery failed with a generic 500 that named none of this.
   *
   * The bucket is RIGHT to refuse it, which is why the fix is here and not
   * there: widening the allowlist to admit `application/octet-stream` would
   * retire a real control — it is what stops a mislabelled file being stored —
   * to accommodate a claim this code should not have been trusting.
   *
   * The same value goes into `report_files.mime_type`, so the lineage row and
   * the stored object always agree about what the file is.
   */
  const contentType = XLSX_MIME;

  const alreadyStored = await storage.exists(storagePath).catch(() => false);
  if (!alreadyStored) {
    try {
      await storage.upload({
        path: storagePath,
        bytes: input.bytes,
        contentType,
      });
      // No binding: the error is deliberately not read. A Storage message can
      // name the bucket, the path and the rejected content type, and none of
      // that may reach an external caller — so there is nothing to inspect.
    } catch {
      /*
       * A STORAGE FAILURE IS REPORTED, NOT RAISED. It used to escape to the
       * route's catch-all, which answered "the intake could not be completed"
       * and left nothing behind to look at — no file row, no attempt, nothing
       * in the response naming the stage. Tracing it took a database session.
       *
       * Reported as its own stage, with the same shape a parse failure uses, so
       * the response says WHERE it broke and the delivery stays retryable.
       */
      return {
        fileAccepted: true,
        sha256,
        sizeBytes: input.bytes.byteLength,
        originalFilename: input.originalFilename,
        familyKey: family.key,
        familyLabel: family.label,
        attempts: [
          {
            familyKey: family.key,
            parserKey: family.parserKey,
            status: "failed",
            period: null,
            periodId: null,
            factsWritten: 0,
            salonsWritten: 0,
            supersededFacts: 0,
            unresolvedSalons: [],
            ingestionId: null,
            failure: {
              code: "source_storage_failed",
              message:
                "The workbook parsed, and could not be stored in the reporting bucket. " +
                "Nothing was written, and re-sending the same file is safe.",
              // The stage, and nothing from the error: a Storage message can
              // name the bucket, the path and the rejected content type, and
              // this response leaves the building.
              details: ["stage: source storage upload"],
            },
          },
        ],
        factsWritten: 0,
        supersededFacts: 0,
        unresolvedSalons: [],
        warnings: [],
      };
    }
  }

  const file: BedSpaFileRecord = {
    originalFilename: input.originalFilename,
    mimeType: contentType,
    sizeBytes: input.bytes.byteLength,
    sha256,
    storagePath,
    storageBucket: REPORTING_BUCKET,
    externalMessageId: input.externalMessageId ?? null,
    externalArchiveUrl: input.externalArchiveUrl ?? null,
    senderEmail: input.senderEmail ?? null,
    receivedAt: input.receivedAt ?? null,
    inboundEmailId: input.inboundEmailId ?? null,
  };

  // 6. Write.
  const attempts: BedSpaAttempt[] = [];
  try {
    const results = await family.ingest(input.bytes, file, repository, dependencies.company);
    results.forEach((result, index) => {
      attempts.push({
        familyKey: family.key,
        parserKey: preflight.attemptKeys[index] ?? family.parserKey,
        status:
          result.outcome === "succeeded"
            ? "succeeded"
            : result.outcome === "already_ingested"
              ? "already_ingested"
              : "failed",
        period: result.period,
        periodId: result.periodId,
        factsWritten: result.factCount,
        salonsWritten: result.salonCount,
        supersededFacts: result.supersededFacts,
        unresolvedSalons: result.unresolvedSalons,
        ingestionId: result.ingestionId,
        failure:
          result.outcome === "failed"
            ? {
                code: "ingestion_failed",
                message:
                  result.failureReason ??
                  "The ingestion could not be completed. The attempt is recorded.",
                details: [],
              }
            : null,
      });
    });
  } catch (error) {
    attempts.push({
      familyKey: family.key,
      parserKey: family.parserKey,
      status: "failed",
      period: null,
      periodId: null,
      factsWritten: 0,
      salonsWritten: 0,
      supersededFacts: 0,
      unresolvedSalons: [],
      ingestionId: null,
      failure: describeFailure(error),
    });
  }

  return {
    fileAccepted: true,
    sha256,
    sizeBytes: input.bytes.byteLength,
    originalFilename: input.originalFilename,
    familyKey: family.key,
    familyLabel: family.label,
    attempts,
    factsWritten: attempts.reduce((total, attempt) => total + attempt.factsWritten, 0),
    supersededFacts: attempts.reduce((total, attempt) => total + attempt.supersededFacts, 0),
    unresolvedSalons: [
      ...new Set(attempts.flatMap((attempt) => attempt.unresolvedSalons)),
    ],
    warnings: preflight.warnings,
  };
}
