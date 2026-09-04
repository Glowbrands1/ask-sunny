import { beforeEach, describe, expect, it, vi } from "vitest";

import { salesTotalsFixtureBytes } from "../__fixtures__/sales-totals-report";
import { readHtmlReport } from "../html-report";
import type { ReportSourceStorage } from "../repository/source-storage";
import {
  buildSalesTotalsFacts,
  summaryScopeCode,
  type SalesTotalsIngestResult,
  type ingestSalesTotalsReport,
} from "./ingest";
import { intakeSalesTotalsReport } from "./intake";
import { parseSalesTotals } from "./parser";

/**
 * ============================================================================
 * THE SALES TOTALS EMAIL PATH, END TO END WITHOUT A DATABASE.
 * ============================================================================
 *
 * This is the piece that did not exist. The parser, the schema, the
 * `ingest_sales_totals` transaction and the dashboard were all built, and
 * nothing in TypeScript joined them — which is why the inbound route answered
 * `family_not_ingestible_by_email`.
 *
 * What is proven here: the real format is read, a rejected report writes and
 * stores NOTHING, the fact payload matches the transaction's contract, and a
 * replay of identical bytes writes nothing. Persistence itself is a fake, so
 * these tests state the CONTRACT with the transaction rather than exercising
 * Postgres — the transaction's own guarantees are asserted against the
 * migration SQL in `ingest.test.ts`.
 */

interface Recorded {
  uploads: { path: string; contentType: string; bytes: number }[];
  persisted: { reportDate: string; facts: number; sha256: string }[];
}

const recorded: Recorded = { uploads: [], persisted: [] };

const storage: ReportSourceStorage = {
  async upload(input) {
    recorded.uploads.push({
      path: input.path,
      contentType: input.contentType,
      bytes: input.bytes.byteLength,
    });
  },
  async exists() {
    return false;
  },
};

/** A fake that answers as the real ingestion layer does, keyed by digest. */
function fakePersist(seen = new Set<string>()) {
  return vi.fn(async (input: Parameters<typeof ingestSalesTotalsReport>[0]) => {
    const key = `${input.file.sha256}:${input.report.parserKey}:${input.report.parserVersion}`;
    const facts = buildSalesTotalsFacts(input.report);

    if (seen.has(key)) {
      // Exactly what `begin_report_ingestion` answers for identical bytes.
      return {
        outcome: "already_ingested",
        ingestionId: "ing-1",
        fileId: "file-1",
        snapshotId: null,
        reportDate: input.report.reportDate,
        factsWritten: 0,
        factsSuperseded: 0,
        supersededSnapshotId: null,
        unresolvedSalons: [],
        fileCreated: false,
        failureReason: null,
      } satisfies SalesTotalsIngestResult;
    }

    seen.add(key);
    recorded.persisted.push({
      reportDate: input.report.reportDate,
      facts: facts.length,
      sha256: input.file.sha256,
    });
    return {
      outcome: "succeeded",
      ingestionId: "ing-1",
      fileId: "file-1",
      snapshotId: "snap-1",
      reportDate: input.report.reportDate,
      factsWritten: facts.length,
      factsSuperseded: 0,
      supersededSnapshotId: null,
      unresolvedSalons: [],
      fileCreated: true,
      failureReason: null,
    } satisfies SalesTotalsIngestResult;
  });
}

const delivery = (bytes: Uint8Array) => ({
  bytes,
  originalFilename: "SalesTotals.xls",
  mimeType: "application/vnd.ms-excel",
  externalMessageId: "<upstream@suntancity.com>",
  senderEmail: "reports@suntancity.com",
  receivedAt: "2026-09-04T11:02:00.000Z",
  inboundEmailId: "email_abc",
});

beforeEach(() => {
  recorded.uploads = [];
  recorded.persisted = [];
});

