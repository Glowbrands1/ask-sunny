import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { salesTotalsFixtureBytes } from "../__fixtures__/sales-totals-report";
import { buildCombinedCompReportWorkbook } from "../__fixtures__/comp-sales-combined-workbook";
import { APPROVED_SENDERS_ENV } from "./delivery-gate";
import {
  confirmFamilyContent,
  familyByKey,
  familyReadiness,
  REPORT_FAMILIES,
  routeDelivery,
  SALES_TOTALS_SENDERS_ENV,
  SALES_TOTALS_SUBJECT_ENV,
} from "./report-families";

/**
 * THE REPORT-FAMILY ROUTER.
 *
 * One signed endpoint, several reports. What is tested here is that the
 * families stay SEPARATE: approval for one report must never confer approval
 * for another, and a forged header must never get a file to the wrong parser.
 *
 * `Samuel.Brockie@glowbrands.com` is the real Comp Report sender. Everything
 * else — including every Sales Totals address — is invented, because the real
 * Sales Totals sender is not yet known and is exactly what must not be guessed.
 */

const SAMUEL = "Samuel.Brockie@glowbrands.com";
const INVENTED_STC = "stc-reports@invented.test";

beforeEach(() => {
  process.env[APPROVED_SENDERS_ENV] = SAMUEL;
  delete process.env[SALES_TOTALS_SENDERS_ENV];
  delete process.env[SALES_TOTALS_SUBJECT_ENV];
});

afterEach(() => {
  delete process.env[APPROVED_SENDERS_ENV];
  delete process.env[SALES_TOTALS_SENDERS_ENV];
  delete process.env[SALES_TOTALS_SUBJECT_ENV];
});

function activateSalesTotals() {
  process.env[SALES_TOTALS_SENDERS_ENV] = INVENTED_STC;
  process.env[SALES_TOTALS_SUBJECT_ENV] = "sales totals";
}

describe("Sales Totals is built but NOT activated", () => {
  it("is inactive with no configuration, and says exactly what is missing", () => {
    const family = familyByKey("sales_totals")!;
    expect(family.isActivated()).toBe(false);
    expect(family.activationGaps()).toEqual([
      `${SALES_TOTALS_SENDERS_ENV} is not set to a valid address`,
      `${SALES_TOTALS_SUBJECT_ENV} is not set`,
    ]);
  });

  it("admits nobody while unconfigured", () => {
    /*
     * THE TEST THIS FILE EXISTS FOR. "STC Reports" is a display name, not an
     * address, and a display name is trivially forged. An unset allowlist must
     * refuse everyone rather than fall back to anything.
     */
    const family = familyByKey("sales_totals")!;
    for (const from of [
      INVENTED_STC,
      "STC Reports <stc@invented.test>",
      "STC Reports",
      SAMUEL,
      null,
    ]) {
      expect(family.admitsSender(from), String(from)).toBe(false);
    }
  });

  it("matches no subject while unconfigured", () => {
    const family = familyByKey("sales_totals")!;
    for (const subject of ["Sales Totals", "Sales Totals for 09-02-2026", "", null]) {
      expect(family.admitsSubject(subject), String(subject)).toBe(false);
    }
  });

  it("refuses a delivery that otherwise looks right, naming the gap", () => {
    activateSalesTotals();
    // One half configured is still not activated.
    delete process.env[SALES_TOTALS_SUBJECT_ENV];

    const outcome = routeDelivery({ from: INVENTED_STC, subject: "Sales Totals 09-02-2026" });
    expect(outcome.routed).toBe(false);
  });

  it("needs only configuration to switch on — no code change", () => {
    // The whole point of the two variables: activation is an env edit.
    expect(familyByKey("sales_totals")!.isActivated()).toBe(false);
    activateSalesTotals();
    expect(familyByKey("sales_totals")!.isActivated()).toBe(true);

    const outcome = routeDelivery({
      from: `STC Reports <${INVENTED_STC}>`,
      subject: "Sales Totals for 09-02-2026",
    });
    expect(outcome.routed).toBe(true);
    if (outcome.routed) expect(outcome.family.key).toBe("sales_totals");
  });
});

describe("the Comp Report is unchanged", () => {
  it("still routes from its approved sender and subject", () => {
    const outcome = routeDelivery({
      from: `Brockie, Samuel <${SAMUEL}>`,
      subject: "Comp Report 2026 08 30 - Bowen, Curt",
    });
    expect(outcome.routed).toBe(true);
    if (outcome.routed) expect(outcome.family.key).toBe("comp_report");
  });

  it("still reads its own allowlist variable", () => {
    expect(familyByKey("comp_report")!.isActivated()).toBe(true);
    delete process.env[APPROVED_SENDERS_ENV];
    expect(familyByKey("comp_report")!.isActivated()).toBe(false);
  });

  it("still refuses an unapproved sender", () => {
    const outcome = routeDelivery({
      from: "stranger@invented.test",
      subject: "Comp Report 2026 08 30",
    });
    expect(outcome.routed).toBe(false);
    if (!outcome.routed) expect(outcome.code).toBe("no_family_matched_sender");
  });

  it("still refuses an approved sender's unrelated mail", () => {
    const outcome = routeDelivery({ from: SAMUEL, subject: "Lunch?" });
    expect(outcome.routed).toBe(false);
    if (!outcome.routed) expect(outcome.code).toBe("subject_not_matched");
  });
});

