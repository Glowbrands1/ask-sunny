import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_BUSINESS_TIMEZONE = "America/Chicago";
});
vi.mock("server-only", () => ({}));
const forms = vi.hoisted(() => ({ calls: [] as unknown[], block: "FORMS ON FILE (FORM MONITORING)\n- Wren Halvorsen: Corrective Action, Written Warning, 11/12/2026" as string | null }));
vi.mock("@/lib/forms/chat-form-records", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/chat-form-records")>()),
  loadFormRecords: async (input: unknown) => {
    forms.calls.push(input);
    return forms.block === null ? null : { block: forms.block };
  },
}));

import { __setDataToolDepsForTests } from "@/lib/ai/agent-loop/data-tools";
import type { LoadReportBriefingInput, ReportBriefing } from "@/lib/reporting/read/report-briefing";
import type { AccessScope } from "@/types";

import { APP_TOOLS_NOTE, appTools, lastQuestion } from "./app-tools.server";

/*
 * The owner, 18 Nov 2026: "can AI in DM L10 ... read the reports too in ask sunny please + google review" and
 * "+ previous forms in form monitoring, can know who people got coaching and ca who was terminated etc". The DM L10
 * assistant gets Ask Sunny's own reads, as the signed-in person. Invented people only.
 */

/** A DM over Kearney (0309) and Grand Island (0307). */
const DM: AccessScope = { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: ["loc-0307"] };
const viewer = { userId: "user-dm", role: "district_manager" as const, scope: DM };
const run = async (tools: ReturnType<typeof appTools>, name: string, args: Record<string, unknown>) =>
  (tools[name]!.execute as (a: Record<string, unknown>, o: unknown) => Promise<Record<string, unknown>>)(args, { toolCallId: "t", messages: [] });

const briefings: LoadReportBriefingInput[] = [];
const BRIEFING = { text: "SALON PERFORMANCE — MTD 11/15/2026\nNE Kearney: Total Revenue $41,200 (+3.1% vs 2025)", requested: ["salon-performance"], present: ["salon-performance"], missing: [], periodIntent: null, periods: {}, freshness: [] } as unknown as ReportBriefing;

afterEach(() => {
  __setDataToolDepsForTests(null);
  briefings.length = 0;
  forms.calls.length = 0;
});

describe("the DM L10 assistant reads Ask Sunny's own data", () => {
  it("has read_stats, read_reviews and read_forms_on_file, and the prompt says to use them instead of 'only in the Hub'", () => {
    expect(Object.keys(appTools(viewer, "q")).sort()).toEqual(["read_forms_on_file", "read_reviews", "read_stats"]);
    expect(APP_TOOLS_NOTE).toMatch(/read_stats/);
    expect(APP_TOOLS_NOTE).toMatch(/instead of saying reports are only in the Leadership Hub/);
    expect(APP_TOOLS_NOTE).toMatch(/Never use web search for this company's own figures/);
  });

  it("reads the Comp report (Salon Performance) for the DM's own salons only", async () => {
    __setDataToolDepsForTests({ supabaseReady: async () => true, loadReportBriefing: async (input) => (briefings.push(input), BRIEFING), readBreakdown: async () => null });
    const result = await run(appTools(viewer, "Looking at this Salon Performance view, are we improving?"), "read_stats", { report: "comp" });
    expect(briefings[0]!.scope).toMatchObject({ unrestricted: false, salonNumbers: ["0307", "0309"] });
    expect(JSON.stringify(result.figures)).toContain("NE Kearney: Total Revenue $41,200");
  });

  it("refuses another district's salon and reads nothing about it", async () => {
    __setDataToolDepsForTests({ supabaseReady: async () => true, loadReportBriefing: async (input) => (briefings.push(input), BRIEFING) });
    const result = await run(appTools(viewer, "how is Lawrence doing"), "read_stats", { report: "comp", salon: "Lawrence" });
    expect(result.refused).toBeTruthy();
    expect(briefings).toEqual([]);
  });

  it("reads Form Monitoring as this person (coaching, CAs, terminations), and says so when their role cannot", async () => {
    const result = await run(appTools(viewer, "who got a CA or was terminated this month?"), "read_forms_on_file", { form: "corrective action" });
    expect(forms.calls[0]).toMatchObject({ actor: { subject: "user-dm", verified: true, role: "district_manager", scope: DM } });
    expect((forms.calls[0] as { question: string }).question).toContain("who got a CA or was terminated this month?");
    expect(JSON.stringify(result)).toContain("Wren Halvorsen: Corrective Action, Written Warning");
    forms.block = null;
    expect(await run(appTools(viewer, "q"), "read_forms_on_file", {})).toMatchObject({ refused: expect.stringMatching(/cannot view Form Monitoring/) });
    forms.block = "x";
  });

  /* The owner, 18 Nov 2026 (sibling app): "who got a CA this month?" read "the 20 most recent forms"; "why capped at 20". */
  it("reads a period by form date and kind, not the newest 20 forms", async () => {
    await run(appTools(viewer, "who got a CA this month?"), "read_forms_on_file", { form: "CA", date_from: "2026-11-01", date_to: "2026-11-18" });
    expect(forms.calls[0]).toMatchObject({
      narrowFromQuestion: true,
      range: { from: "2026-11-01", to: "2026-11-18" },
      kind: { templateNameWords: ["corrective"] },
    });
  });

  it("takes the person's latest message as the question", () => {
    expect(lastQuestion([{ role: "user", parts: [{ type: "text", text: "old" }] }, { role: "assistant", parts: [{ type: "text", text: "a" }] }, { role: "user", parts: [{ type: "text", text: "how are google reviews at Kearney" }] }])).toBe("how are google reviews at Kearney");
  });
});
