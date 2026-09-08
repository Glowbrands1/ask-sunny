import { describe, expect, it } from "vitest";

import {
  SPA_FIXTURE_AUTHORIZED_COMPANY,
  SPA_FIXTURE_OTHER_COMPANY,
  spaWellnessFixtureBytes,
} from "../__fixtures__/spa-wellness-workbook";
import { classifyVersusPeers, percentDifference } from "../performance/classification";
import { readWorkbook } from "../workbook";
import { spaEquipmentCode } from "./metric-map";
import { detectSpaWellness, parseSpaWellness, SPA_WELLNESS_PARSER_KEY } from "./parser";

const SCOPE = { company: SPA_FIXTURE_AUTHORIZED_COMPANY };

async function parse(options: Parameters<typeof spaWellnessFixtureBytes>[0] = {}) {
  return parseSpaWellness(await readWorkbook(await spaWellnessFixtureBytes(options)), SCOPE);
}

const HYDRO = spaEquipmentCode("SPA Hydromassage");
const CHAIR = spaEquipmentCode("SPA Massage Chair");
const CALMWAVE = spaEquipmentCode("SPA Calmwave Lounge");
const POLY = spaEquipmentCode("SPA Poly RLT");

describe("report recognition", () => {
  it("recognises the report from its structure", async () => {
    const workbook = await readWorkbook(await spaWellnessFixtureBytes());
    expect(detectSpaWellness(workbook)).toMatchObject({ supported: true });
  });

  it("reports an unrelated workbook as unsupported", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const other = new ExcelJS.Workbook();
    other.addWorksheet("Sheet1").getCell("A1").value = "Payroll register";
    const bytes = new Uint8Array((await other.xlsx.writeBuffer()) as ArrayBuffer);
    expect(detectSpaWellness(await readWorkbook(bytes))).toMatchObject({
      supported: false,
      kind: "unsupported",
    });
  });

  it("reports a renamed total column as drift, because the block would have no end", async () => {
    const workbook = await readWorkbook(
      await spaWellnessFixtureBytes({ totalHeader: "Total Sessions" }),
    );
    const detection = detectSpaWellness(workbook);
    expect(detection).toMatchObject({ supported: false, kind: "template_drift" });
  });

  it("ingests only the window sheets the delivery actually carries", async () => {
    const report = await parse({ sheets: ["MTD"] });
    expect(report.windows.map((window) => window.window)).toEqual(["mtd"]);
    // Absent windows are a smaller report, not a broken one — but they are
    // reported, so nobody concludes YTD is missing from the dashboard.
    expect(report.warnings.join(" ")).toContain("YTD");
  });
});

describe("period extraction", () => {
  it("reads each window's bounds from the sheet's own date column", async () => {
    const report = await parse({ sheets: ["MTD", "YTD", "LTM"] });
    expect(report.windows.map((window) => window.period)).toEqual([
      {
        grain: "mtd",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        fiscalYear: 2026,
        labelRaw: expect.stringContaining("2026-08-01 to 2026-08-31"),
      },
      {
        grain: "ytd",
        periodStart: "2026-01-01",
        periodEnd: "2026-08-31",
        fiscalYear: 2026,
        labelRaw: expect.stringContaining("2026-01-01 to 2026-08-31"),
      },
      {
        grain: "ltm",
        periodStart: "2025-08-31",
        periodEnd: "2026-08-31",
        fiscalYear: 2026,
        labelRaw: expect.stringContaining("2025-08-31 to 2026-08-31"),
      },
    ]);
  });

  it("follows the workbook when the window moves", async () => {
    const report = await parse({
      sheets: ["MTD"],
      mtd: { start: "2027-02-01", end: "2027-02-28" },
    });
    expect(report.windows[0].period.periodEnd).toBe("2027-02-28");
    expect(report.windows[0].period.fiscalYear).toBe(2027);
  });
});

