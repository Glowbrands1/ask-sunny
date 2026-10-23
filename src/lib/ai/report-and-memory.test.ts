import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "./prompts";
import { formatRecalledMemory, memoryCue } from "./chat-memory";
import { formatBreakdown, planReportBreakdown } from "./report-breakdown";
import { loadChatDataBlock } from "./chat-data-tools";

const PROMPT = {
  assistantName: "Sunny",
  brandName: "Sun Tan City",
  salonNoun: "salon",
  context: {
    userName: "Avery Holt",
    locationName: "KS Lawrence",
    todayIso: "2026-10-23",
  },
  mode: "standard" as const,
  hasContext: true,
};

describe("report breakdowns stay off the existing data path", () => {
  it("leaves ordinary review and report questions alone", () => {
    expect(planReportBreakdown("how are our google reviews").kind).toBe("none");
    expect(planReportBreakdown("what was revenue yesterday").kind).toBe("none");
    expect(planReportBreakdown("EFTs on the comp report").kind).toBe("none");
  });

  it("names the dimensions the tables do not store", () => {
    expect(planReportBreakdown("which products sold most").unavailable).toBe("product");
    expect(planReportBreakdown("revenue by employee this month").unavailable).toBe("employee");
    expect(planReportBreakdown("sales by week").unavailable).toBe("week");
    expect(formatBreakdown(planReportBreakdown("which packages sold most"), [], null)).toMatch(/do not store a product/);
  });

  it("plans day, salon, comp, and star reads without inventing a week total", () => {
    const day = planReportBreakdown("revenue by day this week at Lawrence");
    expect(day.kind).toBe("sales");
    expect(day.groupBy).toBe("day");
    expect(day.metric).toBe("grand_total");
    expect(day.note).toMatch(/not added into a week/);

    const eft = planReportBreakdown("EFTs by salon MTD vs last month");
    expect(eft.kind).toBe("sales");
    expect(eft.metric).toBe("efts");
    expect(eft.groupBy).toBe("month");
    expect(eft.note).toMatch(/counts, not EFT revenue/);

    const tanners = planReportBreakdown("top salons by unique tanners");
    expect(tanners.kind).toBe("comp");
    expect(tanners.metric).toBe("unique_tanners");

    const stars = planReportBreakdown("how many 1-star reviews at Lawrence");
    expect(stars.kind).toBe("reviews");
    expect(stars.rating).toBe("1");

    const text = formatBreakdown(
      day,
      [{ label: "KS Lawrence", when: "2026-10-22", value: "grand_total 100" }],
      "2026-10-22",
    );
    expect(text).toContain("Sales Totals");
    expect(text).toContain("As of 2026-10-22");
    expect(text).toContain("KS Lawrence");
  });

  it("does not take the breakdown path while the flag is off", async () => {
    delete process.env.REPORT_BREAKDOWN_ENABLED;
    let breakdowns = 0;
    const block = await loadChatDataBlock({
      enabled: true,
      question: "revenue by day this week",
      role: "admin",
      scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
      briefedFamilies: [],
      choose: async () => "sales",
      readSales: async () => "SALES TOTALS BLOCK",
      readBreakdown: async () => {
        breakdowns += 1;
        return "should not run";
      },
    });
    expect(breakdowns).toBe(0);
    expect(block.data).toBe("SALES TOTALS BLOCK");
  });
});

describe("chat memory is omitted until the flag supplies a block", () => {
  it("reads a remember sentence and leaves the prompt unchanged without a block", () => {
    expect(memoryCue("remember that my salon is Lawrence")).toEqual({
      kind: "salon",
      key: "default",
      value: "Lawrence",
    });
    expect(memoryCue("remember Avery Holt is a Salon Director at Lawrence")?.kind).toBe("employee");
    expect(memoryCue("remember action plans should be two sentences")?.kind).toBe("preference");
    expect(memoryCue("create a coaching form")).toBeNull();

    const off = buildSystemPrompt(PROMPT);
    const explicit = buildSystemPrompt({ ...PROMPT, recalledMemory: null });
    expect(explicit).toBe(off);
    expect(off).not.toContain("RECALLED MEMORY");
    const on = buildSystemPrompt({
      ...PROMPT,
      recalledMemory: formatRecalledMemory([{ kind: "salon", key: "default", value: "Lawrence" }]),
    });
    expect(on).toContain("RECALLED MEMORY");
    expect(on).toContain("do not grant access");
  });
});
