import { describe, expect, it, vi } from "vitest";

/*
 * QA's code audit on main 9e1d1f67 (item 29): a period list ("who got a CA this month?") read at most 100 rows, then
 * filtered them by what this manager may see, and called the list complete when fewer than 100 were LEFT, so rows the
 * read had cut off were never counted. The replay harness's actor sees every row (no filter runs there), so this test
 * fakes the two halves: the database read returns its full 100, and the visibility filter keeps 60.
 */
const read = vi.hoisted(() => ({ rows: 100, visible: 60 }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/forms/instances", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/instances")>()),
  listInstances: async () =>
    Array.from({ length: read.rows }, (_, index) => ({
      id: `inst-${index}`,
      templateName: "Corrective Action Form",
      templateKey: "dpoa",
      employeeName: `Person ${index}`,
      status: "finalized",
      formDate: "2026-11-10",
      locationId: "loc-0309",
      locationName: "NE Kearney",
      createdAt: "2026-11-10T15:00:00Z",
    })),
}));
vi.mock("@/lib/forms/instance-scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/instance-scope")>()),
  visibleInstances: <T,>(_actor: unknown, rows: T[]) => rows.slice(0, read.visible),
  instanceListFilterFor: () => ({}),
}));
vi.mock("@/lib/forms/chat-form-records", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/chat-form-records")>()),
  chatFormsActor: async () => ({ id: "manager-1", role: "salon_director", verified: true, scope: null, visibility: null }),
}));

const { findPastForms } = await import("./tools");

const SAID = "list every form this month";
const context = {
  actor: { subject: "manager-1", role: "salon_director", scope: { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] } },
  question: SAID,
  questionMessageId: "m1",
  history: [],
  today: "2026-11-14",
} as never;
const input = { date_from: "11/01/2026", date_to: "11/30/2026", forms_on_file_evidence: { message_id: "m1", quote: SAID } };

describe("a period list's completeness (item 29)", () => {
  /*
   * Changed on purpose (QA's f081, 20 Nov 2026): the period is now read up to 1000 rows (it was 100) and up to 100 are
   * listed, so "full" is a read of 1000. The rule is the same: a full read is never complete, whatever the filter leaves.
   */
  it("a read that came back full (1000 rows) is never complete, however many rows the visibility filter leaves", async () => {
    read.rows = 1000;
    read.visible = 600;
    const result = (await findPastForms(context, input)) as { forms?: unknown[]; complete?: boolean; counts?: { total?: number } };
    expect(result.forms, JSON.stringify(result).slice(0, 300)).toHaveLength(100);
    expect(result.counts?.total).toBe(600);
    expect(result.complete).toBe(false);
  });

  it("a read that came back short (40 rows) is complete", async () => {
    read.rows = 40;
    read.visible = 40;
    const result = (await findPastForms(context, input)) as { complete?: boolean };
    expect(result.complete).toBe(true);
  });
});
