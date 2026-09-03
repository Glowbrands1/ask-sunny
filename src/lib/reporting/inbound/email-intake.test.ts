import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildCombinedCompReportWorkbook } from "../__fixtures__/comp-sales-combined-workbook";
import { COMP_SALES_PARSER_KEY } from "../comp-sales/parser";
import { ROLLING_PARSER_KEY } from "../comp-sales/rolling-parser";
import { YTD_PARSER_KEY } from "../comp-sales/ytd-parser";
import { XLSX_MIME } from "../ingest";
import type {
  IngestionResult,
  ReportingRepository,
  SourceFileRecord,
} from "../repository/types";
import type { ReportSourceStorage } from "../repository/source-storage";
import type { ParsedReport } from "../types";
import { APPROVED_SENDERS_ENV } from "./delivery-gate";
import { intakeReceivedEmail, type ReceivedEmail } from "./email-intake";
import { isWorkbookCandidate, type ResendAttachment } from "./resend-client";

/**
 * FROM A FORWARDED EMAIL TO REPORTING FACTS.
 *
 * Every address, id and figure below is invented except the two real sender
 * addresses the allowlist has to admit.
 *
 * What is being tested is the ADAPTER, not the parsers: that the right
 * attachment is chosen out of a realistic corporate email, that the gates run
 * before a byte moves, that a duplicate delivery writes nothing, and that a
 * refused workbook leaves the existing data alone. The parser behaviour behind
 * `intakeReportWorkbook` has its own suite.
 */

const TEST_SENDER = "Paulyne.Camacho@glowbrands.com";
const SAMUEL = "Samuel.Brockie@glowbrands.com";
const EMAIL_ID = "invented-resend-email-id-9f2c";

beforeEach(() => {
  process.env[APPROVED_SENDERS_ENV] = `${TEST_SENDER}, ${SAMUEL}`;
});

afterEach(() => {
  delete process.env[APPROVED_SENDERS_ENV];
});

