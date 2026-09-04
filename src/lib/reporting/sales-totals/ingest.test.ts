import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { salesTotalsFixtureBytes } from "../__fixtures__/sales-totals-report";
import { readHtmlReport } from "../html-report";
import type { SourceFileRecord } from "../repository/types";
import { ingestSalesTotalsReport, SALES_TOTALS_SOURCE_CODE } from "./ingest";
import { parseSalesTotals, SALES_TOTALS_PARSER_KEY } from "./parser";

/**
 * ============================================================================
 * THE CONTRACT WITH THE DATABASE.
 * ============================================================================
 *
 * Two things are asserted, and they are different in kind:
 *
 *   WHAT THIS MODULE SENDS — the RPC names, the argument names, the ordering of
 *   the calls. A fake client records them, so a rename on either side of the
 *   boundary fails a test rather than failing at runtime in production.
 *
 *   WHAT THE DATABASE PROMISES — asserted against the migration SQL itself,
 *   because no fake can prove a transaction. The guarantees this path depends
 *   on are that `begin_report_ingestion` recognises identical bytes and that
 *   `ingest_sales_totals` supersedes only its own report date.
 */

const MIGRATIONS = "supabase/migrations";
const sql = [
  "20260903002000_sales_totals.sql",
  "20260903002100_sales_totals_ingest.sql",
  "20260831001500_reporting_core.sql",
]
  .map((name) => {
    try {
      return readFileSync(`${MIGRATIONS}/${name}`, "utf8");
    } catch {
      return "";
    }
  })
  .join("\n");

const report = parseSalesTotals(
  readHtmlReport(salesTotalsFixtureBytes({ reportDate: "09-03-2026" })),
);

const file: SourceFileRecord = {
  storageBucket: "reporting-sources",
  storagePath: "sales_totals/daily-2026-09-03/abcdef0123456789/SalesTotals.xls",
  originalFilename: "SalesTotals.xls",
  mimeType: "text/html",
  sizeBytes: 19693,
  sha256: "a".repeat(64),
  externalMessageId: "<upstream@suntancity.test>",
  externalArchiveUrl: null,
  senderEmail: "reports@suntancity.com",
  receivedAt: "2026-09-04T11:02:00.000Z",
  inboundEmailId: "email_st_1",
};

/** Records every RPC call and answers with whatever the test lines up. */
function fakeClient(answers: Record<string, { data?: unknown; error?: { message: string } | null }>) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return answers[name] ?? { data: null, error: null };
    }),
  };
  return { client: client as never, calls };
}

const OPENED = {
  data: { status: "opened", file_id: "file-1", file_created: true, ingestion_id: "ing-1" },
  error: null,
};

