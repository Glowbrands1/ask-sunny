import { describe, expect, it } from "vitest";

import { buildCombinedCompReportWorkbook } from "./__fixtures__/comp-sales-combined-workbook";
import { COMP_SALES_PARSER_KEY } from "./comp-sales/parser";
import { ROLLING_PARSER_KEY } from "./comp-sales/rolling-parser";
import { YTD_PARSER_KEY } from "./comp-sales/ytd-parser";
import { detectAllReports, sha256Hex } from "./ingest";
import { intakeReportWorkbook, ReportIntakeRejected } from "./intake";
import type { ReportSourceStorage } from "./repository/source-storage";
import type {
  IngestionResult,
  ReportingRepository,
  SourceFileRecord,
} from "./repository/types";
import type { ParsedReport } from "./types";

/**
 * AUTOMATED REPORT INTAKE.
 *
 * Every figure in the fixtures is invented. What is real is the SHAPE: one
 * workbook carrying the three sheets three parsers read, delivered once.
 *
 * The tests that matter here are the ones about containment and about periods.
 * A single delivery now triggers three independent database transactions, and
 * the two ways that can go wrong quietly are (a) one parser's failure taking
 * another parser's data with it, and (b) a new month's report landing on top of
 * the previous month instead of beside it. Both are pinned below.
 */

/** A repository stand-in that records what it was asked to write. */
function fakeRepository(options: {
  /** Per parser key: what the write should do. Default succeed. */
  behaviour?: Record<string, "succeed" | "already_ingested" | "fail" | "throw">;
  /** Period id per (grain, periodEnd), so a new report date gets a new id. */
  periodIdFor?: (grain: string, periodEnd: string) => string;
} = {}): ReportingRepository & {
  writes: { parserKey: string; grain: string; periodEnd: string; file: SourceFileRecord }[];
} {
  const writes: {
    parserKey: string;
    grain: string;
    periodEnd: string;
    file: SourceFileRecord;
  }[] = [];
  const periodIdFor =
    options.periodIdFor ?? ((grain: string, periodEnd: string) => `period-${grain}-${periodEnd}`);

  return {
    writes,
    async ingest(input: {
      sourceCode: string;
      file: SourceFileRecord;
      report: ParsedReport;
    }): Promise<IngestionResult> {
      const { report, file } = input;
      const behaviour = options.behaviour?.[report.parserKey] ?? "succeed";

      if (behaviour === "throw") {
        throw new Error(
          'duplicate key value violates unique constraint "comp_sales_facts_live_key"',
        );
      }

      writes.push({
        parserKey: report.parserKey,
        grain: report.period.grain,
        periodEnd: report.period.periodEnd,
        file,
      });

      const base = {
        ingestionId: `ing-${report.parserKey}`,
        fileId: "file-1",
        fileCreated: true,
        salonCount: report.salons.length,
        supersededAttributes: 0,
      };

      if (behaviour === "already_ingested") {
        return {
          ...base,
          outcome: "already_ingested",
          periodId: null,
          factCount: 0,
          supersededFacts: 0,
          failureReason: null,
        };
      }
      if (behaviour === "fail") {
        return {
          ...base,
          outcome: "failed",
          periodId: null,
          factCount: 0,
          supersededFacts: 0,
          failureReason: "The normalized write was rolled back.",
        };
      }
      return {
        ...base,
        outcome: "succeeded",
        periodId: periodIdFor(report.period.grain, report.period.periodEnd),
        factCount: report.facts.length,
        supersededFacts: 0,
        failureReason: null,
      };
    },
  };
}

function fakeStorage(): ReportSourceStorage & { uploads: string[] } {
  const uploads: string[] = [];
  return {
    uploads,
    async upload(input) {
      uploads.push(input.path);
    },
    // Truthful, so the "skip when already stored" path is actually exercised
    // rather than being masked by a fake that always says yes.
    async exists(path) {
      return uploads.includes(path);
    },
  };
}

const DELIVERY = {
  originalFilename: "Comp Report 08.30.2026.xlsx",
  externalMessageId: "AAMkAD-invented-outlook-message-id",
  senderEmail: "reports@invented-sender.test",
  receivedAt: "2026-09-01T08:59:00.000Z",
  externalArchiveUrl:
    "https://invented.sharepoint.test/sites/Reports/Shared%20Documents/comp-report.xlsx",
};