describe("ingesting a Sales Totals delivery", () => {
  it("reads the real format — HTML wearing an .xls name — and writes a snapshot", async () => {
    const bytes = salesTotalsFixtureBytes({ reportDate: "09-03-2026" });
    const result = await intakeSalesTotalsReport(delivery(bytes), {
      storage,
      persist: fakePersist(),
    });

    expect(result.status).toBe("ingested");
    expect(result.report?.reportDate).toBe("2026-09-03");
    expect(result.report?.reportDateRaw).toBe("09-03-2026");
    expect(result.report?.monthStart).toBe("2026-09-01");
    // Both windows in one delivery, which is what makes it a snapshot.
    expect(result.report?.windows.slice().sort()).toEqual(["daily", "mtd"]);
    expect(result.ingest?.outcome).toBe("succeeded");
    expect(result.ingest?.factsWritten).toBeGreaterThan(0);
  });

  it("stores the object once, at a digest-derived path, as the HTML it is", async () => {
    const bytes = salesTotalsFixtureBytes({ reportDate: "09-03-2026" });
    const result = await intakeSalesTotalsReport(delivery(bytes), {
      storage,
      persist: fakePersist(),
    });

    expect(recorded.uploads).toHaveLength(1);
    const upload = recorded.uploads[0];
    // The day it reports on, not a period: a Sales Totals delivery has no
    // reporting period in the Comp Report's sense.
    expect(upload.path).toContain("sales_totals/daily-2026-09-03/");
    expect(upload.path).toContain(result.sha256.slice(0, 16));
    // The truth about the bytes, not the extension's claim.
    expect(upload.contentType).toBe("text/html");
  });

  it("does not re-upload bytes that are already stored", async () => {
    const bytes = salesTotalsFixtureBytes({ reportDate: "09-03-2026" });
    await intakeSalesTotalsReport(delivery(bytes), {
      storage: { ...storage, exists: async () => true },
      persist: fakePersist(),
    });
    expect(recorded.uploads).toHaveLength(0);
  });

  it("carries the delivery's lineage into the file record", async () => {
    const bytes = salesTotalsFixtureBytes();
    const persist = fakePersist();
    await intakeSalesTotalsReport(delivery(bytes), { storage, persist });

    const call = persist.mock.calls[0][0];
    expect(call.file.senderEmail).toBe("reports@suntancity.com");
    expect(call.file.inboundEmailId).toBe("email_abc");
    // The UPSTREAM Message-ID, not Resend's copy.
    expect(call.file.externalMessageId).toBe("<upstream@suntancity.com>");
    expect(call.file.originalFilename).toBe("SalesTotals.xls");
    // Its own source row, not the Comp Report's.
    expect(call.sourceCode).toBe("sales_totals_email");
  });
});

describe("replaying the same delivery", () => {
  it("writes nothing the second time", async () => {
    const bytes = salesTotalsFixtureBytes({ reportDate: "09-03-2026" });
    const persist = fakePersist();

    const first = await intakeSalesTotalsReport(delivery(bytes), { storage, persist });
    const second = await intakeSalesTotalsReport(delivery(bytes), { storage, persist });

    expect(first.status).toBe("ingested");
    /*
     * THE GUARANTEE THIS CHECKPOINT HAD TO PROVE. A webhook retry and a
     * forwarding rule that fires twice both re-deliver identical bytes;
     * `begin_report_ingestion` recognises the digest and the second delivery
     * writes no snapshot, no facts and no supersession.
     */
    expect(second.status).toBe("already_ingested");
    expect(second.ingest?.factsWritten).toBe(0);
    expect(second.ingest?.snapshotId).toBeNull();
    expect(recorded.persisted).toHaveLength(1);
    // Same bytes, same digest — which is what makes the two the same delivery.
    expect(second.sha256).toBe(first.sha256);
  });

  it("treats a different report DATE as a different delivery", async () => {
    const persist = fakePersist();
    const monday = await intakeSalesTotalsReport(
      delivery(salesTotalsFixtureBytes({ reportDate: "09-03-2026" })),
      { storage, persist },
    );
    const tuesday = await intakeSalesTotalsReport(
      delivery(salesTotalsFixtureBytes({ reportDate: "09-04-2026" })),
      { storage, persist },
    );

    expect(monday.status).toBe("ingested");
    expect(tuesday.status).toBe("ingested");
    // Each day is its own snapshot; they coexist rather than superseding.
    expect(recorded.persisted.map((entry) => entry.reportDate)).toEqual([
      "2026-09-03",
      "2026-09-04",
    ]);
  });
});