describe("what this module sends to the database", () => {
  it("opens the ingestion through the SAME layer the Comp Report uses", async () => {
    const { client, calls } = fakeClient({
      begin_report_ingestion: OPENED,
      ingest_sales_totals: {
        data: {
          snapshot_id: "snap-1",
          facts_written: 216,
          facts_superseded: 0,
          superseded_snapshot_id: null,
          unresolved_salons: [],
        },
        error: null,
      },
    });

    const result = await ingestSalesTotalsReport({ report, file }, { client });

    expect(calls.map((call) => call.name)).toEqual([
      "begin_report_ingestion",
      "ingest_sales_totals",
    ]);
    expect(result.outcome).toBe("succeeded");
    expect(result.snapshotId).toBe("snap-1");
    expect(result.factsWritten).toBe(216);

    const begin = calls[0].args;
    // Its own source row, so lineage never confuses the two reports.
    expect(begin.p_source_code).toBe(SALES_TOTALS_SOURCE_CODE);
    expect(begin.p_parser_key).toBe(SALES_TOTALS_PARSER_KEY);
    expect(begin.p_parser_version).toBe(report.parserVersion);
    // The digest is part of the ingestion's identity — this is where replay
    // protection comes from, rather than from anything in this module.
    expect(begin.p_fingerprint).toBeTypeOf("string");
    expect((begin.p_file as Record<string, unknown>).file_sha256).toBe(file.sha256);
    expect((begin.p_file as Record<string, unknown>).sender_email).toBe(
      "reports@suntancity.com",
    );
  });

  it("sends the report date, its raw form, the counts and the facts", async () => {
    const { client, calls } = fakeClient({
      begin_report_ingestion: OPENED,
      ingest_sales_totals: {
        data: {
          snapshot_id: "snap-1",
          facts_written: 1,
          facts_superseded: 0,
          superseded_snapshot_id: null,
          unresolved_salons: null,
        },
        error: null,
      },
    });

    await ingestSalesTotalsReport({ report, file }, { client });

    const args = calls[1].args;
    expect(args.p_ingestion_id).toBe("ing-1");
    expect(args.p_report_date).toBe("2026-09-03");
    // Kept verbatim so a disputed figure can be traced to what the report said.
    expect(args.p_report_date_raw).toBe("09-03-2026");
    expect(args.p_summary_row_count).toBe(report.diagnostics.summaryRowCount);
    expect(args.p_salon_row_count).toBe(report.diagnostics.salonRowCount);
    expect(args.p_value_count).toBe(report.diagnostics.valueCount);
    expect(Array.isArray(args.p_facts)).toBe(true);
    expect((args.p_facts as unknown[]).length).toBeGreaterThan(0);
  });

  it("does not write when the bytes were already ingested", async () => {
    const { client, calls } = fakeClient({
      begin_report_ingestion: {
        data: {
          status: "already_ingested",
          file_id: "file-1",
          file_created: false,
          ingestion_id: "ing-earlier",
        },
        error: null,
      },
    });

    const result = await ingestSalesTotalsReport({ report, file }, { client });

    // THE REPLAY GUARANTEE. The transaction is never even reached.
    expect(calls.map((call) => call.name)).toEqual(["begin_report_ingestion"]);
    expect(result.outcome).toBe("already_ingested");
    expect(result.factsWritten).toBe(0);
    expect(result.snapshotId).toBeNull();
    expect(result.ingestionId).toBe("ing-earlier");
  });

  it("records WHY a rolled-back write failed, without leaking the row", async () => {
    const { client, calls } = fakeClient({
      begin_report_ingestion: OPENED,
      ingest_sales_totals: {
        error: {
          message:
            'duplicate key value violates unique constraint "x" DETAIL: Key (value)=(123456.78) already exists.',
        },
      },
    });

    const result = await ingestSalesTotalsReport({ report, file }, { client });

    expect(calls.map((call) => call.name)).toEqual([
      "begin_report_ingestion",
      "ingest_sales_totals",
      "fail_report_ingestion",
    ]);
    expect(result.outcome).toBe("failed");
    /*
     * A raw Postgres message quotes the offending row, and that row holds salon
     * financials. `safeFailureReason` is what keeps the figure out of a stored
     * failure reason and out of the response.
     */
    expect(result.failureReason).not.toContain("123456.78");
  });

  it("reports unresolved salon names rather than inventing salons", async () => {
    const { client } = fakeClient({
      begin_report_ingestion: OPENED,
      ingest_sales_totals: {
        data: {
          snapshot_id: "snap-1",
          facts_written: 100,
          facts_superseded: 0,
          superseded_snapshot_id: null,
          unresolved_salons: ["NE Somewhere New"],
        },
        error: null,
      },
    });

    const result = await ingestSalesTotalsReport({ report, file }, { client });
    // This report carries no salon number, so an unknown name cannot become a
    // salon without fabricating an identifier. A reported gap beats a guess.
    expect(result.unresolvedSalons).toEqual(["NE Somewhere New"]);
  });
});

describe("what the database promises, asserted against the migration", () => {
  it("has a source row for this report, separate from the Comp Report's", () => {
    expect(sql).toContain("'sales_totals_email'");
    expect(sql).toMatch(/insert into public\.report_sources/);
  });

  it("supersedes only the SAME report date", () => {
    /*
     * The guarantee the daily snapshot model rests on: a corrected report
     * replaces its own day, and a report for another day replaces nothing — so
     * backfilling an older day cannot displace a newer one.
     */
    expect(sql).toMatch(/where report_date = p_report_date\s+and superseded_by_ingestion_id is null/);
  });

  it("resolves salon rows by exact store name only", () => {
    expect(sql).toMatch(/on i\.scope_kind = 'salon'\s+and sa\.store_name = i\.store_name/);
  });

  it("keeps the transaction's write revoked from the browser-held roles", () => {
    expect(sql).toMatch(
      /revoke all on function public\.ingest_sales_totals\([^)]*\) from anon, authenticated/,
    );
  });
});
