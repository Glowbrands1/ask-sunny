import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { FormsActor } from "./access";
import type { InstanceListFilter, InstanceRow } from "./instances";

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => {
    throw new Error("no database in this test");
  },
}));

const {
  EMPLOYEE_SEARCH_LIMIT,
  employeeSearchWords,
  mayUseEmployeeFormSearch,
  nameHasEveryWord,
  parseEmployeeSearchStatus,
  searchFormsByEmployee,
} = await import("./employee-form-search");

/*
 * FIND AN EMPLOYEE'S FORMS (leadership meeting, 24 Nov 2026). HR: "if she's going back and trying to track like a CA
 * for someone specific, she could type in their name and it would pull up with anything that's been drafted or
 * approved or whatever those filters are". Pau: HR and admins only, a search bar on the forms list in both apps, every
 * past form for that person including drafts, with the date, and openable. Invented names only.
 */

const HR = "11111111-1111-4111-8111-111111111111";
const MANAGER = "22222222-2222-4222-8222-222222222222";

function actor(overrides: Partial<FormsActor> = {}): FormsActor {
  return { id: HR, role: "regional_manager", verified: true, scope: null, visibility: null, hrApprover: true, ...overrides };
}

function row(overrides: Partial<InstanceRow>): InstanceRow {
  return {
    id: "f-1",
    templateId: "tpl",
    templateKey: "corrective_action",
    templateName: "Corrective Action Form",
    templateShortName: "Corrective Action",
    layoutFamily: "corrective_action",
    templateVersionId: "v",
    templateVersion: 3,
    variantKey: null,
    employeeName: "Wren Oakhollow",
    employeeRole: null,
    locationId: "loc-a",
    locationName: "Location A",
    createdBy: MANAGER,
    createdByRole: "salon_director",
    source: "ask_sunny",
    status: "finalized",
    formDate: "2026-05-01",
    followUpDate: null,
    followedUpAt: null,
    followedUpBy: null,
    finalizedAt: null,
    exportedAt: null,
    revisesInstanceId: null,
    createdAt: "2026-05-01T15:00:00Z",
    updatedAt: "2026-05-01T15:00:00Z",
    hrApprovalState: null,
    hrApprovalRequestedAt: null,
    hrApprovalRequestedBy: null,
    hrApprovalSenders: [],
    ...overrides,
  };
}

describe("who is offered the search", () => {
  it("HR approvers and the administrator roles; no other manager", () => {
    expect(mayUseEmployeeFormSearch({ hrApprover: true, role: "regional_manager" })).toBe(true);
    for (const role of ["admin", "owner", "developer"] as const) {
      expect(mayUseEmployeeFormSearch({ hrApprover: false, role }), role).toBe(true);
    }
    for (const role of ["employee", "assistant_salon_director", "salon_director", "district_manager", "regional_manager"] as const) {
      expect(mayUseEmployeeFormSearch({ hrApprover: false, role }), role).toBe(false);
    }
    expect(mayUseEmployeeFormSearch({ role: null })).toBe(false);
  });
});

describe("what is searched", () => {
  it("takes the letters of the name, folded, two letters or more", () => {
    expect(employeeSearchWords("  Wren  OAKHOLLOW ")).toEqual(["wren", "oakhollow"]);
    expect(employeeSearchWords("Lucía Ramírez")).toEqual(["lucia", "ramirez"]);
    expect(employeeSearchWords("O'Brien-Vale, J.")).toEqual(["brien", "vale"]);
    expect(employeeSearchWords("j")).toEqual([]);
    expect(employeeSearchWords("*),created_by.eq.x")).toEqual(["created", "by", "eq"]);
    expect(employeeSearchWords("")).toEqual([]);
  });

  it("a row matches only when every word is in its name, in any order, accents or not", () => {
    expect(nameHasEveryWord("Wren Oakhollow", ["oakhollow", "wren"])).toBe(true);
    expect(nameHasEveryWord("Wren Thistledown", ["wren", "oakhollow"])).toBe(false);
    expect(nameHasEveryWord("Lucía Ramírez", ["lucia"])).toBe(true);
  });
});