describe("equipment columns are discovered, not numbered", () => {
  it("finds every equipment column between the descriptors and the total", async () => {
    const report = await parse({ sheets: ["MTD"] });
    expect(report.windows[0].equipmentTypes.map((type) => type.label)).toEqual([
      "SPA Hydromassage",
      "SPA Massage Chair",
      "SPA Poly RLT",
      "SPA Calmwave Lounge",
      "Other",
    ]);
  });

  it("recognises an equipment type no application list contains", async () => {
    // The requirement in one test: a type first seen in a delivery must not
    // need a deployment to be reported.
    const report = await parse({ sheets: ["MTD"] });
    const novel = report.windows[0].equipmentTypes.find((type) => type.code === CALMWAVE);
    expect(novel).toMatchObject({ label: "SPA Calmwave Lounge", isComparable: true });
    expect(
      report.windows[0].equipmentUse.some((use) => use.equipmentCode === CALMWAVE),
    ).toBe(true);
  });

  it("picks up an equipment column added at the end of the block", async () => {
    const report = await parse({ sheets: ["MTD"], extraEquipment: "SPA Aurora Cryopod" });
    expect(report.windows[0].equipmentTypes.map((type) => type.code)).toContain(
      spaEquipmentCode("SPA Aurora Cryopod"),
    );
  });

  it("does not mistake a descriptor named `SPA ...` for equipment", async () => {
    const report = await parse({ sheets: ["MTD"] });
    const codes = report.windows[0].equipmentTypes.map((type) => type.code);
    expect(codes).not.toContain(spaEquipmentCode("SPA Equipment First Use"));
  });

  it("does not read past the total into retail revenue", async () => {
    // `SPA Products Net Sales` is dollars. Read as equipment it would be the
    // best-performing machine in the estate.
    const report = await parse({ sheets: ["MTD"] });
    const codes = report.windows[0].equipmentTypes.map((type) => type.code);
    expect(codes).not.toContain(spaEquipmentCode("SPA Products Net Sales"));
    expect(codes).not.toContain(spaEquipmentCode("BOT Restored Prep Spray"));
  });

  it("marks the `Other` bucket as not peer-comparable", async () => {
    // One salon's "Other" and another's are not the same machine.
    const report = await parse({ sheets: ["MTD"] });
    const other = report.windows[0].equipmentTypes.find((type) => type.label === "Other")!;
    expect(other.isComparable).toBe(false);
  });

  it("reports an unheadered column inside the block rather than ignoring it silently", async () => {
    const report = await parse({ sheets: ["MTD"], blankEquipmentHeader: true });
    expect(report.warnings.join(" ")).toContain("no header");
  });

  it("refuses the sheet when the equipment columns do not reconcile to its own total", async () => {
    // The check that proves the block's boundaries: a wrong boundary changes
    // the sum, and a wrong sum is a refusal rather than a wrong dashboard.
    await expect(parse({ sheets: ["MTD"], corruptTotalFor: "Calder Vale" })).rejects.toMatchObject({
      code: "template_drift",
    });
  });

  it("derives a stable code from a header", () => {
    expect(spaEquipmentCode("SPA Revive Pro IR Double-Lounge")).toBe(
      "spa_revive_pro_ir_double_lounge",
    );
    expect(spaEquipmentCode("SPA Beauty Angel 7200")).toBe("spa_beauty_angel_7200");
    expect(spaEquipmentCode("Other")).toBe("other");
    // A code must not begin with a digit; the schema's shape forbids it.
    expect(spaEquipmentCode("360 Wrap")).toBe("spa_360_wrap");
  });
});

describe("zero means NOT INSTALLED", () => {
  it("writes no fact for a blank equipment cell", async () => {
    const report = await parse({ sheets: ["MTD"] });
    const calder = report.windows[0].equipmentUse.filter(
      (use) => use.storeName === "Calder Vale",
    );
    // Calder Vale uses Hydromassage and Massage Chair. It has no Poly RLT row
    // at all — not a row with a zero in it.
    expect(calder.map((use) => use.equipmentCode).sort()).toEqual([HYDRO, CHAIR].sort());
    expect(calder.some((use) => use.sessions === 0)).toBe(false);
  });

  it("writes no fact for an EXPLICIT zero either", async () => {
    const report = await parse({ sheets: ["MTD"] });
    const brookmere = report.windows[0].equipmentUse.filter(
      (use) => use.storeName === "Brookmere Park",
    );
    // Brookmere Park's Massage Chair cell holds a literal 0.
    expect(brookmere.map((use) => use.equipmentCode)).not.toContain(CHAIR);
  });

  it("counts a non-installed cell in diagnostics, so the absence is visible", async () => {
    const report = await parse({ sheets: ["MTD"] });
    // Three salons x five equipment columns = 15 cells. Eight are used
    // (3 + 3 + 2), so seven are absences — one of them an explicit zero.
    expect(report.windows[0].diagnostics.notInstalledCells).toBe(7);
  });

  it("counts equipment TYPES from what was used, not from the column count", async () => {
    const report = await parse({ sheets: ["MTD"] });
    const salons = report.windows[0].salons;
    expect(salons.find((salon) => salon.storeName === "Aurora Springs")!.equipmentTypesUsed).toBe(3);
    expect(salons.find((salon) => salon.storeName === "Calder Vale")!.equipmentTypesUsed).toBe(2);
  });

  it("keeps installed UNITS separate from used TYPES", async () => {
    // Aurora Springs has four units and used three types — one type has two
    // machines. Conflating them understates the estate's capital.
    const report = await parse({ sheets: ["MTD"] });
    const aurora = report.windows[0].salons.find(
      (salon) => salon.storeName === "Aurora Springs",
    )!;
    expect(aurora.equipmentPieces).toBe(4);
    expect(aurora.equipmentTypesUsed).toBe(3);
  });
});