describe("approval for one report is not approval for another", () => {
  it("does not let the Comp Report sender file Sales Totals", () => {
    /*
     * THE WIDENING THIS PREVENTS. Reusing one allowlist for every family would
     * mean anybody cleared for one report could file any report's financials.
     * Samuel is approved for the Comp Report and for nothing else.
     */
    activateSalesTotals();
    expect(familyByKey("sales_totals")!.admitsSender(SAMUEL)).toBe(false);

    const outcome = routeDelivery({ from: SAMUEL, subject: "Sales Totals for 09-02-2026" });
    expect(outcome.routed).toBe(false);
    if (!outcome.routed) expect(outcome.code).toBe("subject_not_matched");
  });

  it("does not let the Sales Totals sender file a Comp Report", () => {
    activateSalesTotals();
    expect(familyByKey("comp_report")!.admitsSender(INVENTED_STC)).toBe(false);

    const outcome = routeDelivery({ from: INVENTED_STC, subject: "Comp Report 2026 08 30" });
    expect(outcome.routed).toBe(false);
  });

  it("refuses a lookalike domain and a subaddressed variant", () => {
    activateSalesTotals();
    const family = familyByKey("sales_totals")!;
    expect(family.admitsSender("stc-reports@invented.test.evil.test")).toBe(false);
    expect(family.admitsSender("stc-reports+tag@invented.test")).toBe(false);
  });

  it("prefers the bracketed address over anything in a display name", () => {
    // A display name can carry a real approved address to be mistaken for the
    // sender. The transport's address is the one that counts.
    activateSalesTotals();
    expect(
      familyByKey("sales_totals")!.admitsSender(`"${INVENTED_STC}" <attacker@invented.test>`),
    ).toBe(false);
  });
});

describe("the content has the last word", () => {
  it("recognises a Sales Totals document by structure, not extension", async () => {
    const family = familyByKey("sales_totals")!;
    // HTML named .xls — the extension is never consulted.
    expect(await family.recognizes(salesTotalsFixtureBytes())).toBe(true);
  });

  it("recognises a Comp Report workbook", async () => {
    const family = familyByKey("comp_report")!;
    expect(await family.recognizes(await buildCombinedCompReportWorkbook())).toBe(true);
  });

  it("does not let either family claim the other's file", async () => {
    const comp = familyByKey("comp_report")!;
    const sales = familyByKey("sales_totals")!;
    expect(await comp.recognizes(salesTotalsFixtureBytes())).toBe(false);
    expect(await sales.recognizes(await buildCombinedCompReportWorkbook())).toBe(false);
  });

  it("refuses a delivery whose headers and attachment disagree", async () => {
    /*
     * A From address and a subject are forgeable; a file's structure is not.
     * Headers claiming Comp Report with a Sales Totals attachment must not be
     * handed to the Comp Report parser — and the refusal names what the file
     * actually was, because a mis-sent report and an unrecognised one are
     * different operational problems.
     */
    const outcome = await confirmFamilyContent(
      familyByKey("comp_report")!,
      salesTotalsFixtureBytes(),
    );
    expect(outcome.routed).toBe(false);
    if (!outcome.routed) {
      expect(outcome.code).toBe("content_not_recognised");
      expect(outcome.family?.key).toBe("sales_totals");
    }
  });

  it("refuses a file that is neither family", async () => {
    const outcome = await confirmFamilyContent(
      familyByKey("sales_totals")!,
      new TextEncoder().encode("<html><title>Payroll</title><table><tr><td>x</td></tr></table>"),
    );
    expect(outcome.routed).toBe(false);
    if (!outcome.routed) expect(outcome.family?.key).toBe("sales_totals");
  });

  it("never throws on rubbish bytes", async () => {
    const rubbish = new Uint8Array([0, 1, 2, 3, 255, 254]);
    for (const family of REPORT_FAMILIES) {
      await expect(family.recognizes(rubbish)).resolves.toBe(false);
    }
  });
});

describe("readiness reporting", () => {
  it("reports activation per family without leaking a value", () => {
    activateSalesTotals();
    const readiness = familyReadiness();
    expect(readiness.map((entry) => entry.key)).toEqual(["comp_report", "sales_totals"]);
    expect(readiness.every((entry) => entry.activated)).toBe(true);

    const serialized = JSON.stringify(readiness);
    // Variable NAMES may appear; addresses may not.
    expect(serialized).not.toContain(SAMUEL);
    expect(serialized).not.toContain(INVENTED_STC);
    expect(serialized).not.toContain("sales totals");
  });

  it("names the missing variables when a family is not activated", () => {
    const salesTotals = familyReadiness().find((entry) => entry.key === "sales_totals")!;
    expect(salesTotals.activated).toBe(false);
    expect(salesTotals.gaps.join(" ")).toContain(SALES_TOTALS_SENDERS_ENV);
    expect(salesTotals.gaps.join(" ")).toContain(SALES_TOTALS_SUBJECT_ENV);
  });
});