describe("searchFormsByEmployee", () => {
  it("lists every form on file for the person — drafts, finalized, revised — newest first, past the list's 200 rows", async () => {
    const calls: { limit: number | undefined; filter: InstanceListFilter | undefined }[] = [];
    const read = async (limit?: number, filter?: InstanceListFilter) => {
      calls.push({ limit, filter });
      return [
        row({ id: "old-ca", formDate: "2026-02-10", status: "finalized" }),
        row({ id: "draft", formDate: "2026-11-20", status: "draft", createdBy: HR }),
        row({ id: "other-wren", employeeName: "Wren Thistledown", formDate: "2026-11-21" }),
        row({ id: "revised", formDate: "2026-06-01", status: "revised", templateShortName: "Coaching" }),
      ];
    };
    const search = await searchFormsByEmployee(actor(), "wren oakhollow", {
      filter: { locationIds: ["loc-a"], ownCreatedBy: HR },
      keep: (rows) => rows,
      read,
      names: async () => new Map([[MANAGER, "Pella Brightwater"]]),
    });

    // One read of its own, by name, under the list's own filter — not a filter over the newest 200.
    expect(calls).toEqual([
      { limit: EMPLOYEE_SEARCH_LIMIT, filter: { locationIds: ["loc-a"], ownCreatedBy: HR, employeeNameWords: ["wren", "oakhollow"] } },
    ]);
    expect(search.results.map((result) => [result.id, result.status, result.formDate])).toEqual([
      ["draft", "draft", "2026-11-20"],
      ["revised", "revised", "2026-06-01"],
      ["old-ca", "finalized", "2026-02-10"],
    ]);
    expect(search.results[0].createdByName).toBe("You");
    expect(search.results[2].createdByName).toBe("Pella Brightwater");
    expect(search.capped).toBe(false);
  });

  it("never lists a row the list's own per-row check refuses", async () => {
    const search = await searchFormsByEmployee(actor(), "Wren", {
      filter: undefined,
      keep: (rows) => rows.filter((entry) => entry.locationId === "loc-a"),
      read: async () => [row({ id: "mine" }), row({ id: "elsewhere", locationId: "loc-z" })],
      names: async () => new Map(),
    });
    expect(search.results.map((result) => result.id)).toEqual(["mine"]);
  });

  it("says where HR stands only to a reader who may know", async () => {
    const pending = row({ id: "p", hrApprovalState: "pending", hrApprovalRequestedBy: MANAGER, hrApprovalSenders: [MANAGER] });
    const options = { filter: undefined, keep: (rows: InstanceRow[]) => rows, read: async () => [pending], names: async () => new Map() };
    expect((await searchFormsByEmployee(actor(), "wren", options)).results[0].hrNote).toBe("Waiting for HR");
    const admin = actor({ id: "33333333-3333-4333-8333-333333333333", role: "admin", hrApprover: false });
    expect((await searchFormsByEmployee(admin, "wren", options)).results[0].hrNote).toBeNull();
  });

  it("filters by status: drafts, finalized (revised included), approved by HR", async () => {
    const rows = [
      row({ id: "draft", status: "draft" }),
      row({ id: "final", status: "finalized" }),
      row({ id: "revised", status: "revised" }),
      row({ id: "approved", status: "finalized", hrApprovalState: "approved", hrApprovalSenders: [MANAGER] }),
    ];
    const ids = async (status: string) =>
      (
        await searchFormsByEmployee(actor(), "wren", {
          filter: undefined,
          keep: (kept) => kept,
          read: async () => rows,
          names: async () => new Map(),
          status: parseEmployeeSearchStatus(status),
        })
      ).results
        .map((result) => result.id)
        .sort();
    expect(await ids("all")).toEqual(["approved", "draft", "final", "revised"]);
    expect(await ids("draft")).toEqual(["draft"]);
    expect(await ids("finalized")).toEqual(["approved", "final", "revised"]);
    expect(await ids("hr_approved")).toEqual(["approved"]);
    expect(await ids("nonsense")).toEqual(["approved", "draft", "final", "revised"]);
  });

  it("reads nothing when nothing searchable was typed", async () => {
    const read = vi.fn(async () => [row({})]);
    const search = await searchFormsByEmployee(actor(), "j", { filter: undefined, keep: (rows) => rows, read });
    expect(read).not.toHaveBeenCalled();
    expect(search.results).toEqual([]);
  });

  it("says when the read stopped at its limit", async () => {
    const rows = Array.from({ length: EMPLOYEE_SEARCH_LIMIT }, (_, index) => row({ id: `f-${index}` }));
    const search = await searchFormsByEmployee(actor(), "wren", {
      filter: undefined,
      keep: (kept) => kept,
      read: async () => rows,
      names: async () => new Map(),
    });
    expect(search.capped).toBe(true);
  });
});

describe("the forms list page", () => {
  const page = readFileSync("src/app/(app)/forms/monitoring/page.tsx", "utf8");
  it("offers the search only to HR and administrators, and reads it with the list's own filter and per-row check", () => {
    expect(page).toMatch(/mayUseEmployeeFormSearch\(access\.actor\)/);
    expect(page).toMatch(/employeeSearchOffered && typeof requestedEmployee === "string"/);
    expect(page).toMatch(/filter: instanceListFilterFor\(access\.actor\)/);
    expect(page).toMatch(/keep: \(rows\) =>[^\n]*mayRead/);
  });
});