describe("like-for-like peer comparison", () => {
  it("averages peers over INSTALLED peers only", async () => {
    const report = await parse({ sheets: ["MTD"] });
    const hydro = report.windows[0].benchmarks.find(
      (entry) => entry.equipmentCode === HYDRO,
    )!;
    // All six salons use Hydromassage; the three peers average 500.
    expect(hydro.peerSalonCount).toBe(3);
    expect(hydro.peerAverageSessions).toBeCloseTo(500, 10);
    expect(hydro.chainSalonCount).toBe(6);
    expect(hydro.chainAverageSessions).toBeCloseTo(350, 10);
  });

  it("excludes salons without the equipment from BOTH sides of the comparison", async () => {
    const report = await parse({ sheets: ["MTD"] });
    const chair = report.windows[0].benchmarks.find(
      (entry) => entry.equipmentCode === CHAIR,
    )!;
    // Four of six salons used a Massage Chair: ours at Aurora (40) and Calder
    // (120), peers at Dunmore (500) and Eastmoor (700). Brookmere's explicit
    // zero and Fenwick's blank are absences, on either side.
    expect(chair.peerSalonCount).toBe(2);
    expect(chair.peerAverageSessions).toBeCloseTo(600, 10);
    expect(chair.chainSalonCount).toBe(4);
  });

  it("computes the delta against installed peers, which is a different answer", async () => {
    const report = await parse({ sheets: ["MTD"] });
    const window = report.windows[0];
    const hydro = window.benchmarks.find((entry) => entry.equipmentCode === HYDRO)!;
    const ours = window.equipmentUse.filter((use) => use.equipmentCode === HYDRO);
    const ourAverage = ours.reduce((total, use) => total + use.sessions, 0) / ours.length;
    expect(ourAverage).toBeCloseTo(200, 10);
    expect(percentDifference(ourAverage, hydro.peerAverageSessions)).toBeCloseTo(-60, 10);
    // Against the whole chain it would be -42.86%, which is the wrong answer.
    expect(percentDifference(ourAverage, hydro.chainAverageSessions)).toBeCloseTo(-42.857, 3);
  });

  it("leaves an equipment type nobody else has without a peer average", async () => {
    const report = await parse({
      sheets: ["MTD"],
      salons: [
        {
          salon: "Aurora Springs",
          company: SPA_FIXTURE_AUTHORIZED_COMPANY,
          district: "Hale, Rowan",
          region: "Vance, Imogen",
          use: { "SPA Calmwave Lounge": 30 },
          pieces: 1,
        },
        {
          salon: "Dunmore Cross",
          company: SPA_FIXTURE_OTHER_COMPANY,
          district: "Sable, Marek",
          region: "Quill, Teodor",
          use: { "SPA Hydromassage": 400 },
          pieces: 1,
        },
      ],
    });
    const calmwave = report.windows[0].benchmarks.find(
      (entry) => entry.equipmentCode === CALMWAVE,
    )!;
    expect(calmwave.peerSalonCount).toBe(0);
    // Null, not zero: nobody to compare with is not a comparison of zero.
    expect(calmwave.peerAverageSessions).toBeNull();
    expect(classifyVersusPeers(percentDifference(30, calmwave.peerAverageSessions))).toBeNull();
  });

  it("carries no peer salon name or company into the benchmark", async () => {
    const report = await parse({ sheets: ["MTD"] });
    const serialised = JSON.stringify(report.windows.map((window) => window.benchmarks));
    expect(serialised).not.toContain(SPA_FIXTURE_OTHER_COMPANY);
    for (const name of ["Dunmore Cross", "Eastmoor Row", "Fenwick Gate"]) {
      expect(serialised).not.toContain(name);
    }
  });
});

