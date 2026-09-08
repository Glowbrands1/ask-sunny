import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { bedUsageFixtureBytes } from "./__fixtures__/bed-usage-workbook";
import { spaEngagementFixtureBytes } from "./__fixtures__/spa-engagement-workbook";
import { spaWellnessFixtureBytes } from "./__fixtures__/spa-wellness-workbook";
import {
  BedSpaIntakeRejected,
  detectBedSpaReport,
  intakeBedSpaWorkbook,
} from "./bed-spa-intake";
import { sha256Hex } from "./ingest";
import {
  buildBedUsagePayload,
  buildSpaEngagementPayload,
  buildSpaWellnessPayload,
  SupabaseBedSpaRepository,
  windowParserKey,
} from "./repository/bed-spa-repository";
import type { ReportSourceStorage } from "./repository/source-storage";
import { parseBedUsage } from "./bed-usage/parser";
import { parseSpaEngagement } from "./spa-engagement/parser";
import { parseSpaWellness } from "./spa-wellness/parser";
import { readWorkbook } from "./workbook";
import {
  BED_FIXTURE_AUTHORIZED_COMPANY,
  BED_FIXTURE_OTHER_COMPANY,
} from "./__fixtures__/bed-usage-workbook";

/**
 * INTAKE FOR THE THREE NEW FAMILIES.
 *
 * The database is faked, deliberately: what these tests are about is the ORDER
 * of operations and what crosses the boundary. The transactional behaviour the
 * functions themselves guarantee is proved against a real PostgreSQL cluster in
 * `supabase/tests/bed_spa_schema_checks.sql`.
 *
 * The fixtures are scoped to an invented company, so the parsers are invoked
 * with an explicit company. Production calls take the default.
 */

/**
 * All three fixtures use the same invented company, so intake is scoped to it
 * through the DEPENDENCIES object rather than through any request field. See
 * `BedSpaIntakeDependencies.company`: production calls supply no company and
 * get the authorized one.
 */
const FIXTURE_COMPANY = "Meridian Leisure Group";

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

