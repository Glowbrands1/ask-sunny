import { describe, expect, it, vi } from "vitest";

import { UPLOAD_LIMITS } from "@/lib/config/models";
import { salesTotalsFixtureBytes } from "../__fixtures__/sales-totals-report";
import { XLSX_MIME } from "../ingest";
import { intakeReceivedSalesTotals } from "./email-intake";
import {
  isSalesTotalsCandidate,
  isWorkbookCandidate,
  ResendApiError,
  type ResendAttachment,
} from "./resend-client";

/**
 * ============================================================================
 * FINDING THE SALES TOTALS REPORT IN A FORWARDED EMAIL.
 * ============================================================================
 *
 * The report is `SalesTotals.xls` and is NOT an `.xls`. Proven from the real
 * received file: it opens `<html><title>Sales Totals</title>` and carries
 * neither the ZIP magic of an `.xlsx` nor the OLE2 magic of a genuine BIFF
 * workbook.
 *
 * So this family's attachment rule has to accept a name the Comp Report's rule
 * refuses — and the tests here are as much about what did NOT change as what
 * did. `isWorkbookCandidate` still rejects `.xls`, because a Comp Report is a
 * real `.xlsx` and a file claiming otherwise is not one. Two rules, no shared
 * middle ground that admits more than either family wants.
 */

function attachment(overrides: Partial<ResendAttachment> = {}): ResendAttachment {
  return {
    id: "att-1",
    filename: "SalesTotals.xls",
    contentType: "application/vnd.ms-excel",
    sizeBytes: 19693,
    downloadUrl: "https://invented.test/att-1",
    contentDisposition: "attachment",
    ...overrides,
  };
}

const REPORT_BYTES = salesTotalsFixtureBytes({ reportDate: "09-03-2026" });

function harness(
  options: {
    attachments?: ResendAttachment[];
    bytesFor?: (attachment: ResendAttachment) => Uint8Array;
    downloadFails?: boolean;
  } = {},
) {
  const listed = options.attachments ?? [attachment()];
  const downloaded: string[] = [];
  const intake = vi.fn(async (input: { originalFilename: string }) => ({
    status: "ingested" as const,
    code: "ingested" as const,
    reason: "ok",
    sha256: "digest",
    sizeBytes: 0,
    originalFilename: input.originalFilename,
    report: null,
    ingest: null,
    rejection: null,
  }));

  return {
    intake,
    downloaded,
    deps: {
      apiKey: "re_invented",
      listAttachments: async () => listed,
      downloadBytes: async (
        entry: ResendAttachment,
        opts: { maxBytes: number },
      ): Promise<Uint8Array> => {
        downloaded.push(entry.id);
        if (options.downloadFails) throw new ResendApiError("The attachment download returned 500.");
        // The real `downloadAttachment` refuses on the DECLARED size before
        // reading a body, and raises a ResendApiError whose message is safe to
        // return. Mirrored here so the assertion is about the real behaviour.
        if (entry.sizeBytes !== null && entry.sizeBytes > opts.maxBytes) {
          throw new ResendApiError(
            `The attachment is larger than the ${opts.maxBytes}-byte limit.`,
          );
        }
        return options.bytesFor?.(entry) ?? REPORT_BYTES;
      },
      intake,
    },
  };
}

const received = (attachments: ResendAttachment[]) => ({
  emailId: "email_st_1",
  from: "STC Reports <reports@suntancity.com>",
  subject: "Sales Totals for Bowen",
  messageId: "<upstream@suntancity.test>",
  receivedAt: "2026-09-04T11:02:00.000Z",
  attachments,
});

describe("which attachments each family will look at", () => {
  it("accepts the .xls name for Sales Totals", () => {
    expect(isSalesTotalsCandidate(attachment())).toBe(true);
    expect(isSalesTotalsCandidate(attachment({ contentType: "text/html" }))).toBe(true);
    expect(isSalesTotalsCandidate(attachment({ filename: "SalesTotals.html" }))).toBe(true);
  });

  it("STILL refuses .xls for the Comp Report", () => {
    /*
     * THE REGRESSION THIS PREVENTS. Making Sales Totals work must not loosen
     * the Comp Report's rule — a legacy or HTML file reaching those parsers
     * would be read as a workbook it is not.
     */
    expect(isWorkbookCandidate(attachment())).toBe(false);
    expect(isWorkbookCandidate(attachment({ filename: "old.xls", contentType: XLSX_MIME }))).toBe(
      false,
    );
    // And its own format still passes.
    expect(
      isWorkbookCandidate(
        attachment({ filename: "Comp Report 08.30.2026.xlsx", contentType: XLSX_MIME }),
      ),
    ).toBe(true);
  });

  it("refuses signature images, inline furniture and PDFs for BOTH families", () => {
    const furniture = [
      attachment({ filename: "image001.jpg", contentType: "image/jpeg" }),
      attachment({ filename: "logo.png", contentType: "image/png", contentDisposition: "inline" }),
      attachment({ filename: "SalesTotals.xls", contentDisposition: "inline" }),
      attachment({ filename: "policy.pdf", contentType: "application/pdf" }),
      // A PDF wearing a spreadsheet's mime type is still a PDF.
      attachment({ filename: "policy.pdf", contentType: "application/vnd.ms-excel" }),
    ];
    for (const entry of furniture) {
      expect(isSalesTotalsCandidate(entry), entry.filename).toBe(false);
      expect(isWorkbookCandidate(entry), entry.filename).toBe(false);
    }
  });

  it("does not treat a genuine .xlsx as the Sales Totals report", () => {
    // It would reach a parser that cannot read it while looking like the right
    // family; the Comp Report's rule is the one that claims those.
    expect(
      isSalesTotalsCandidate(attachment({ filename: "Comp Report.xlsx", contentType: XLSX_MIME })),
    ).toBe(false);
  });
});

