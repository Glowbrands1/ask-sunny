import { describe, expect, it } from "vitest";

import {
  correctedDistrictLabel,
  correctedDistrictLabelByStoreName,
} from "./district-overrides";
import { buildIngestionPayload } from "./repository/supabase-reporting-repository";
import { salonByNumber } from "@/data/salons";

describe("district overrides", () => {
  it("moves KS Manhattan from Patterson to Dugan", () => {
    expect(correctedDistrictLabel("0462", "Patterson, Madeline")).toBe("Dugan, Rachael");
    expect(correctedDistrictLabelByStoreName("KS Manhattan", "Patterson, Madeline")).toBe(
      "Dugan, Rachael",
    );
  });

  it("is idempotent and stops matching once the workbook is fixed", () => {
    expect(correctedDistrictLabel("0462", "Dugan, Rachael")).toBe("Dugan, Rachael");
  });

  it("leaves an unexpected workbook value alone", () => {
    expect(correctedDistrictLabel("0462", "Cotton, Sarah")).toBe("Cotton, Sarah");
  });

  it("does not touch any other salon, including Patterson's", () => {
    for (const number of ["0306", "0394", "0463", "0468", "0476", "0307", "0495"]) {
      expect(correctedDistrictLabel(number, "Patterson, Madeline")).toBe("Patterson, Madeline");
    }
    expect(correctedDistrictLabel("0462", null)).toBeNull();
  });

  it("applies to comp-sales ingestion payloads", () => {
    const attr = (salonNumber: string) => ({
      salonNumber,
      districtLabel: "Patterson, Madeline",
      regionLabel: "Patterson, Madeline",
    });
    const payload = buildIngestionPayload({
      period: { grain: "mtd", periodEnd: "2026-10-11", periodStart: "2026-10-01", fiscalYear: 2026, labelRaw: "MTD 10/11/2026" },
      salons: [],
      salonPeriodAttributes: [attr("0462"), attr("0468")],
      facts: [],
      warnings: [],
      sourceSheetNames: [],
    } as never);

    const byNumber = Object.fromEntries(payload.attributes.map((a) => [a.salon_number, a.district_label]));
    expect(byNumber["0462"]).toBe("Dugan, Rachael");
    expect(byNumber["0468"]).toBe("Patterson, Madeline");
  });

  it("agrees with the roster", () => {
    expect(salonByNumber("0462")?.districtName).toBe("Dugan, Rachael");
  });
});
