import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessScope } from "@/types";
import type { InstanceListFilter, InstanceRow } from "./instances";

/**
 * The owner, 18 Nov 2026, on the sibling app's Leadership Assistant: asked "who got a CA this month?", the answer was
 * "In the 20 most recent forms I can see … The list is capped at 20, so older November forms may not appear", and the
 * owner asked "why capped at 20". A question that named nobody read the newest 20 forms of every kind and left the
 * model to pick the month's corrective actions out of them. With FORMS_ON_FILE_DATE_RANGE_ENABLED (and always for the
 * AI tools' own date and form inputs) the query is narrowed by form date and form name, every such form is listed up
 * to 100, and the block says whether the list is complete.
 */

const QUESTION = "who got a CA this month?";
const TODAY = "2026-11-18";

const state = vi.hoisted(() => ({
  visibility: null as AccessScope | null,
  listCalls: [] as { limit: number; filter: InstanceListFilter | undefined }[],
  rows: [] as InstanceRow[],
}));

vi.mock("./forms-visibility", () => ({ resolveFormsVisibility: async () => state.visibility }));

/* The query's filters, as the database applies them: before the limit, not after. */
vi.mock("./instances", () => ({
  listInstances: async (limit: number, filter?: InstanceListFilter) => {
    state.listCalls.push({ limit, filter });
    return state.rows
      .filter((row) => !filter?.employeeNameWords || filter.employeeNameWords.some((word) => row.employeeName.toLowerCase().includes(word)))
      .filter((row) => !filter?.templateNameWords || filter.templateNameWords.some((word) => row.templateName.toLowerCase().includes(word)))
      .filter((row) => !filter?.formDateFrom || row.formDate >= filter.formDateFrom)
      .filter((row) => !filter?.formDateTo || row.formDate <= filter.formDateTo)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);
  },
  loadInstance: async () => null,
}));

vi.mock("./repository", () => ({ getTemplateByKey: async () => null }));

const {
  formDateRangeFromQuestion,
  formDateRangeFromInput,
  formKindFromText,
  isFormRangeQuestion,
  loadFormRecords,
} = await import("./chat-form-records");

let next = 0;
function row(overrides: Partial<InstanceRow>): InstanceRow {
  next += 1;
  const formDate = overrides.formDate ?? "2026-11-10";
  return {
    id: `row-${next}`,
    templateId: "t",
    templateKey: "dpoa",
    templateName: "Corrective Action Form",
    templateShortName: "CA",
    layoutFamily: "corrective",
    templateVersionId: "v",
    templateVersion: 1,
    variantKey: null,
    employeeName: `Teammate ${next}`,
    employeeRole: null,
    locationId: "loc-101",
    locationName: "Salon 101",
    createdBy: "someone",
    createdByRole: "salon_director",
    source: "ask_sunny",
    status: "finalized",
    formDate,
    followUpDate: null,
    followedUpAt: null,
    followedUpBy: null,
    finalizedAt: null,
    exportedAt: null,
    revisesInstanceId: null,
    createdAt: `${formDate}T15:00:${String(next % 60).padStart(2, "0")}Z`,
    updatedAt: `${formDate}T15:00:00Z`,
    ...overrides,
  } as InstanceRow;
}

const ADMIN = {
  subject: "user-1",
  verified: true,
  role: "admin" as const,
  scope: { level: "global" as const, primaryAreaId: null, alsoCoversAreaIds: [] },
};

beforeEach(() => {
  state.visibility = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] } as unknown as AccessScope;
  state.listCalls = [];
  state.rows = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** November's 25 CAs, newer coaching forms that push them out of a newest-20 read, and October's CAs. */
function busyNovember(): void {
  for (let day = 1; day <= 25; day += 1) {
    state.rows.push(row({ formDate: `2026-11-${String(Math.min(day, 18)).padStart(2, "0")}`, employeeName: `Corrin Vale ${day}` }));
  }
  for (let i = 0; i < 20; i += 1) {
    state.rows.push(row({ formDate: "2026-11-18", templateName: "Coaching Form", templateKey: "coaching", employeeName: `Coached Person ${i}`, createdAt: `2026-11-18T23:00:${String(i).padStart(2, "0")}Z` }));
  }
  state.rows.push(row({ formDate: "2026-10-30", employeeName: "October Person" }));
}