function fakeClient(
  responses: Partial<Record<string, { data?: unknown; error?: { message: string } }>>,
): { client: SupabaseClient; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  const client = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const scripted = responses[name];
      return Promise.resolve({ data: scripted?.data ?? null, error: scripted?.error ?? null });
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

function fakeStorage(
  options: { exists?: boolean } = {},
): ReportSourceStorage & { uploads: { path: string; bytes: number }[] } {
  const uploads: { path: string; bytes: number }[] = [];
  return {
    uploads,
    async upload(input) {
      uploads.push({ path: input.path, bytes: input.bytes.byteLength });
    },
    async exists() {
      return options.exists ?? false;
    },
  };
}

const BEGUN = {
  data: {
    status: "opened",
    file_id: "11111111-1111-1111-1111-111111111111",
    file_created: true,
    ingestion_id: "22222222-2222-2222-2222-222222222222",
  },
};

const COMPLETED = {
  data: {
    period_id: "33333333-3333-3333-3333-333333333333",
    salon_count: 3,
    fact_count: 11,
    superseded_facts: 0,
    unresolved_salons: [],
  },
};

describe("recognising which family a delivery is", () => {
  it("recognises a Bed Usage workbook and only that", async () => {
    const detections = await detectBedSpaReport(await bedUsageFixtureBytes());
    expect(detections.filter((entry) => entry.supported).map((entry) => entry.familyKey)).toEqual([
      "bed_usage",
    ]);
  });

  it("recognises a SPA Wellness workbook and only that", async () => {
    const detections = await detectBedSpaReport(await spaWellnessFixtureBytes());
    expect(detections.filter((entry) => entry.supported).map((entry) => entry.familyKey)).toEqual([
      "spa_wellness",
    ]);
  });

  it("recognises a Spa Engagement workbook and only that", async () => {
    const detections = await detectBedSpaReport(await spaEngagementFixtureBytes());
    expect(detections.filter((entry) => entry.supported).map((entry) => entry.familyKey)).toEqual([
      "spa_engagement",
    ]);
  });

  it("returns a verdict for every family, including the ones that declined", async () => {
    // A parser that cannot read this file is a fact worth reporting: it is how
    // drift in one family becomes visible while the others still load.
    const detections = await detectBedSpaReport(await bedUsageFixtureBytes());
    expect(detections).toHaveLength(3);
    for (const entry of detections.filter((candidate) => !candidate.supported)) {
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  it("refuses a workbook nothing recognises, writing nothing", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const other = new ExcelJS.Workbook();
    other.addWorksheet("Sheet1").getCell("A1").value = "Staff rota";
    const bytes = new Uint8Array((await other.xlsx.writeBuffer()) as ArrayBuffer);
    const { client, calls } = fakeClient({});
    const storage = fakeStorage();

    await expect(
      intakeBedSpaWorkbook(
        { bytes, originalFilename: "rota.xlsx" },
        { repository: new SupabaseBedSpaRepository(client), storage, company: FIXTURE_COMPANY },
      ),
    ).rejects.toBeInstanceOf(BedSpaIntakeRejected);

    expect(calls).toHaveLength(0);
    expect(storage.uploads).toHaveLength(0);
  });

  it("refuses bytes that are not a workbook at all as a REFUSAL, not an error", async () => {
    // A mail transport will eventually deliver a PDF or a truncated
    // attachment, and that is a 422 the sender can act on rather than a 500
    // that reads as our fault and gets retried forever.
    const bytes = new TextEncoder().encode("not a workbook");
    await expect(
      intakeBedSpaWorkbook(
        { bytes, originalFilename: "broken.xlsx" },
        { repository: new SupabaseBedSpaRepository(fakeClient({}).client), storage: fakeStorage() },
      ),
    ).rejects.toMatchObject({ code: "unreadable_workbook" });
  });

  it("prefers a drift verdict over an unrecognised one", async () => {
    // "Our mapping is out of date" is the more specific and more actionable
    // claim than "unknown file".
    const bytes = await bedUsageFixtureBytes({ dropColumn: "v Chain" });
    await expect(
      intakeBedSpaWorkbook(
        { bytes, originalFilename: "bed.xlsx" },
        { repository: new SupabaseBedSpaRepository(fakeClient({}).client), storage: fakeStorage() },
      ),
    ).rejects.toMatchObject({ code: "template_drift" });
  });
});

describe("the order of operations", () => {
  it("uploads once and then writes, in that order", async () => {
    const { client, calls } = fakeClient({
      begin_report_ingestion: BEGUN,
      complete_bed_usage_ingestion: COMPLETED,
    });
    const storage = fakeStorage();
    const bytes = await bedUsageFixtureBytes();

    const result = await intakeBedSpaWorkbook(
      { bytes, originalFilename: "bed usage.xlsx" },
      { repository: new SupabaseBedSpaRepository(client), storage, company: FIXTURE_COMPANY },
    );

    expect(result.familyKey).toBe("bed_usage");
    expect(result.sha256).toBe(sha256Hex(bytes));
    expect(storage.uploads).toHaveLength(1);
    expect(storage.uploads[0].path).toContain("bed_usage/mtd-2026-08-31/");
    expect(calls.map((call) => call.name)).toEqual([
      "begin_report_ingestion",
      "complete_bed_usage_ingestion",
    ]);
  });

  it("skips the upload when the same bytes are already stored", async () => {
    // The path carries the content digest, so "exists" means "these exact
    // bytes are already stored" — and a retrying pipeline re-delivering the
    // same report is the common case, not the rare one.
    const storage = fakeStorage({ exists: true });
    await intakeBedSpaWorkbook(
      { bytes: await bedUsageFixtureBytes(), originalFilename: "bed.xlsx" },
      {
        repository: new SupabaseBedSpaRepository(
          fakeClient({
            begin_report_ingestion: BEGUN,
            complete_bed_usage_ingestion: COMPLETED,
          }).client,
        ),
        storage,
        company: FIXTURE_COMPANY,
      },
    );
    expect(storage.uploads).toHaveLength(0);
  });

  it("uploads anyway when the store cannot answer", async () => {
    // An overwrite of identical bytes is harmless; a missing object is not.
    const uploads: string[] = [];
    await intakeBedSpaWorkbook(
      { bytes: await bedUsageFixtureBytes(), originalFilename: "bed.xlsx" },
      {
        repository: new SupabaseBedSpaRepository(
          fakeClient({
            begin_report_ingestion: BEGUN,
            complete_bed_usage_ingestion: COMPLETED,
          }).client,
        ),
        storage: {
          async upload(input) {
            uploads.push(input.path);
          },
          async exists() {
            throw new Error("storage unavailable");
          },
        },
        company: FIXTURE_COMPANY,
      },
    );
    expect(uploads).toHaveLength(1);
  });

  it("stores nothing when the parse fails after detection", async () => {
    /*
     * A file that cannot become rows is a failure recorded BEFORE its bytes are
     * stored, so a delivery whose parse fails leaves no object in the bucket.
     * The fixture detects as Bed Usage and then fails on two disagreeing
     * period markers.
     */
    const { client, calls } = fakeClient({});
    const storage = fakeStorage();
    const result = await intakeBedSpaWorkbook(
      {
        bytes: await bedUsageFixtureBytes({
          secondPeriodMarker: { start: "2026-07-01", end: "2026-07-31" },
        }),
        originalFilename: "bed.xlsx",
      },
      { repository: new SupabaseBedSpaRepository(client), storage, company: FIXTURE_COMPANY },
    );

    expect(result.attempts[0]).toMatchObject({
      status: "failed",
      failure: { code: "period_unreadable" },
    });
    expect(storage.uploads).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("records a rolled-back write as failed, with the attempt kept", async () => {
    const { client, calls } = fakeClient({
      begin_report_ingestion: BEGUN,
      complete_bed_usage_ingestion: { error: { message: "constraint violated (1234.56)" } },
      fail_report_ingestion: { data: {} },
    });
    const result = await intakeBedSpaWorkbook(
      { bytes: await bedUsageFixtureBytes(), originalFilename: "bed.xlsx" },
      { repository: new SupabaseBedSpaRepository(client), storage: fakeStorage(), company: FIXTURE_COMPANY },
    );

    expect(result.attempts[0].status).toBe("failed");
    expect(calls.map((call) => call.name)).toContain("fail_report_ingestion");
    // The recorded reason must not echo a value from the offending row.
    const reason = String(
      calls.find((call) => call.name === "fail_report_ingestion")!.args.p_reason,
    );
    expect(reason).not.toContain("1234.56");
  });

  it("reports a re-delivery as already ingested, writing nothing", async () => {
    const { client, calls } = fakeClient({
      begin_report_ingestion: {
        data: {
          status: "already_ingested",
          file_id: "11111111-1111-1111-1111-111111111111",
          file_created: false,
          ingestion_id: "22222222-2222-2222-2222-222222222222",
        },
      },
    });
    const result = await intakeBedSpaWorkbook(
      { bytes: await bedUsageFixtureBytes(), originalFilename: "bed.xlsx" },
      { repository: new SupabaseBedSpaRepository(client), storage: fakeStorage(), company: FIXTURE_COMPANY },
    );

    expect(result.attempts[0].status).toBe("already_ingested");
    expect(result.factsWritten).toBe(0);
    expect(calls.map((call) => call.name)).toEqual(["begin_report_ingestion"]);
  });

  it("records the file's digest and lineage on the file row", async () => {
    const { client, calls } = fakeClient({
      begin_report_ingestion: BEGUN,
      complete_bed_usage_ingestion: COMPLETED,
    });
    const bytes = await bedUsageFixtureBytes();
    await intakeBedSpaWorkbook(
      {
        bytes,
        originalFilename: "Bed Usage Report - All Salons.xlsx",
        externalMessageId: "MSG-INVENTED-9",
        senderEmail: "reports@example.invalid",
        receivedAt: "2026-09-01T06:15:00.000Z",
        inboundEmailId: "resend-invented-1",
      },
      { repository: new SupabaseBedSpaRepository(client), storage: fakeStorage(), company: FIXTURE_COMPANY },
    );
    const file = calls[0].args.p_file as Record<string, unknown>;
    expect(file.file_sha256).toBe(sha256Hex(bytes));
    expect(file.storage_bucket).toBe("reporting-sources");
    expect(file.original_filename).toBe("Bed Usage Report - All Salons.xlsx");
    expect(file.external_message_id).toBe("MSG-INVENTED-9");
    expect(file.sender_email).toBe("reports@example.invalid");
    expect(file.received_at).toBe("2026-09-01T06:15:00.000Z");
    expect(file.inbound_email_id).toBe("resend-invented-1");
  });
});

describe("SPA Wellness writes one attempt per window", () => {
  it("opens a separate attempt for each window, keyed by it", async () => {
    /*
     * The idempotency index is `(file_id, parser_key, parser_version) where
     * status = 'succeeded'`. Three windows under one key would make the second
     * and third look like duplicates of the first, and only one window would
     * ever load.
     */
    const { client, calls } = fakeClient({
      begin_report_ingestion: BEGUN,
      complete_spa_wellness_ingestion: COMPLETED,
    });
    const result = await intakeBedSpaWorkbook(
      {
        bytes: await spaWellnessFixtureBytes({ sheets: ["MTD", "YTD", "LTM"] }),
        originalFilename: "spa wellness.xlsx",
      },
      { repository: new SupabaseBedSpaRepository(client), storage: fakeStorage(), company: FIXTURE_COMPANY },
    );

    expect(result.attempts).toHaveLength(3);
    const keys = calls
      .filter((call) => call.name === "begin_report_ingestion")
      .map((call) => call.args.p_parser_key);
    expect(keys).toEqual([
      windowParserKey("spa_wellness_tracking", "mtd"),
      windowParserKey("spa_wellness_tracking", "ytd"),
      windowParserKey("spa_wellness_tracking", "ltm"),
    ]);
    expect(new Set(keys).size).toBe(3);
  });

  it("names each window's own sheet on its attempt", async () => {
    const { client, calls } = fakeClient({
      begin_report_ingestion: BEGUN,
      complete_spa_wellness_ingestion: COMPLETED,
    });
    await intakeBedSpaWorkbook(
      {
        bytes: await spaWellnessFixtureBytes({ sheets: ["MTD", "YTD"] }),
        originalFilename: "spa.xlsx",
      },
      { repository: new SupabaseBedSpaRepository(client), storage: fakeStorage(), company: FIXTURE_COMPANY },
    );
    const sheets = calls
      .filter((call) => call.name === "begin_report_ingestion")
      .map((call) => call.args.p_sheet_names);
    expect(sheets).toEqual([["MTD"], ["YTD"]]);
  });
});

describe("what crosses the boundary", () => {
  it("sends no other company's salon in a Bed Usage payload", async () => {
    const report = parseBedUsage(await readWorkbook(await bedUsageFixtureBytes()), {
      company: BED_FIXTURE_AUTHORIZED_COMPANY,
    });
    const payload = JSON.stringify(buildBedUsagePayload(report));
    expect(payload).not.toContain(BED_FIXTURE_OTHER_COMPANY);
    expect(payload).not.toContain("Dunmore Cross");
  });

  it("sends the chain benchmark as an average with no salon attached", async () => {
    const report = parseBedUsage(await readWorkbook(await bedUsageFixtureBytes()), {
      company: BED_FIXTURE_AUTHORIZED_COMPANY,
    });
    const payload = buildBedUsagePayload(report);
    for (const benchmark of payload.benchmarks) {
      expect(Object.keys(benchmark).sort()).toEqual(
        ["level", "share_of_chain_tans", "tans_per_bed", "total_beds"].sort(),
      );
    }
  });

  it("sends only salon number, name and open date from the roster", async () => {
    /*
     * The roster sheet also carries street addresses, two phone numbers and two
     * e-mail addresses per salon. This application has no use for any of them
     * and should not hold them.
     */
    const report = parseSpaEngagement(await readWorkbook(await spaEngagementFixtureBytes()), { company: FIXTURE_COMPANY });
    const payload = buildSpaEngagementPayload(report);
    for (const entry of payload.roster) {
      expect(Object.keys(entry).sort()).toEqual(["opened_at", "salon_number", "store_name"]);
    }
  });

  it("attaches each equipment type's dates to its use row", async () => {
    const bytes = await spaWellnessFixtureBytes({ sheets: ["MTD"] });
    const report = parseSpaWellness(await readWorkbook(bytes), { company: FIXTURE_COMPANY });
    const payload = buildSpaWellnessPayload(report, report.windows[0]);
    const hydro = payload.equipment_use.find(
      (use) => use.store_name === "Aurora Springs" && use.equipment_code === "spa_hydromassage",
    )!;
    expect(hydro.first_use_date).toBe("2024-02-20");
    expect(hydro.last_use_date).toBe("2026-08-31");
  });

  it("sends no zero-session row in a SPA Wellness payload", async () => {
    // The rule, at the boundary as well as in the parser and the schema.
    const bytes = await spaWellnessFixtureBytes({ sheets: ["MTD"] });
    const report = parseSpaWellness(await readWorkbook(bytes), { company: FIXTURE_COMPANY });
    const payload = buildSpaWellnessPayload(report, report.windows[0]);
    for (const use of payload.equipment_use) {
      expect(use.sessions).toBeGreaterThan(0);
    }
  });

  it("sends the ranking population and the weights it was computed with", async () => {
    const report = parseSpaEngagement(await readWorkbook(await spaEngagementFixtureBytes()), { company: FIXTURE_COMPANY });
    const payload = buildSpaEngagementPayload(report);
    expect(payload.rank_population).toBe(5);
    expect(payload.rank_weights).toEqual({
      rank_spa_sessions_per_bed: 0.25,
      rank_spa_sessions_per_unique_per_bed: 0.25,
      rank_unique_spa_tanner_pct: 0.5,
    });
  });

  it("carries warning text and no figures", async () => {
    const { client } = fakeClient({
      begin_report_ingestion: BEGUN,
      complete_bed_usage_ingestion: COMPLETED,
    });
    const result = await intakeBedSpaWorkbook(
      {
        bytes: await bedUsageFixtureBytes({ dropColumn: "Ratio" }),
        originalFilename: "bed.xlsx",
      },
      { repository: new SupabaseBedSpaRepository(client), storage: fakeStorage(), company: FIXTURE_COMPANY },
    );
    expect(result.warnings.length).toBeGreaterThan(0);
    for (const warning of result.warnings) {
      // No currency- or volume-shaped figure in a message that reaches a log.
      expect(warning).not.toMatch(/\d{4,}/);
    }
  });

  it("surfaces unresolved salon names on the result", async () => {
    const { client } = fakeClient({
      begin_report_ingestion: BEGUN,
      complete_bed_usage_ingestion: {
        data: { ...COMPLETED.data, unresolved_salons: ["A Salon Nobody Knows"] },
      },
    });
    const result = await intakeBedSpaWorkbook(
      { bytes: await bedUsageFixtureBytes(), originalFilename: "bed.xlsx" },
      { repository: new SupabaseBedSpaRepository(client), storage: fakeStorage(), company: FIXTURE_COMPANY },
    );
    // Reported, never silently discarded.
    expect(result.unresolvedSalons).toEqual(["A Salon Nobody Knows"]);
  });

  it("never returns a storage bucket or object key to the caller", async () => {
    // An automated caller has no use for them, and printing them is a step
    // towards fetching a private object.
    const { client } = fakeClient({
      begin_report_ingestion: BEGUN,
      complete_bed_usage_ingestion: COMPLETED,
    });
    const result = await intakeBedSpaWorkbook(
      { bytes: await bedUsageFixtureBytes(), originalFilename: "bed.xlsx" },
      { repository: new SupabaseBedSpaRepository(client), storage: fakeStorage(), company: FIXTURE_COMPANY },
    );
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("reporting-sources");
    expect(serialised).not.toContain("bed_usage/mtd-");
  });
});

describe("the three families reach three different functions", () => {
  it("routes each to its own write", async () => {
    for (const [bytes, fn] of [
      [await bedUsageFixtureBytes(), "complete_bed_usage_ingestion"],
      [await spaWellnessFixtureBytes({ sheets: ["MTD"] }), "complete_spa_wellness_ingestion"],
      [await spaEngagementFixtureBytes(), "complete_spa_engagement_ingestion"],
    ] as const) {
      const { client, calls } = fakeClient({
        begin_report_ingestion: BEGUN,
        [fn]: COMPLETED,
      });
      await intakeBedSpaWorkbook(
        { bytes, originalFilename: "report.xlsx" },
        {
          repository: new SupabaseBedSpaRepository(client),
          storage: fakeStorage(),
          company: FIXTURE_COMPANY,
        },
      );
      expect(calls.map((call) => call.name)).toContain(fn);
    }
  });

  it("files each family's object under its own storage prefix", async () => {
    const seen: string[] = [];
    for (const [bytes, prefix] of [
      [await bedUsageFixtureBytes(), "bed_usage/"],
      [await spaWellnessFixtureBytes({ sheets: ["MTD"] }), "spa_wellness/"],
      [await spaEngagementFixtureBytes(), "spa_engagement/"],
    ] as const) {
      const storage = fakeStorage();
      await intakeBedSpaWorkbook(
        { bytes, originalFilename: "report.xlsx" },
        {
          repository: new SupabaseBedSpaRepository(
            fakeClient({
              begin_report_ingestion: BEGUN,
              complete_bed_usage_ingestion: COMPLETED,
              complete_spa_wellness_ingestion: COMPLETED,
              complete_spa_engagement_ingestion: COMPLETED,
            }).client,
          ),
          storage,
          company: FIXTURE_COMPANY,
        },
      );
      expect(storage.uploads[0].path.startsWith(prefix), prefix).toBe(true);
      seen.push(storage.uploads[0].path);
    }
    expect(new Set(seen).size).toBe(3);
  });
});