describe("a delivery that must not become data", () => {
  it("refuses bytes that are not the report, and stores nothing", async () => {
    const persist = fakePersist();
    const result = await intakeSalesTotalsReport(
      delivery(new TextEncoder().encode("PK not html")),
      { storage, persist },
    );

    expect(result.status).toBe("rejected");
    expect(result.code).toBe("unreadable_report");
    expect(recorded.uploads).toHaveLength(0);
    expect(persist).not.toHaveBeenCalled();
  });

  it("refuses an HTML page that is not this report", async () => {
    const persist = fakePersist();
    const result = await intakeSalesTotalsReport(
      delivery(
        new TextEncoder().encode("<html><title>Lunch menu</title><table><tr><td>x</td></tr></table></html>"),
      ),
      { storage, persist },
    );

    expect(result.status).toBe("rejected");
    expect(result.code).toBe("unsupported_report");
    expect(recorded.uploads).toHaveLength(0);
    expect(persist).not.toHaveBeenCalled();
  });

  it("calls template drift by its name, so the response is actionable", async () => {
    const persist = fakePersist();
    /*
     * The report, with a measure header renamed: this IS Sales Totals and our
     * mapping is out of date, which is a different operational problem from a
     * stray attachment and gets a different code.
     */
    const result = await intakeSalesTotalsReport(
      delivery(salesTotalsFixtureBytes({ renameMeasure: { Tans: "Sessions" } })),
      { storage, persist },
    );

    expect(result.status).toBe("rejected");
    expect(result.code).toBe("template_drift");
    expect(recorded.uploads).toHaveLength(0);
    expect(persist).not.toHaveBeenCalled();
  });

  it("reports a failed write without pretending anything landed", async () => {
    const result = await intakeSalesTotalsReport(delivery(salesTotalsFixtureBytes()), {
      storage,
      persist: async () => ({
        outcome: "failed",
        ingestionId: "ing-1",
        fileId: "file-1",
        snapshotId: null,
        reportDate: "2026-09-03",
        factsWritten: 0,
        factsSuperseded: 0,
        supersededSnapshotId: null,
        unresolvedSalons: [],
        fileCreated: true,
        failureReason: "constraint violated",
      }),
    });

    expect(result.status).toBe("failed");
    expect(result.code).toBe("ingestion_failed");
    expect(result.reason).toContain("constraint violated");
  });
});

describe("the fact payload the transaction receives", () => {
  const report = parseSalesTotals(
    readHtmlReport(salesTotalsFixtureBytes({ reportDate: "09-03-2026" })),
  );
  const facts = buildSalesTotalsFacts(report);

  it("splits estate scopes from salon rows, as the schema does", () => {
    const summary = facts.filter((fact) => fact.scope_kind === "summary");
    const salon = facts.filter((fact) => fact.scope_kind === "salon");
    expect(summary.length).toBeGreaterThan(0);
    expect(salon.length).toBeGreaterThan(0);

    // A summary fact carries a scope code and no store name; a salon fact the
    // reverse. The transaction joins on exactly that distinction.
    expect(summary.every((fact) => fact.scope_code !== null && fact.store_name === null)).toBe(
      true,
    );
    expect(salon.every((fact) => fact.store_name !== null && fact.scope_code === null)).toBe(true);
  });

  it("derives the scope codes the schema was seeded with", () => {
    expect(summaryScopeCode("All Salons")).toBe("all_salons");
    expect(summaryScopeCode("STC Consolidated")).toBe("stc_consolidated");
    expect(summaryScopeCode("STC Franchisees")).toBe("stc_franchisees");

    const codes = [
      ...new Set(facts.filter((fact) => fact.scope_kind === "summary").map((f) => f.scope_code)),
    ].sort();
    expect(codes).toEqual(["all_salons", "stc_consolidated", "stc_franchisees"]);
  });

  it("carries the salon count on summary rows only", () => {
    // The summary block reports per-salon AVERAGES over a population, so how
    // many salons it averaged is part of the fact. A salon row has none.
    expect(
      facts.filter((f) => f.scope_kind === "summary").every((f) => f.salon_count !== null),
    ).toBe(true);
    expect(facts.filter((f) => f.scope_kind === "salon").every((f) => f.salon_count === null)).toBe(
      true,
    );
  });

  it("keeps both windows and every metric, including PPTA", () => {
    expect([...new Set(facts.map((fact) => fact.report_window))].sort()).toEqual(["daily", "mtd"]);
    const metrics = [...new Set(facts.map((fact) => fact.metric_code))];
    /*
     * PPTA IS STORED AS A FACT and marked non-additive by the read layer, not
     * dropped here. The report states it, so the record should — refusing to
     * SUM it is a presentation rule, not a reason to lose the figure.
     */
    expect(metrics).toContain("ppta");
    expect(metrics).toContain("grand_total");
  });

  it("never writes a blank cell as a zero", () => {
    /*
     * The parser preserves an empty cell as null. Writing it as 0 would state a
     * figure the report did not, and an average over it would be wrong in the
     * direction that looks plausible.
     */
    expect(facts.every((fact) => fact.value !== null)).toBe(true);
    const parsedValues = [...report.summaryRows, ...report.salonRows].flatMap((row) => row.values);
    expect(facts).toHaveLength(parsedValues.filter((value) => value.value !== null).length);
  });
});
