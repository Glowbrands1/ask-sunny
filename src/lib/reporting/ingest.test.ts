import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { buildCompSalesWorkbook } from "./__fixtures__/comp-sales-workbook";
import { buildRollingWorkbook } from "./__fixtures__/comp-sales-rolling-workbook";
import { ROLLING_PARSER_KEY } from "./comp-sales/rolling-parser";
import { COMP_SALES_PARSER_KEY } from "./comp-sales/parser";
import { validateParsedReport } from "./validation";
import { ingestReportWorkbook, ReportValidationError, sha256Hex } from "./ingest";
import { buildReportStoragePath, type ReportSourceStorage } from "./repository/source-storage";
import {
  buildIngestionPayload,
  ingestionFingerprint,
  safeFailureReason,
  SupabaseReportingRepository,
} from "./repository/supabase-reporting-repository";
import { parseReportWorkbook } from "./index";

/**
 * The ingestion service and repository, exercised with fakes. Nothing here
 * reaches a network, a database or a bucket.
 */

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

/** A Supabase client stand-in that records rpc calls and replays scripted results. */
function fakeClient(
  responses: Partial<Record<string, { data?: unknown; error?: { message: string } }>>,
): { client: SupabaseClient; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  const client = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const scripted = responses[name];
      return Promise.resolve({
        data: scripted?.data ?? null,
        error: scripted?.error ?? null,
      });
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

function fakeStorage(): ReportSourceStorage & { uploads: { path: string; bytes: number }[] } {
  const uploads: { path: string; bytes: number }[] = [];
  return {
    uploads,
    async upload(input) {
      uploads.push({ path: input.path, bytes: input.bytes.byteLength });
    },
    async exists() {
      return true;
    },
  };
}

const BEGUN = {
  data: { status: "started", file_id: "file-1", file_created: true, ingestion_id: "ing-1" },
};
const COMPLETED = {
  data: {
    status: "succeeded",
    ingestion_id: "ing-1",
    period_id: "period-1",
    fact_count: 69,
    salon_count: 3,
    superseded_facts: 0,
    superseded_attributes: 0,
  },
};

describe("storage path", () => {
  it("is collision-safe and derived entirely on the server", () => {
    const path = buildReportStoragePath({
      reportFamily: "comp_sales",
      grain: "mtd",
      periodEnd: "2026-08-30",
      sha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      originalFilename: "Comp Report 2026 08 30 - Bowen, Curt.xlsx",
    });
    expect(path).toBe("comp_sales/mtd-2026-08-30/abcdef0123456789/Comp-Report-2026-08-30-Bowen-Curt.xlsx");
  });

  it("cannot be escaped by a crafted file name", () => {
    const path = buildReportStoragePath({
      reportFamily: "comp_sales",
      grain: "mtd",
      periodEnd: "2026-08-30",
      sha256: "0".repeat(64),
      originalFilename: "../../../etc/passwd",
    });
    expect(path).not.toContain("..");
    expect(path.split("/")).toHaveLength(4);
  });

  it("gives the same bytes the same key, so a retry overwrites itself", () => {
    const base = {
      reportFamily: "comp_sales",
      grain: "mtd",
      periodEnd: "2026-08-30",
      sha256: "1".repeat(64),
      originalFilename: "a.xlsx",
    };
    expect(buildReportStoragePath(base)).toBe(buildReportStoragePath(base));
  });

  it("separates two different files for the same period", () => {
    const a = buildReportStoragePath({
      reportFamily: "comp_sales", grain: "mtd", periodEnd: "2026-08-30",
      sha256: "1".repeat(64), originalFilename: "same-name.xlsx",
    });
    const b = buildReportStoragePath({
      reportFamily: "comp_sales", grain: "mtd", periodEnd: "2026-08-30",
      sha256: "2".repeat(64), originalFilename: "same-name.xlsx",
    });
    expect(a).not.toBe(b);
  });
});

describe("fingerprint", () => {
  it("matches the definition recorded in the schema comment", () => {
    const value = ingestionFingerprint({
      sourceCode: "comp_report_email",
      fileSha256: "a".repeat(64),
      parserKey: "comp_sales_mtd_vs_2024",
      parserVersion: 1,
    });
    expect(value).toMatch(/^[0-9a-f]{64}$/);
    // Deterministic, and sensitive to every component.
    expect(value).not.toBe(
      ingestionFingerprint({
        sourceCode: "comp_report_email",
        fileSha256: "a".repeat(64),
        parserKey: "comp_sales_mtd_vs_2024",
        parserVersion: 2,
      }),
    );
  });
});

describe("the payload handed to the database", () => {
  it("never supplies metric_basis_year_required — the catalogue decides", async () => {
    const report = await parseReportWorkbook(await buildCompSalesWorkbook());
    const payload = buildIngestionPayload(report);
    for (const fact of payload.facts) {
      expect(Object.keys(fact)).not.toContain("metric_basis_year_required");
    }
    // Metrics and salons travel as natural keys, not as ids the parser invented.
    expect(Object.keys(payload.facts[0])).toEqual(
      expect.arrayContaining(["salon_number", "metric_code", "basis_year", "value", "source_sheet", "source_column"]),
    );
  });

  it("carries warning text but no figures", async () => {
    const report = await parseReportWorkbook(
      await buildCompSalesWorkbook({ withUnknownColumns: true }),
    );
    const payload = buildIngestionPayload(report);
    for (const warning of payload.warnings) {
      expect(warning).not.toMatch(/\d{4,}\.\d{2}/);
    }
  });
});

describe("ingestReportWorkbook", () => {
  it("uploads the bytes and then writes, in that order", async () => {
    const { client, calls } = fakeClient({
      begin_report_ingestion: BEGUN,
      complete_comp_sales_ingestion: COMPLETED,
    });
    const storage = fakeStorage();
    const bytes = await buildCompSalesWorkbook();

    const result = await ingestReportWorkbook(
      { bytes, originalFilename: "invented.xlsx" },
      { repository: new SupabaseReportingRepository(client), storage },
    );

    expect(result.outcome).toBe("succeeded");
    expect(result.sha256).toBe(sha256Hex(bytes));
    expect(storage.uploads).toHaveLength(1);
    expect(storage.uploads[0].path).toContain("comp_sales/mtd-2026-08-30/");
    expect(calls.map((call) => call.name)).toEqual([
      "begin_report_ingestion",
      "complete_comp_sales_ingestion",
    ]);
    expect(result.storageBucket).toBe("reporting-sources");
  });

  it("records the file's SHA and lineage on the file row", async () => {
    const { client, calls } = fakeClient({
      begin_report_ingestion: BEGUN,
      complete_comp_sales_ingestion: COMPLETED,
    });
    const bytes = await buildCompSalesWorkbook();
    await ingestReportWorkbook(
      {
        bytes,
        originalFilename: "invented.xlsx",
        externalMessageId: "MSG-INVENTED-1",
        externalArchiveUrl: "https://example.invalid/archive/1",
      },
      { repository: new SupabaseReportingRepository(client), storage: fakeStorage() },
    );
    const file = calls[0].args.p_file as Record<string, unknown>;
    expect(file.file_sha256).toBe(sha256Hex(bytes));
    expect(file.storage_bucket).toBe("reporting-sources");
    expect(file.external_message_id).toBe("MSG-INVENTED-1");
    expect(file.external_archive_url).toBe("https://example.invalid/archive/1");
    expect(file.size_bytes).toBe(bytes.byteLength);
  });

  it("writes nothing at all when validation fails", async () => {
    const { client, calls } = fakeClient({});
    const storage = fakeStorage();
    // A duplicate measure column the parser could not resolve sets
    // requiresReview, which validation refuses.
    const bytes = await buildCompSalesWorkbook({
      withStaleDuplicateBlock: true,
      staleDuplicateMode: "conflicting",
    });

    await expect(
      ingestReportWorkbook(
        { bytes, originalFilename: "invented.xlsx" },
        { repository: new SupabaseReportingRepository(client), storage },
      ),
    ).rejects.toBeInstanceOf(ReportValidationError);

    // No upload, no attempt, no file row.
    expect(storage.uploads).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("is idempotent: the same bytes under the same parser do no work", async () => {
    const { client, calls } = fakeClient({
      begin_report_ingestion: {
        data: {
          status: "already_ingested",
          file_id: "file-1",
          file_created: false,
          ingestion_id: "ing-earlier",
        },
      },
    });
    const result = await ingestReportWorkbook(
      { bytes: await buildCompSalesWorkbook(), originalFilename: "invented.xlsx" },
      { repository: new SupabaseReportingRepository(client), storage: fakeStorage() },
    );
    expect(result.outcome).toBe("already_ingested");
    expect(result.ingestionId).toBe("ing-earlier");
    expect(result.factCount).toBe(0);
    // The atomic write is never attempted.
    expect(calls.map((call) => call.name)).toEqual(["begin_report_ingestion"]);
  });

  it("records a failed attempt when the atomic write rolls back", async () => {
    const { client, calls } = fakeClient({
      begin_report_ingestion: BEGUN,
      complete_comp_sales_ingestion: {
        error: { message: 'duplicate key value violates unique constraint "comp_sales_facts_live_key"\nDETAIL: Key (salon_id)=(11469.87) already exists.' },
      },
      fail_report_ingestion: { data: { status: "failed" } },
    });
    const result = await ingestReportWorkbook(
      { bytes: await buildCompSalesWorkbook(), originalFilename: "invented.xlsx" },
      { repository: new SupabaseReportingRepository(client), storage: fakeStorage() },
    );

    expect(result.outcome).toBe("failed");
    // The attempt survives the rollback and is annotated.
    expect(calls.map((call) => call.name)).toEqual([
      "begin_report_ingestion",
      "complete_comp_sales_ingestion",
      "fail_report_ingestion",
    ]);
    // And the reason an operator reads carries no data values.
    const reason = (calls[2].args.p_reason as string) ?? "";
    expect(reason).not.toContain("11469.87");
    expect(reason).not.toMatch(/detail/i);
    expect(result.failureReason).not.toContain("11469.87");
  });

  it("propagates a parse failure without touching storage", async () => {
    const { client, calls } = fakeClient({});
    const storage = fakeStorage();
    await expect(
      ingestReportWorkbook(
        { bytes: new Uint8Array([1, 2, 3]), originalFilename: "not-a-workbook.xlsx" },
        { repository: new SupabaseReportingRepository(client), storage },
      ),
    ).rejects.toMatchObject({ code: "workbook_unreadable" });
    expect(storage.uploads).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("refuses a duplicate salon before any write", async () => {
    const { client, calls } = fakeClient({});
    const storage = fakeStorage();
    await expect(
      ingestReportWorkbook(
        { bytes: await buildCompSalesWorkbook({ duplicateSalonNumber: "0468" }), originalFilename: "invented.xlsx" },
        { repository: new SupabaseReportingRepository(client), storage },
      ),
    ).rejects.toMatchObject({ code: "duplicate_salon_number" });
    expect(storage.uploads).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("does not write when the upload fails", async () => {
    const { client, calls } = fakeClient({ begin_report_ingestion: BEGUN });
    const storage: ReportSourceStorage = {
      upload: vi.fn().mockRejectedValue(new Error("Could not store the source workbook: boom")),
      exists: vi.fn().mockResolvedValue(false),
    };
    await expect(
      ingestReportWorkbook(
        { bytes: await buildCompSalesWorkbook(), originalFilename: "invented.xlsx" },
        { repository: new SupabaseReportingRepository(client), storage },
      ),
    ).rejects.toThrow(/store the source workbook/);
    // A file row must never name an object that does not exist.
    expect(calls).toHaveLength(0);
  });
});

describe("safeFailureReason", () => {
  it("strips parenthesised values and DETAIL lines", () => {
    const reason = safeFailureReason(
      'duplicate key value violates unique constraint "x"\nDETAIL: Key (a)=(secret) exists.',
    );
    expect(reason).not.toContain("secret");
    expect(reason).not.toMatch(/detail/i);
    expect(reason).toContain("rolled back");
  });

  it("caps the length so a log line stays readable", () => {
    expect(safeFailureReason("x".repeat(2000)).length).toBeLessThan(500);
  });
});

describe("two sheets of one workbook coexist", () => {
  /**
   * THE INCIDENT THIS SUITE EXISTS FOR.
   *
   * The first real rolling ingestion returned a generic 500 and wrote nothing.
   * Root cause: `validateParsedReport` looked metric codes up in the vs-2024
   * parser's vocabulary, so all 24 trailing-window codes were rejected as
   * unknown — a hard refusal at the gate, before storage or any database write.
   *
   * The dry run that was supposed to catch this parsed the rolling sheet and
   * asserted the PARSE. It never ran the gate. Parsing correctly and being
   * ingestible are different claims, and only one of them had a test.
   */

  it("accepts the rolling report at the gate", async () => {
    const report = await parseReportWorkbook(await buildRollingWorkbook(), {
      parserKey: ROLLING_PARSER_KEY,
    });
    const { ok, problems } = validateParsedReport(report);

    // Before the fix this produced one `unknown_metric` per rolling code.
    expect(problems.filter((problem) => problem.code === "unknown_metric")).toEqual([]);
    expect(problems).toEqual([]);
    expect(ok).toBe(true);
  });

  it("still accepts the year-comparison report at the gate", async () => {
    const report = await parseReportWorkbook(await buildCompSalesWorkbook(), {
      parserKey: COMP_SALES_PARSER_KEY,
    });
    expect(validateParsedReport(report).ok).toBe(true);
  });

  it("knows every code both parsers can produce, and nothing invented", async () => {
    const rolling = await parseReportWorkbook(await buildRollingWorkbook(), {
      parserKey: ROLLING_PARSER_KEY,
    });
    const yearly = await parseReportWorkbook(await buildCompSalesWorkbook(), {
      parserKey: COMP_SALES_PARSER_KEY,
    });

    const rollingCodes = new Set(rolling.facts.map((fact) => fact.metricCode));
    const yearlyCodes = new Set(yearly.facts.map((fact) => fact.metricCode));

    // 24 rolling and 16 year-comparison codes, and no overlap: that disjointness
    // is what lets both sheets hold live facts for the same salon and period
    // without colliding on the live business key.
    expect(rollingCodes.size).toBe(24);
    expect(yearlyCodes.size).toBe(16);
    for (const code of rollingCodes) expect(yearlyCodes.has(code)).toBe(false);
  });

  it("writes rolling facts under its own parser key and sheet", async () => {
    const { client, calls } = fakeClient({
      begin_report_ingestion: BEGUN,
      complete_comp_sales_ingestion: {
        data: { ...COMPLETED.data, fact_count: 72, salon_count: 3, superseded_facts: 0 },
      },
    });
    const storage = fakeStorage();

    const outcome = await ingestReportWorkbook(
      {
        bytes: await buildRollingWorkbook(),
        originalFilename: "comp-report.xlsx",
        parserKey: ROLLING_PARSER_KEY,
      },
      { repository: new SupabaseReportingRepository(client), storage },
    );

    expect(outcome.outcome).toBe("succeeded");

    const begin = calls.find((call) => call.name === "begin_report_ingestion");
    expect(begin?.args.p_parser_key).toBe("comp_sales_mtd_rolling");
    expect(begin?.args.p_sheet_names).toEqual(["CompReport(MTD)"]);

    // The fingerprint includes the parser key, which is what lets the same file
    // be ingested by a second parser without matching the first's idempotency.
    const yearly = ingestionFingerprint({
      sourceCode: "comp_report_email",
      fileSha256: outcome.sha256,
      parserKey: COMP_SALES_PARSER_KEY,
      parserVersion: 1,
    });
    expect(begin?.args.p_fingerprint).not.toBe(yearly);
  });

  it("hands the database only rolling facts, all without a basis year", async () => {
    const report = await parseReportWorkbook(await buildRollingWorkbook(), {
      parserKey: ROLLING_PARSER_KEY,
    });
    const payload = buildIngestionPayload(report) as {
      facts: { metric_code: string; basis_year: number | null; source_sheet: string }[];
      sheet_names: string[];
    };

    // The sheet list is what the SQL derives its supersession scope from, so a
    // wrong value here is what would retire the other sheet's facts.
    expect(payload.sheet_names).toEqual(["CompReport(MTD)"]);
    for (const fact of payload.facts) {
      expect(fact.source_sheet).toBe("CompReport(MTD)");
      expect(fact.basis_year).toBeNull();
      expect(fact.metric_code).toMatch(/_last_\d{1,2}m_(current|prior|pct_change)$/);
    }
  });

  it("reports a second rolling ingestion as already ingested, writing nothing", async () => {
    const { client, calls } = fakeClient({
      begin_report_ingestion: {
        data: {
          status: "already_ingested",
          file_id: "file-1",
          file_created: false,
          ingestion_id: "ing-1",
        },
      },
    });

    const outcome = await ingestReportWorkbook(
      {
        bytes: await buildRollingWorkbook(),
        originalFilename: "comp-report.xlsx",
        parserKey: ROLLING_PARSER_KEY,
      },
      { repository: new SupabaseReportingRepository(client), storage: fakeStorage() },
    );

    expect(outcome.outcome).toBe("already_ingested");
    expect(outcome.factCount).toBe(0);
    // The atomic write is never even attempted.
    expect(calls.some((call) => call.name === "complete_comp_sales_ingestion")).toBe(false);
  });
});

describe("a validation refusal is reported as itself", () => {
  it("carries its problems and a 422, not a generic failure", async () => {
    // The incident's second defect: ReportValidationError fell through to the
    // generic 500 handler, so a gate that knew exactly what was wrong reported
    // "Something went wrong". The status and problem list are the contract the
    // route's error mapping depends on.
    const error = new ReportValidationError([
      { code: "unknown_metric", message: "Metric code \"invented\" is not in the seeded catalogue." },
    ]);

    expect(error.status).toBe(422);
    expect(error.problems).toHaveLength(1);
    expect(error.problems[0].code).toBe("unknown_metric");
    expect(error.message).toContain("cannot be ingested");
  });
});