describe("choosing and validating the attachment", () => {
  it("downloads the candidate and hands the bytes to the Sales Totals intake", async () => {
    const { deps, intake } = harness();
    const outcome = await intakeReceivedSalesTotals(received([attachment()]), deps);

    expect(outcome.status).toBe("ingested");
    expect(intake).toHaveBeenCalledTimes(1);
    const passed = intake.mock.calls[0][0] as unknown as {
      originalFilename: string;
      senderEmail: string | null;
      externalMessageId: string | null;
      inboundEmailId: string | null;
    };
    expect(passed).toBeTruthy();
    expect(passed.originalFilename).toBe("SalesTotals.xls");
    expect(passed.senderEmail).toBe("STC Reports <reports@suntancity.com>");
    // The UPSTREAM Message-ID, so lineage names the mail the system sent.
    expect(passed.externalMessageId).toBe("<upstream@suntancity.test>");
    expect(passed.inboundEmailId).toBe("email_st_1");
  });

  it("skips an attachment whose bytes are not an HTML report, and tries the next", async () => {
    const decoy = attachment({ id: "att-decoy", filename: "notes.xls", sizeBytes: 90_000 });
    const real = attachment({ id: "att-real", sizeBytes: 19_693 });
    const { deps, downloaded, intake } = harness({
      attachments: [real, decoy],
      // The larger one is tried first and is not the report.
      bytesFor: (entry) =>
        entry.id === "att-decoy" ? new TextEncoder().encode("just some text") : REPORT_BYTES,
    });

    const outcome = await intakeReceivedSalesTotals(received([real, decoy]), deps);

    expect(downloaded).toEqual(["att-decoy", "att-real"]);
    expect(outcome.status).toBe("ingested");
    expect(intake).toHaveBeenCalledTimes(1);
  });

  it("ignores a mail whose attachments are all furniture, without an API call", async () => {
    const list = vi.fn();
    const outcome = await intakeReceivedSalesTotals(
      received([
        attachment({ filename: "image001.jpg", contentType: "image/jpeg" }),
        attachment({ filename: "policy.pdf", contentType: "application/pdf" }),
      ]),
      { listAttachments: list as never },
    );

    expect(outcome.status).toBe("ignored");
    expect(outcome.code).toBe("no_workbook_attachment");
    // No outbound call is made on a stranger's behalf for a mail with no report.
    expect(list).not.toHaveBeenCalled();
  });

  it("rejects an attachment over the size cap rather than downloading it", async () => {
    const huge = attachment({ id: "att-huge", sizeBytes: UPLOAD_LIMITS.maxBytes + 1 });
    const { deps, intake } = harness({ attachments: [huge] });

    const outcome = await intakeReceivedSalesTotals(received([huge]), deps);

    expect(outcome.status).toBe("rejected");
    expect(outcome.reason).toContain(String(UPLOAD_LIMITS.maxBytes));
    expect(intake).not.toHaveBeenCalled();
  });

  it("reports a download failure as a rejection, not as an ingestion", async () => {
    const { deps, intake } = harness({ downloadFails: true });
    const outcome = await intakeReceivedSalesTotals(received([attachment()]), deps);

    expect(outcome.status).toBe("rejected");
    expect(outcome.code).toBe("attachment_unavailable");
    expect(intake).not.toHaveBeenCalled();
  });

  it("says so when nothing in the mail is an HTML report", async () => {
    const { deps, intake } = harness({
      bytesFor: () => new TextEncoder().encode("PK a real zip"),
    });
    const outcome = await intakeReceivedSalesTotals(received([attachment()]), deps);

    expect(outcome.status).toBe("rejected");
    expect(outcome.code).toBe("unreadable_workbook");
    expect(outcome.reason).toContain("not an HTML document");
    expect(intake).not.toHaveBeenCalled();
  });
});