describe("peer performance classification", () => {
  it("uses the approved spa bands, which are wider than the bed usage ones", () => {
    expect(classifyVersusPeers(10)).toBe("outperforming");
    expect(classifyVersusPeers(9.99)).toBe("at_market");
    expect(classifyVersusPeers(-5)).toBe("at_market");
    expect(classifyVersusPeers(-5.01)).toBe("below_market");
    expect(classifyVersusPeers(-14.99)).toBe("below_market");
    expect(classifyVersusPeers(-15)).toBe("significantly_underperforming");
  });

  it("classifies the fixture's Poly RLT as at market", async () => {
    const report = await parse({ sheets: ["MTD"] });
    const window = report.windows[0];
    const poly = window.benchmarks.find((entry) => entry.equipmentCode === POLY)!;
    const ours = window.equipmentUse.filter((use) => use.equipmentCode === POLY);
    const ourAverage = ours.reduce((total, use) => total + use.sessions, 0) / ours.length;
    // Ours: 60 and 90 -> 75. Peers: Dunmore's 150 -> a 50% shortfall.
    expect(ourAverage).toBeCloseTo(75, 10);
    expect(poly.peerAverageSessions).toBeCloseTo(150, 10);
    expect(
      classifyVersusPeers(percentDifference(ourAverage, poly.peerAverageSessions)),
    ).toBe("significantly_underperforming");
  });
});

describe("company scoping", () => {
  it("keeps only the authorized company's salon rows", async () => {
    const report = await parse({ sheets: ["MTD"] });
    expect(report.windows[0].salons.map((salon) => salon.storeName)).toEqual([
      "Aurora Springs",
      "Brookmere Park",
      "Calder Vale",
    ]);
  });

  it("names no other company's salon anywhere in the parsed report", async () => {
    const report = await parse();
    const serialised = JSON.stringify(report);
    expect(serialised).not.toContain(SPA_FIXTURE_OTHER_COMPANY);
    for (const name of ["Dunmore Cross", "Eastmoor Row", "Fenwick Gate"]) {
      expect(serialised).not.toContain(name);
    }
  });

  it("refuses a delivery with no rows for the authorized company", async () => {
    const bytes = await spaWellnessFixtureBytes();
    await expect(
      async () => parseSpaWellness(await readWorkbook(bytes), { company: "Someone Else Ltd" }),
    ).rejects.toMatchObject({ code: "authorized_company_absent" });
  });
});

describe("totals and first-use information", () => {
  it("takes the total from the source rather than recomputing it", async () => {
    const report = await parse({ sheets: ["MTD"] });
    const aurora = report.windows[0].salons.find(
      (salon) => salon.storeName === "Aurora Springs",
    )!;
    expect(aurora.totalSessions).toBe(200);
  });

  it("scales with the window, so the three are not interchangeable", async () => {
    const report = await parse({ sheets: ["MTD", "YTD"] });
    const mtd = report.windows.find((window) => window.window === "mtd")!;
    const ytd = report.windows.find((window) => window.window === "ytd")!;
    const of = (window: typeof mtd) =>
      window.salons.reduce((total, salon) => total + (salon.totalSessions ?? 0), 0);
    expect(of(ytd)).toBe(of(mtd) * 8);
  });

  it("surfaces the salon's first and newest use dates without inventing a ramp rule", async () => {
    const report = await parse({ sheets: ["MTD"] });
    const brookmere = report.windows[0].salons.find(
      (salon) => salon.storeName === "Brookmere Park",
    )!;
    expect(brookmere.firstUseDate).toBe("2026-07-14");
    expect(brookmere.newestFirstUseDate).toBe("2026-08-02");
  });

  it("reads per-equipment dates from the two date sheets", async () => {
    const report = await parse({ sheets: ["MTD"] });
    expect(report.equipmentDates).toEqual(
      expect.arrayContaining([
        {
          storeName: "Aurora Springs",
          equipmentCode: HYDRO,
          firstUseDate: "2024-02-20",
          lastUseDate: "2026-08-31",
        },
        {
          storeName: "Brookmere Park",
          equipmentCode: CALMWAVE,
          firstUseDate: "2026-08-02",
          lastUseDate: "2026-08-29",
        },
      ]),
    );
  });

  it("reports the date sheets' absence rather than failing", async () => {
    const report = await parse({ sheets: ["MTD"], omitDateSheets: true });
    expect(report.equipmentDates).toHaveLength(0);
    expect(report.warnings.join(" ")).toContain("First Use Dates");
  });

  it("records its parser identity", async () => {
    const report = await parse({ sheets: ["MTD"] });
    expect(report.parserKey).toBe(SPA_WELLNESS_PARSER_KEY);
    expect(report.reportFamily).toBe("spa_wellness");
  });
});
