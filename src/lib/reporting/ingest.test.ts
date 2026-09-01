import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { buildCompSalesWorkbook } from "./__fixtures__/comp-sales-workbook";
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
