import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildCombinedCompReportWorkbook } from "../__fixtures__/comp-sales-combined-workbook";
import { spaEngagementFixtureBytes } from "../__fixtures__/spa-engagement-workbook";
import { XLSX_MIME } from "../ingest";
import { APPROVED_SENDERS_ENV } from "./delivery-gate";
import {
  SPA_ENGAGEMENT_SENDERS_ENV,
  SPA_ENGAGEMENT_SUBJECT_ENV,
  routeDelivery,
} from "./report-families";
import type { ResendAttachment } from "./resend-client";

/**
 * ============================================================================
 * THE SPA ENGAGEMENT DELIVERY THAT THE COMP REPORT GATE REFUSED
 * ============================================================================
 *
 * THE PRODUCTION FAULT THIS PINS. A `Spa Sessions per Unique Tanner per Spa
 * Bed` workbook was forwarded to the shared inbound address from an address on
 * `SPA_ENGAGEMENT_APPROVED_SENDERS`, under the subject `Spa Sessions`, with
 * `SPA_ENGAGEMENT_SUBJECT_FRAGMENT=spa sessions` configured. The endpoint
 * answered:
 *
 *     {"family":"spa_engagement","status":"ignored",
 *      "code":"subject_not_matched",
 *      "reason":"The subject does not contain \"comp report\"."}
 *
 * The router had already identified the delivery correctly — the response says
 * so. What refused it was a SECOND gate downstream: `intakeReceivedEmail`
 * called `admitDelivery`, which is the Comp Report's, and whose subject
 * fragment is the constant `"comp report"`. The routing result was computed by
 * the route and then dropped on the floor.
 *
 * WHY THESE TESTS MOCK `dispatchReportIntake`. What is under test is
 * ADMISSION — which gate decides, and on whose rules. Whether the workbook
 * then becomes rows is `bed-spa-intake.test.ts`'s subject and needs a
 * database; mocking the dispatch boundary lets "the delivery reached Spa
 * Engagement ingestion" be asserted exactly, and nothing beyond it.
 *
 * `admitDelivery` IS SPIED RATHER THAN STUBBED. The claim that matters is not
 * that the Comp Report gate returns the right answer for a spa delivery — it
 * is that the gate is NEVER CONSULTED about one. That is a call-count
 * assertion, so the real implementation stays in place underneath.
 */

const dispatchReportIntake = vi.hoisted(() => vi.fn());
const admitDeliverySpy = vi.hoisted(() => vi.fn());

vi.mock("../intake-dispatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../intake-dispatch")>();
  return { ...actual, dispatchReportIntake };
});

vi.mock("./delivery-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./delivery-gate")>();
  admitDeliverySpy.mockImplementation(actual.admitDelivery);
  return { ...actual, admitDelivery: admitDeliverySpy };
});

const { intakeReceivedEmail } = await import("./email-intake");

/**
 * The real forwarding address, and DELIBERATELY NOT on the Comp Report's list.
 *
 * That omission is the point of requirement 2: a Spa Engagement sender must
 * not have to be approved for the Comp Report as well. In production this
 * address happens to be on both lists, which is what masked the sender half of
 * the fault and left only the subject half visible.
 */
const SPA_SENDER = "Paulyne.Camacho@glowbrands.com";
const COMP_SENDER = "Samuel.Brockie@glowbrands.com";
const EMAIL_ID = "invented-resend-email-id-7c3a";

beforeEach(() => {
  process.env[APPROVED_SENDERS_ENV] = COMP_SENDER;
  process.env[SPA_ENGAGEMENT_SENDERS_ENV] = SPA_SENDER;
  process.env[SPA_ENGAGEMENT_SUBJECT_ENV] = "spa sessions";
  dispatchReportIntake.mockReset();
  dispatchReportIntake.mockResolvedValue({
    family: "bed_spa",
    result: {
      familyKey: "spa_engagement",
      attempts: [{ status: "succeeded", parserKey: "spa_engagement_unique_tanner" }],
    },
  });
  admitDeliverySpy.mockClear();
});

afterEach(() => {
  delete process.env[APPROVED_SENDERS_ENV];
  delete process.env[SPA_ENGAGEMENT_SENDERS_ENV];
  delete process.env[SPA_ENGAGEMENT_SUBJECT_ENV];
});

const SPA_ATTACHMENTS: ResendAttachment[] = [
  {
    id: "att-sig",
    filename: "image001.jpg",
    contentType: "image/jpeg",
    sizeBytes: 8_900,
    downloadUrl: null,
    contentDisposition: "inline",
  },
  {
    id: "att-report",
    filename: "Spa Sessions per Unique Tanner per Spa Bed (2026 09 17) All.xlsx",
    contentType: XLSX_MIME,
    sizeBytes: 761_681,
    downloadUrl: null,
    contentDisposition: "attachment",
  },
];

/** The production delivery, reproduced field for field. */
function spaEmail(overrides: Record<string, unknown> = {}) {
  return {
    emailId: EMAIL_ID,
    from: `Camacho, Paulyne <${SPA_SENDER}>`,
    subject: "Spa Sessions",
    messageId: "<invented.upstream.spa@glowbrands.com>",
    receivedAt: "2026-09-17T13:43:00.000Z",
    attachments: SPA_ATTACHMENTS,
    ...overrides,
  };
}

/** Serves `bytes` for the report attachment and rubbish for the furniture. */
function serving(bytes: Uint8Array) {
  const downloaded: string[] = [];
  return {
    downloaded,
    deps: {
      routing: routeDelivery({ from: spaEmail().from, subject: "Spa Sessions" }),
      knownPeriodIds: async () => new Set<string>(),
      listAttachments: async () => SPA_ATTACHMENTS,
      downloadBytes: async (entry: ResendAttachment) => {
        downloaded.push(entry.id);
        if (entry.id === "att-report") return bytes;
        return new TextEncoder().encode("not a workbook at all");
      },
    },
  };
}