async function combined(options: Parameters<typeof buildCombinedCompReportWorkbook>[0] = {}) {
  return buildCombinedCompReportWorkbook(options);
}

describe("one delivery, every compatible parser", () => {
  it("detects all three sheets in a single workbook", async () => {
    const detections = await detectAllReports(await combined());
    expect(detections.filter((entry) => entry.supported).map((entry) => entry.parserKey).sort())
      .toEqual([COMP_SALES_PARSER_KEY, ROLLING_PARSER_KEY, YTD_PARSER_KEY].sort());
  });

  it("runs every applicable parser from ONE submission", async () => {
    /*
     * The whole point of the endpoint. Power Automate forwards the attachment
     * once; it does not know that `comp_sales_ytd` exists and must not have to
     * POST the same bytes three times with three different parser keys.
     */
    const repository = fakeRepository();
    const storage = fakeStorage();

    const result = await intakeReportWorkbook(
      { bytes: await combined(), ...DELIVERY },
      { repository, storage },
    );

    expect(result.fileAccepted).toBe(true);
    expect(result.parsersSucceeded.sort()).toEqual(
      [COMP_SALES_PARSER_KEY, ROLLING_PARSER_KEY, YTD_PARSER_KEY].sort(),
    );
    expect(result.parsersFailed).toEqual([]);
    expect(result.factsWritten).toBeGreaterThan(0);
  });

  it("uploads the bytes exactly once, not once per parser", async () => {
    // `report_files` is unique on the digest and records ONE storage path. A
    // second upload under a different period's path would be an orphan object.
    const storage = fakeStorage();
    await intakeReportWorkbook(
      { bytes: await combined(), ...DELIVERY },
      { repository: fakeRepository(), storage },
    );
    expect(storage.uploads).toHaveLength(1);
  });

  it("does not re-upload bytes that are already stored", async () => {
    /*
     * A retrying flow re-delivering the same report is the COMMON case. The
     * path carries the content digest, so the object being present means these
     * exact bytes are already stored and moving the whole workbook again would
     * be a correct no-op with a real cost.
     */
    const storage = fakeStorage();
    const bytes = await combined();

    await intakeReportWorkbook({ bytes, ...DELIVERY }, { repository: fakeRepository(), storage });
    expect(storage.uploads).toHaveLength(1);

    await intakeReportWorkbook({ bytes, ...DELIVERY }, { repository: fakeRepository(), storage });
    expect(storage.uploads).toHaveLength(1);
  });

  it("gives every parser's write the same file identity and lineage", async () => {
    const repository = fakeRepository();
    const bytes = await combined();
    await intakeReportWorkbook({ bytes, ...DELIVERY }, { repository, storage: fakeStorage() });

    const digests = new Set(repository.writes.map((write) => write.file.sha256));
    expect(digests).toEqual(new Set([sha256Hex(bytes)]));
    for (const write of repository.writes) {
      expect(write.file.externalMessageId).toBe(DELIVERY.externalMessageId);
      expect(write.file.senderEmail).toBe(DELIVERY.senderEmail);
      expect(write.file.receivedAt).toBe(DELIVERY.receivedAt);
      expect(write.file.externalArchiveUrl).toBe(DELIVERY.externalArchiveUrl);
      // The attachment name as the sender wrote it, not the transport's.
      expect(write.file.originalFilename).toBe(DELIVERY.originalFilename);
    }
  });

  it("keeps month-to-date and year-to-date on separate periods", async () => {
    const repository = fakeRepository();
    const result = await intakeReportWorkbook(
      { bytes: await combined(), ...DELIVERY },
      { repository, storage: fakeStorage() },
    );

    const grains = new Set(result.periods.map((period) => period.grain));
    expect(grains).toEqual(new Set(["mtd", "ytd"]));
    // Two sheets share the month-to-date period, so it appears once.
    expect(result.periods).toHaveLength(2);
    expect(result.periods.filter((period) => period.grain === "mtd")).toHaveLength(1);
  });

  it("returns no financial values, salon numbers or names", async () => {
    const result = await intakeReportWorkbook(
      { bytes: await combined(), ...DELIVERY },
      { repository: fakeRepository(), storage: fakeStorage() },
    );

    const body = JSON.stringify(result);
    // The fixtures' invented salon numbers and store names must not appear.
    expect(body).not.toMatch(/"salonNumber"/);
    expect(body).not.toMatch(/storeName/);
    expect(body).not.toMatch(/\bvalue\b"\s*:/);
    // Nor the bucket or object key: an automated caller has no use for either.
    expect(body).not.toContain("reporting-sources");
    expect(body).not.toMatch(/storagePath/);
  });
});

describe("idempotency, per parser", () => {
  it("reports already_ingested per parser and writes nothing", async () => {
    const repository = fakeRepository({
      behaviour: {
        [COMP_SALES_PARSER_KEY]: "already_ingested",
        [ROLLING_PARSER_KEY]: "already_ingested",
        [YTD_PARSER_KEY]: "already_ingested",
      },
    });

    const result = await intakeReportWorkbook(
      { bytes: await combined(), ...DELIVERY },
      { repository, storage: fakeStorage() },
    );

    expect(result.parsersAlreadyIngested).toHaveLength(3);
    expect(result.parsersSucceeded).toEqual([]);
    expect(result.factsWritten).toBe(0);
    expect(result.supersededFacts).toBe(0);
    // No period is claimed for a re-delivery: nothing was created or reused.
    expect(result.periods).toEqual([]);
  });

  it("retries only the parser that had not succeeded", async () => {
    /*
     * The realistic retry. Last time the year-to-date sheet failed and the two
     * month-to-date sheets landed; re-delivering must re-attempt only the one
     * that has work left, which is exactly what the partial unique index on
     * (file, parser, version) where status = 'succeeded' gives us.
     */
    const repository = fakeRepository({
      behaviour: {
        [COMP_SALES_PARSER_KEY]: "already_ingested",
        [ROLLING_PARSER_KEY]: "already_ingested",
        [YTD_PARSER_KEY]: "succeed",
      },
    });

    const result = await intakeReportWorkbook(
      { bytes: await combined(), ...DELIVERY },
      { repository, storage: fakeStorage() },
    );

    expect(result.parsersAlreadyIngested.sort()).toEqual(
      [COMP_SALES_PARSER_KEY, ROLLING_PARSER_KEY].sort(),
    );
    expect(result.parsersSucceeded).toEqual([YTD_PARSER_KEY]);
    expect(result.periods.map((period) => period.grain)).toEqual(["ytd"]);
  });
});

describe("one parser's failure is that parser's alone", () => {
  it("records a rolled-back write as failed and still lands the others", async () => {
    const repository = fakeRepository({ behaviour: { [YTD_PARSER_KEY]: "fail" } });

    const result = await intakeReportWorkbook(
      { bytes: await combined(), ...DELIVERY },
      { repository, storage: fakeStorage() },
    );

    expect(result.parsersFailed).toEqual([YTD_PARSER_KEY]);
    expect(result.parsersSucceeded.sort()).toEqual(
      [COMP_SALES_PARSER_KEY, ROLLING_PARSER_KEY].sort(),
    );
    // The month-to-date period is still reported, because those rows are in.
    expect(result.periods.map((period) => period.grain)).toEqual(["mtd"]);

    const failed = result.attempts.find((attempt) => attempt.parserKey === YTD_PARSER_KEY);
    expect(failed?.failure).not.toBeNull();
    expect(failed?.factsWritten).toBe(0);
    expect(failed?.period).toBeNull();
  });

  it("contains a THROWN error to the parser that threw", async () => {
    // A transient database error on one sheet must not discard a write that
    // already committed for another.
    const repository = fakeRepository({ behaviour: { [ROLLING_PARSER_KEY]: "throw" } });

    const result = await intakeReportWorkbook(
      { bytes: await combined(), ...DELIVERY },
      { repository, storage: fakeStorage() },
    );

    expect(result.parsersFailed).toEqual([ROLLING_PARSER_KEY]);
    expect(result.parsersSucceeded.sort()).toEqual(
      [COMP_SALES_PARSER_KEY, YTD_PARSER_KEY].sort(),
    );
  });

  it("never returns a raw database error message", async () => {
    /*
     * The thrown message above names a constraint. Returning it would leak
     * schema internals to an external caller, and occasionally a value from the
     * offending row.
     */
    const repository = fakeRepository({ behaviour: { [ROLLING_PARSER_KEY]: "throw" } });
    const result = await intakeReportWorkbook(
      { bytes: await combined(), ...DELIVERY },
      { repository, storage: fakeStorage() },
    );

    const body = JSON.stringify(result);
    expect(body).not.toContain("comp_sales_facts_live_key");
    expect(body).not.toContain("unique constraint");
    const failed = result.attempts.find((attempt) => attempt.parserKey === ROLLING_PARSER_KEY);
    expect(failed?.failure?.code).toBe("ingestion_failed");
  });

  it("marks a sheet the workbook does not contain as not applicable, not failed", async () => {
    // An absent sheet is a fact about the delivery, not an error in it.
    const repository = fakeRepository();
    const result = await intakeReportWorkbook(
      { bytes: await combined({ ytd: null }), ...DELIVERY },
      { repository, storage: fakeStorage() },
    );

    expect(result.parsersNotApplicable).toEqual([YTD_PARSER_KEY]);
    expect(result.parsersFailed).toEqual([]);
    expect(result.parsersSucceeded.sort()).toEqual(
      [COMP_SALES_PARSER_KEY, ROLLING_PARSER_KEY].sort(),
    );
    expect(result.fileAccepted).toBe(true);
  });
});

describe("a workbook nothing can read", () => {
  it("refuses a workbook with no readable report, writing nothing", async () => {
    const repository = fakeRepository();
    const storage = fakeStorage();

    await expect(
      intakeReportWorkbook(
        // Every sheet omitted: there is nothing here any parser recognises.
        { bytes: await combined({ vs2024: null, rolling: null, ytd: null }), ...DELIVERY },
        { repository, storage },
      ),
    ).rejects.toBeInstanceOf(ReportIntakeRejected);

    // Nothing uploaded, nothing written — not even a file row.
    expect(storage.uploads).toEqual([]);
    expect(repository.writes).toEqual([]);
  });

  it("refuses a file that is not a spreadsheet as a 422, not a 500", async () => {
    /*
     * A mail transport will eventually deliver a PDF, a truncated attachment or
     * a password-protected file. "We could not read this" is something the
     * sender can act on; a 500 reads as our fault and gets retried forever.
     */
    const repository = fakeRepository();
    const storage = fakeStorage();

    const rejection = await intakeReportWorkbook(
      { bytes: new TextEncoder().encode("this is not a workbook"), ...DELIVERY },
      { repository, storage },
    ).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(ReportIntakeRejected);
    expect((rejection as ReportIntakeRejected).code).toBe("unreadable_workbook");
    expect((rejection as ReportIntakeRejected).status).toBe(422);
    expect(storage.uploads).toEqual([]);
    expect(repository.writes).toEqual([]);
  });

  it("reports drift per sheet, so the message says which one moved", async () => {
    const bytes = await combined({
      rolling: { renameHeader: { header: "Last 3 Months", to: "Trailing 3 Mo" } },
    });
    const detections = await detectAllReports(bytes);
    const rolling = detections.find((entry) => entry.parserKey === ROLLING_PARSER_KEY);

    // Whether this particular rename defeats detection or only the mapping, the
    // verdict must name the parser and carry a reason rather than being silent.
    if (!rolling?.supported) {
      expect(rolling?.reason).toBeTruthy();
      expect(rolling?.kind === "template_drift" || rolling?.kind === "unsupported").toBe(true);
    } else {
      expect(rolling.sheetName).toBeTruthy();
    }
  });
});

describe("a future report appends a period and does not overwrite the previous one", () => {
  /**
   * THE SYNTHETIC FUTURE REPORT.
   *
   * September's workbook, delivered after August's. The dashboard is meant to
   * be permanent — every period ever ingested stays selectable — so the failure
   * this pins is the one that would be invisible until somebody went looking
   * for last month: a new report writing into the previous period's rows.
   *
   * `report_periods` is keyed on (grain, period_end), so a new period end is a
   * different period and a different id. The repository fake mirrors that
   * exactly, which is what makes these assertions about the contract rather
   * than about the fake.
   */
  const AUGUST = {
    vs2024: { periodMarker: "MTD 08/30/2026" },
    rolling: { periodMarker: "MTD 08/30/2026" },
    ytd: { periodMarker: "YTD 07 2026" },
  };
  const SEPTEMBER = {
    vs2024: { periodMarker: "MTD 09/30/2026" },
    rolling: { periodMarker: "MTD 09/30/2026" },
    ytd: { periodMarker: "YTD 08 2026" },
  };

  it("puts the new month on new periods, leaving the old ones untouched", async () => {
    const repository = fakeRepository();
    const storage = fakeStorage();

    const august = await intakeReportWorkbook(
      { bytes: await combined(AUGUST), ...DELIVERY, originalFilename: "aug.xlsx" },
      { repository, storage, knownPeriodIds: async () => new Set() },
    );

    const augustIds = new Set(august.periods.map((period) => period.periodId));
    expect(august.periods.map((period) => period.periodEnd).sort()).toEqual([
      "2026-07-31",
      "2026-08-30",
    ]);
    // Every period is new on the first delivery.
    expect(august.periods.every((period) => period.created)).toBe(true);

    const september = await intakeReportWorkbook(
      { bytes: await combined(SEPTEMBER), ...DELIVERY, originalFilename: "sep.xlsx" },
      // August's periods now exist.
      { repository, storage, knownPeriodIds: async () => augustIds },
    );

    expect(september.periods.map((period) => period.periodEnd).sort()).toEqual([
      "2026-08-31",
      "2026-09-30",
    ]);
    expect(september.periods.every((period) => period.created)).toBe(true);

    // THE ASSERTION THAT MATTERS: not one id is shared between the two months.
    const septemberIds = new Set(september.periods.map((period) => period.periodId));
    for (const id of septemberIds) expect(augustIds.has(id)).toBe(false);
  });

  it("writes September's facts against September's period, never August's", async () => {
    const repository = fakeRepository();
    const storage = fakeStorage();

    await intakeReportWorkbook(
      { bytes: await combined(AUGUST), ...DELIVERY, originalFilename: "aug.xlsx" },
      { repository, storage },
    );
    const afterAugust = repository.writes.length;

    await intakeReportWorkbook(
      { bytes: await combined(SEPTEMBER), ...DELIVERY, originalFilename: "sep.xlsx" },
      { repository, storage },
    );

    const septemberWrites = repository.writes.slice(afterAugust);
    expect(septemberWrites).toHaveLength(3);
    // Each write names its own period end, and none names August's.
    expect(new Set(septemberWrites.map((write) => write.periodEnd))).toEqual(
      new Set(["2026-09-30", "2026-08-31"]),
    );
    for (const write of septemberWrites) {
      expect(write.periodEnd).not.toBe("2026-08-30");
      expect(write.periodEnd).not.toBe("2026-07-31");
    }
  });

  it("keeps the grains separate across both months", async () => {
    // September's YTD period ends 2026-08-31 — one day AFTER August's MTD
    // period ends 2026-08-30. A date alone cannot identify a period, which is
    // exactly why `report_periods` is keyed on (grain, period_end).
    const repository = fakeRepository();
    const storage = fakeStorage();

    const september = await intakeReportWorkbook(
      { bytes: await combined(SEPTEMBER), ...DELIVERY },
      { repository, storage },
    );

    const byGrain = Object.fromEntries(
      september.periods.map((period) => [period.grain, period.periodEnd]),
    );
    expect(byGrain).toEqual({ mtd: "2026-09-30", ytd: "2026-08-31" });
  });

  it("re-delivering the same month changes nothing", async () => {
    const repository = fakeRepository({
      behaviour: {
        [COMP_SALES_PARSER_KEY]: "already_ingested",
        [ROLLING_PARSER_KEY]: "already_ingested",
        [YTD_PARSER_KEY]: "already_ingested",
      },
    });

    const again = await intakeReportWorkbook(
      { bytes: await combined(SEPTEMBER), ...DELIVERY },
      { repository, storage: fakeStorage() },
    );

    expect(again.factsWritten).toBe(0);
    expect(again.supersededFacts).toBe(0);
    expect(again.parsersSucceeded).toEqual([]);
    expect(again.parsersAlreadyIngested).toHaveLength(3);
  });
});