describe("the owner's question: who got a CA this month?", () => {
  it("before: the newest 20 forms of every kind, so November's CAs are cut off", async () => {
    busyNovember();
    const read = await loadFormRecords({ actor: ADMIN, question: QUESTION, today: TODAY });
    expect(state.listCalls.at(-1)!.limit).toBe(20);
    expect(read!.block).toContain("20 most recent forms");
    expect(read!.block).not.toContain("Corrin Vale");
  });

  it("after: every November CA, read by form date and form name in the query", async () => {
    busyNovember();
    const read = await loadFormRecords({ actor: ADMIN, question: QUESTION, today: TODAY, narrowFromQuestion: true });
    const call = state.listCalls.at(-1)!;
    expect(call.limit).toBe(100);
    expect(call.filter).toMatchObject({ formDateFrom: "2026-11-01", formDateTo: TODAY, templateNameWords: ["corrective"] });
    const block = read!.block;
    for (let day = 1; day <= 25; day += 1) expect(block).toContain(`Corrin Vale ${day};`);
    expect(block).not.toContain("Coached Person");
    expect(block).not.toContain("October Person");
    expect(block).toContain("Every Corrective Action form dated this month (November 2026) (2026-11-01 to 2026-11-18) this user can see (25)");
    expect(block).toContain("Never say the list is capped");
    expect(block).not.toContain("most recent");
  });

  it("says so when the list reaches its cap of 100", async () => {
    for (let i = 0; i < 130; i += 1) state.rows.push(row({ formDate: "2026-11-05" }));
    const read = await loadFormRecords({ actor: ADMIN, question: QUESTION, today: TODAY, narrowFromQuestion: true });
    expect(read!.block).toContain("This list stops at 100 forms");
  });

  it("a named person in a period reads only their forms in it", async () => {
    busyNovember();
    state.rows.push(row({ formDate: "2026-11-12", employeeName: "Wren Halvorsen" }), row({ formDate: "2026-09-02", employeeName: "Wren Halvorsen" }));
    const read = await loadFormRecords({ actor: ADMIN, question: "did Wren Halvorsen get a CA this month?", today: TODAY, narrowFromQuestion: true });
    expect(read!.block).toContain("2026-11-12 — Corrective Action Form");
    expect(read!.block).not.toContain("2026-09-02");
  });

  it("an explicit tool range and kind win over the question", async () => {
    busyNovember();
    await loadFormRecords({
      actor: ADMIN,
      question: "forms",
      today: TODAY,
      range: formDateRangeFromInput("2026-10-01", "2026-10-31", TODAY),
      kind: formKindFromText("corrective action"),
    });
    expect(state.listCalls.at(-1)!.filter).toMatchObject({ formDateFrom: "2026-10-01", formDateTo: "2026-10-31", templateNameWords: ["corrective"] });
  });
});

describe("formDateRangeFromQuestion (today Wednesday 18 Nov 2026)", () => {
  it.each([
    [QUESTION, "2026-11-01", "2026-11-18"],
    ["CAs last month", "2026-10-01", "2026-10-31"],
    ["coachings in October", "2026-10-01", "2026-10-31"],
    ["write-ups in December", "2025-12-01", "2025-12-31"],
    ["any CAs last week", "2026-11-09", "2026-11-15"],
    ["coachings this week", "2026-11-16", "2026-11-18"],
    ["CAs since 11/1", "2026-11-01", "2026-11-18"],
    ["CAs in the last 30 days", "2026-10-20", "2026-11-18"],
    ["CAs today", "2026-11-18", "2026-11-18"],
    ["exit forms this year", "2026-01-01", "2026-11-18"],
  ])("%s", (question, from, to) => {
    expect(formDateRangeFromQuestion(question, TODAY)).toMatchObject({ from, to });
  });

  it("no period, no range", () => {
    expect(formDateRangeFromQuestion("does Wren have previous coachings", TODAY)).toBeNull();
    expect(formDateRangeFromQuestion("she may be late", TODAY)).toBeNull();
  });
});

describe("formKindFromText", () => {
  it.each([
    [QUESTION, "corrective"],
    ["who was written up", "corrective"],
    ["coachings last week", "coaching"],
    ["follow-up coachings", "follow"],
    ["exit forms this month", "exit"],
    ["EPPs this month", "epp"],
  ])("%s", (text, word) => {
    expect(formKindFromText(text)?.templateNameWords).toContain(word);
  });
});

describe("isFormRangeQuestion", () => {
  it.each([QUESTION, "how many coachings last week", "show me October's write-ups", "which employees got a CA in november"])("reads %s", (question) => {
    expect(isFormRangeQuestion(question, TODAY)).toBe(true);
  });

  it.each(["make a CA for Wren for last week", "what is our corrective action process?", "who is working today"])("leaves %s alone", (question) => {
    expect(isFormRangeQuestion(question, TODAY)).toBe(false);
  });
});