/** Repository stand-in. Records writes; nothing reaches a database. */
function fakeRepository(
  options: { alreadyIngested?: boolean } = {},
): ReportingRepository & { writes: { parserKey: string; file: SourceFileRecord }[] } {
  const writes: { parserKey: string; file: SourceFileRecord }[] = [];
  return {
    writes,
    async ingest(input: {
      sourceCode: string;
      file: SourceFileRecord;
      report: ParsedReport;
    }): Promise<IngestionResult> {
      const { report, file } = input;
      writes.push({ parserKey: report.parserKey, file });
      const base = {
        ingestionId: `ing-${report.parserKey}`,
        fileId: "file-1",
        fileCreated: true,
        salonCount: report.salons.length,
        supersededAttributes: 0,
        failureReason: null,
      };
      if (options.alreadyIngested) {
        return { ...base, outcome: "already_ingested", periodId: null, factCount: 0, supersededFacts: 0 };
      }
      return {
        ...base,
        outcome: "succeeded",
        periodId: `period-${report.period.grain}-${report.period.periodEnd}`,
        factCount: report.facts.length,
        supersededFacts: 0,
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
    async exists(path) {
      return uploads.includes(path);
    },
  };
}

function attachment(overrides: Partial<ResendAttachment> = {}): ResendAttachment {
  return {
    id: "att-invented-1",
    filename: "Comp Report 08.30.2026.xlsx",
    contentType: XLSX_MIME,
    sizeBytes: 11_584,
    downloadUrl: "https://invented-storage.test/signed/att-invented-1",
    contentDisposition: "attachment",
    ...overrides,
  };
}

/** A realistic forwarded corporate email: report plus signature furniture. */
const REALISTIC_ATTACHMENTS: ResendAttachment[] = [
  attachment({ id: "att-logo", filename: "glo-logo.png", contentType: "image/png", sizeBytes: 4_210, contentDisposition: "inline" }),
  attachment({ id: "att-sig", filename: "image001.jpg", contentType: "image/jpeg", sizeBytes: 8_900, contentDisposition: "inline" }),
  attachment({ id: "att-cover", filename: "Cover note.pdf", contentType: "application/pdf", sizeBytes: 92_000 }),
  attachment({ id: "att-report", filename: "Comp Report 08.30.2026.xlsx", contentType: XLSX_MIME, sizeBytes: 11_584 }),
];

function received(overrides: Partial<ReceivedEmail> = {}): ReceivedEmail {
  return {
    emailId: EMAIL_ID,
    from: `Brockie, Samuel <${SAMUEL}>`,
    subject: "Comp Report 2026 08 30 - Bowen, Curt",
    messageId: "<invented.upstream.message.id@glowbrands.com>",
    receivedAt: "2026-09-01T08:59:00.000Z",
    attachments: REALISTIC_ATTACHMENTS,
    ...overrides,
  };
}

/** Dependencies that serve the real synthetic workbook for the report only. */
async function serving(
  bytes: Uint8Array,
  options: { listed?: ResendAttachment[]; alreadyIngested?: boolean } = {},
) {
  const repository = fakeRepository({ alreadyIngested: options.alreadyIngested });
  const storage = fakeStorage();
  const downloaded: string[] = [];
  const listCalls: string[] = [];

  return {
    repository,
    storage,
    downloaded,
    listCalls,
    deps: {
      repository,
      storage,
      knownPeriodIds: async () => new Set<string>(),
      listAttachments: async (emailId: string) => {
        listCalls.push(emailId);
        return options.listed ?? REALISTIC_ATTACHMENTS;
      },
      downloadBytes: async (entry: ResendAttachment) => {
        downloaded.push(entry.id);
        // Only the report id serves a real workbook; anything else serves
        // bytes that are not a ZIP container, as the real thing would.
        if (entry.id === "att-report") return bytes;
        return new TextEncoder().encode("not a workbook at all");
      },
    },
  };
}

describe("choosing the workbook out of an email", () => {
  it("selects the Excel attachment and ignores the furniture", () => {
    const candidates = REALISTIC_ATTACHMENTS.filter(isWorkbookCandidate);
    expect(candidates.map((entry) => entry.id)).toEqual(["att-report"]);
  });

  it("ignores inline images even when they are named like a workbook", () => {
    // Inline means part of the body — a signature image or an embedded logo.
    expect(
      isWorkbookCandidate(
        attachment({ filename: "report.xlsx", contentType: "image/png", contentDisposition: "inline" }),
      ),
    ).toBe(false);
  });

  it("ignores a PDF however it is labelled", () => {
    expect(isWorkbookCandidate(attachment({ filename: "x.pdf", contentType: "application/pdf" }))).toBe(false);
    // A PDF mislabelled with the spreadsheet type is still a PDF.
    expect(isWorkbookCandidate(attachment({ filename: "x.pdf", contentType: XLSX_MIME }))).toBe(false);
  });

  it("ignores a legacy .xls, which the parsers cannot read", () => {
    expect(isWorkbookCandidate(attachment({ filename: "old.xls", contentType: "application/vnd.ms-excel" }))).toBe(false);
  });

  it("accepts a workbook a transport mislabelled as octet-stream", () => {
    // Ordinary, and refusing it would drop real reports.
    expect(
      isWorkbookCandidate(
        attachment({ filename: "Comp Report.xlsx", contentType: "application/octet-stream" }),
      ),
    ).toBe(true);
  });

  it("downloads only the candidate, not the images or the PDF", async () => {
    const bytes = await buildCombinedCompReportWorkbook();
    const harness = await serving(bytes);
    await intakeReceivedEmail(received(), harness.deps);
    expect(harness.downloaded).toEqual(["att-report"]);
  });
});

describe("a valid forwarded report", () => {
  it("runs every applicable parser from one email", async () => {
    const bytes = await buildCombinedCompReportWorkbook();
    const harness = await serving(bytes);

    const outcome = await intakeReceivedEmail(received(), harness.deps);

    expect(outcome.status).toBe("ingested");
    expect(outcome.intake?.parsersSucceeded.sort()).toEqual(
      [COMP_SALES_PARSER_KEY, ROLLING_PARSER_KEY, YTD_PARSER_KEY].sort(),
    );
    expect(outcome.intake?.parsersFailed).toEqual([]);
    expect(outcome.intake?.factsWritten).toBeGreaterThan(0);
  });

  it("preserves the attachment's own filename and content type", async () => {
    const bytes = await buildCombinedCompReportWorkbook();
    const harness = await serving(bytes);
    await intakeReceivedEmail(received(), harness.deps);

    for (const write of harness.repository.writes) {
      expect(write.file.originalFilename).toBe("Comp Report 08.30.2026.xlsx");
      expect(write.file.mimeType).toBe(XLSX_MIME);
    }
  });

  it("records the sender, the arrival time and both message identities", async () => {
    const bytes = await buildCombinedCompReportWorkbook();
    const harness = await serving(bytes);
    const email = received();
    await intakeReceivedEmail(email, harness.deps);

    const [write] = harness.repository.writes;
    expect(write.file.senderEmail).toBe(email.from);
    expect(write.file.receivedAt).toBe(email.receivedAt);
    // The UPSTREAM Message-ID identifies the mail Samuel sent…
    expect(write.file.externalMessageId).toBe(email.messageId);
    // …and Resend's id names the copy it received. Two identities, both kept.
    expect(write.file.inboundEmailId).toBe(EMAIL_ID);
  });

  it("falls back to the Resend id when no upstream Message-ID survived", async () => {
    const bytes = await buildCombinedCompReportWorkbook();
    const harness = await serving(bytes);
    await intakeReceivedEmail(received({ messageId: null }), harness.deps);

    // Prefixed, so the two identities can never be confused when read back.
    expect(harness.repository.writes[0].file.externalMessageId).toBe(`resend-email:${EMAIL_ID}`);
  });

  it("accepts the operator's own test address", async () => {
    const bytes = await buildCombinedCompReportWorkbook();
    const harness = await serving(bytes);
    const outcome = await intakeReceivedEmail(
      received({ from: `Paulyne Camacho <${TEST_SENDER}>` }),
      harness.deps,
    );
    expect(outcome.status).toBe("ingested");
  });

  it("accepts a subject naming the Comp Report whatever the date", async () => {
    const bytes = await buildCombinedCompReportWorkbook();
    for (const subject of [
      "Comp Report 2026 08 30 - Bowen, Curt",
      "Comp Report 2026 09 30 - Bowen, Curt",
      "Comp Report TEST",
    ]) {
      const harness = await serving(bytes);
      const outcome = await intakeReceivedEmail(received({ subject }), harness.deps);
      expect(outcome.status, subject).toBe("ingested");
    }
  });

  it("returns no financial values, salon numbers or credentials", async () => {
    const bytes = await buildCombinedCompReportWorkbook();
    const harness = await serving(bytes);
    const outcome = await intakeReceivedEmail(received(), harness.deps);

    const body = JSON.stringify(outcome);
    expect(body).not.toMatch(/"salonNumber"/);
    expect(body).not.toMatch(/storeName/);
    expect(body).not.toContain("reporting-sources");
    expect(body).not.toMatch(/storagePath/);
    expect(body).not.toContain(TEST_SENDER);
  });
});

describe("deliveries that must not ingest anything", () => {
  it("ignores an unapproved sender without touching an attachment", async () => {
    const bytes = await buildCombinedCompReportWorkbook();
    const harness = await serving(bytes);

    const outcome = await intakeReceivedEmail(
      received({ from: "stranger@invented.test" }),
      harness.deps,
    );

    expect(outcome.status).toBe("ignored");
    expect(outcome.code).toBe("sender_not_approved");
    // The gate runs FIRST: no API call, no download, no write.
    expect(harness.listCalls).toEqual([]);
    expect(harness.downloaded).toEqual([]);
    expect(harness.repository.writes).toEqual([]);
    expect(harness.storage.uploads).toEqual([]);
  });

  it("ignores an approved sender's unrelated mail", async () => {
    const bytes = await buildCombinedCompReportWorkbook();
    const harness = await serving(bytes);

    const outcome = await intakeReceivedEmail(received({ subject: "Lunch?" }), harness.deps);

    expect(outcome.status).toBe("ignored");
    expect(outcome.code).toBe("subject_not_matched");
    expect(harness.repository.writes).toEqual([]);
  });

  it("ignores a report email carrying no workbook", async () => {
    const bytes = await buildCombinedCompReportWorkbook();
    const onlyFurniture = REALISTIC_ATTACHMENTS.filter((entry) => entry.id !== "att-report");
    const harness = await serving(bytes, { listed: onlyFurniture });

    const outcome = await intakeReceivedEmail(
      received({ attachments: onlyFurniture }),
      harness.deps,
    );

    expect(outcome.status).toBe("ignored");
    expect(outcome.code).toBe("no_workbook_attachment");
    expect(harness.downloaded).toEqual([]);
    expect(harness.repository.writes).toEqual([]);
  });

  it("refuses an attachment named .xlsx that is not one", async () => {
    // The ZIP-magic check. A renamed PDF or a truncated download is caught on
    // the BYTES, not on the label.
    const liar = [attachment({ id: "att-liar", filename: "Comp Report.xlsx" })];
    const harness = await serving(new Uint8Array(), { listed: liar });

    const outcome = await intakeReceivedEmail(received({ attachments: liar }), harness.deps);

    expect(outcome.status).toBe("rejected");
    expect(outcome.code).toBe("unreadable_workbook");
    expect(harness.repository.writes).toEqual([]);
    expect(harness.storage.uploads).toEqual([]);
  });

  it("leaves existing data alone when the template has drifted", async () => {
    /*
     * FAIL CLOSED. A drifted workbook is refused before anything is uploaded or
     * written, so the dashboard is exactly as it was — which is the property
     * that matters, because a half-ingested report is worse than none.
     */
    const drifted = await buildCombinedCompReportWorkbook({
      vs2024: null,
      rolling: null,
      ytd: null,
    });
    const only = [attachment({ id: "att-report" })];
    const harness = await serving(drifted, { listed: only });

    const outcome = await intakeReceivedEmail(received({ attachments: only }), harness.deps);

    expect(outcome.status).toBe("rejected");
    expect(["template_drift", "unsupported_workbook", "unreadable_workbook"]).toContain(
      outcome.code,
    );
    expect(harness.repository.writes).toEqual([]);
    expect(harness.storage.uploads).toEqual([]);
    expect(outcome.intake).toBeNull();
  });

  it("reports an attachment the provider could not serve, writing nothing", async () => {
    const only = [attachment({ id: "att-report" })];
    const harness = await serving(new Uint8Array(), { listed: only });
    const failing = {
      ...harness.deps,
      downloadBytes: async () => {
        throw new Error("upstream refused");
      },
    };

    const outcome = await intakeReceivedEmail(received({ attachments: only }), failing);

    expect(outcome.status).toBe("rejected");
    expect(outcome.code).toBe("attachment_unavailable");
    expect(harness.repository.writes).toEqual([]);
  });
});

describe("a duplicate delivery", () => {
  it("writes zero new facts when the bytes have already been ingested", async () => {
    /*
     * The realistic duplicate: Resend retries a webhook it got no 2xx for, or
     * the Outlook rule fires twice. Both re-deliver identical bytes, and the
     * content digest is what recognises them — nothing about the email needs to
     * be remembered for this to hold.
     */
    const bytes = await buildCombinedCompReportWorkbook();
    const harness = await serving(bytes, { alreadyIngested: true });

    const outcome = await intakeReceivedEmail(received(), harness.deps);

    expect(outcome.status).toBe("ingested");
    expect(outcome.intake?.parsersAlreadyIngested).toHaveLength(3);
    expect(outcome.intake?.parsersSucceeded).toEqual([]);
    expect(outcome.intake?.factsWritten).toBe(0);
    expect(outcome.intake?.supersededFacts).toBe(0);
    // No period is claimed for a re-delivery: none was created or reused.
    expect(outcome.intake?.periods).toEqual([]);
  });

  it("uploads the workbook once across two identical deliveries", async () => {
    const bytes = await buildCombinedCompReportWorkbook();
    const harness = await serving(bytes);

    await intakeReceivedEmail(received(), harness.deps);
    expect(harness.storage.uploads).toHaveLength(1);

    await intakeReceivedEmail(received(), harness.deps);
    expect(harness.storage.uploads).toHaveLength(1);
  });
});