describe("a Spa Engagement delivery through the shared inbound endpoint", () => {
  it("routes as spa_engagement on the family's own sender and subject", () => {
    const routing = routeDelivery({ from: `Camacho, Paulyne <${SPA_SENDER}>`, subject: "Spa Sessions" });

    expect(routing.routed).toBe(true);
    expect(routing.routed && routing.family.key).toBe("spa_engagement");
  });

  it("reaches Spa Engagement ingestion instead of being ignored", async () => {
    const harness = serving(await spaEngagementFixtureBytes());

    const outcome = await intakeReceivedEmail(spaEmail(), harness.deps);

    // THE REGRESSION. This was `ignored` / `subject_not_matched` in production.
    expect(outcome.status).not.toBe("ignored");
    expect(outcome.code).not.toBe("subject_not_matched");
    expect(dispatchReportIntake).toHaveBeenCalledTimes(1);
    expect(outcome.reportFamily).toBe("bed_spa");
    // The workbook itself was carried through, named as the sender named it.
    expect(dispatchReportIntake.mock.calls[0][0].originalFilename).toBe(
      "Spa Sessions per Unique Tanner per Spa Bed (2026 09 17) All.xlsx",
    );
    expect(harness.downloaded).toContain("att-report");
  });

  it("does not require the sender to be on the Comp Report allowlist", async () => {
    // Set in `beforeEach` to the Comp Report sender ALONE. If the Spa
    // Engagement path consulted this list, the delivery above could not have
    // been admitted, and this states that dependency explicitly.
    expect(process.env[APPROVED_SENDERS_ENV]).toBe(COMP_SENDER);
    expect(process.env[APPROVED_SENDERS_ENV]).not.toContain(SPA_SENDER);

    const harness = serving(await spaEngagementFixtureBytes());
    const outcome = await intakeReceivedEmail(spaEmail(), harness.deps);

    expect(outcome.status).not.toBe("ignored");
  });

  it("is never evaluated against the Comp Report subject requirement", async () => {
    const harness = serving(await spaEngagementFixtureBytes());

    await intakeReceivedEmail(spaEmail(), harness.deps);

    // The second gate — the one whose fragment is the constant "comp report" —
    // is not asked about a delivery another family already admitted.
    expect(admitDeliverySpy).not.toHaveBeenCalled();
  });

  it("refuses a Comp Report workbook sent under Spa Engagement headers", async () => {
    /*
     * THE WIDENING THIS CLOSES. Dropping the Comp Report gate would otherwise
     * let a sender approved only for Spa Engagement file a COMP REPORT by
     * attaching one under a `Spa Sessions` subject. The headers are forgeable;
     * the workbook's structure is not.
     */
    const harness = serving(await buildCombinedCompReportWorkbook());

    const outcome = await intakeReceivedEmail(spaEmail(), harness.deps);

    expect(outcome.status).toBe("rejected");
    expect(outcome.code).toBe("content_not_recognised");
    expect(dispatchReportIntake).not.toHaveBeenCalled();
  });
});

describe("a routing result that refused the delivery", () => {
  it("does not fall through to the Comp Report gate when a family was named", async () => {
    // Routed at the sender, refused at the subject: the Spa Engagement sender
    // sent something that names no report.
    const routing = routeDelivery({ from: SPA_SENDER, subject: "Out of office" });
    expect(routing.routed).toBe(false);

    const outcome = await intakeReceivedEmail(spaEmail({ subject: "Out of office" }), {
      routing,
      knownPeriodIds: async () => new Set<string>(),
      listAttachments: async () => SPA_ATTACHMENTS,
      downloadBytes: async () => new Uint8Array(),
    });

    expect(outcome.status).toBe("ignored");
    expect(admitDeliverySpy).not.toHaveBeenCalled();
    // Refused before a byte moved.
    expect(dispatchReportIntake).not.toHaveBeenCalled();
  });

  it("refuses an unactivated family with its own reason, not the Comp Report's", async () => {
    delete process.env[SPA_ENGAGEMENT_SENDERS_ENV];
    const routing = routeDelivery({ from: COMP_SENDER, subject: "Spa Sessions" });

    const outcome = await intakeReceivedEmail(spaEmail({ from: COMP_SENDER }), {
      routing,
      knownPeriodIds: async () => new Set<string>(),
      listAttachments: async () => SPA_ATTACHMENTS,
      downloadBytes: async () => new Uint8Array(),
    });

    expect(outcome.status).toBe("ignored");
    expect(outcome.reason).not.toContain("comp report");
    expect(dispatchReportIntake).not.toHaveBeenCalled();
  });

  it("keeps the Comp Report gate for a caller that supplies no routing", async () => {
    /*
     * THE LEGACY CONTRACT, UNCHANGED. Every caller predating the router — and
     * every existing test in `email-intake.test.ts` — passes no routing, and
     * must still get the Comp Report's rules and the Comp Report's codes.
     */
    const outcome = await intakeReceivedEmail(spaEmail(), {
      knownPeriodIds: async () => new Set<string>(),
      listAttachments: async () => SPA_ATTACHMENTS,
      downloadBytes: async () => new Uint8Array(),
    });

    expect(admitDeliverySpy).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("ignored");
    // The Spa sender is not on the Comp Report list, so that gate stops here.
    expect(outcome.code).toBe("sender_not_approved");
    expect(dispatchReportIntake).not.toHaveBeenCalled();
  });
});
