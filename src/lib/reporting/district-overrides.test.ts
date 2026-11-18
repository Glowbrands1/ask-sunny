import { describe, expect, it } from "vitest";

import {
  correctedDistrictLabel,
  correctedDistrictLabelByStoreName,
} from "./district-overrides";
import { buildIngestionPayload } from "./repository/supabase-reporting-repository";
import { PRODUCTION_SALONS, salonByNumber } from "@/data/salons";

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

  it("moves Liberty and Wornall to Cotton, and Lawrence, Overland Park and Shawnee to Harrison (18 Nov 2026)", () => {
    for (const number of ["0394", "0306"]) expect(correctedDistrictLabel(number, "Patterson, Madeline")).toBe("Cotton, Sarah");
    for (const number of ["0468", "0476", "0463"]) expect(correctedDistrictLabel(number, "Patterson, Madeline")).toBe("Harrison, Shelley");
    expect(correctedDistrictLabelByStoreName("KS Shawnee Mission Pkwy", "Patterson, Madeline")).toBe("Harrison, Shelley");
    for (const salon of PRODUCTION_SALONS) {
      const corrected = correctedDistrictLabel(salon.salonNumber, "Patterson, Madeline");
      if (corrected !== "Patterson, Madeline") expect(corrected).toBe(salon.districtName);
    }
  });

  it("does not touch any other salon", () => {
    // The list lost the five salons moved on 18 Nov 2026 (above).
    for (const number of ["0307", "0495"]) {
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
    expect(byNumber["0468"]).toBe("Harrison, Shelley");
  });

  it("agrees with the roster", () => {
    expect(salonByNumber("0462")?.districtName).toBe("Dugan, Rachael");
  });
});
