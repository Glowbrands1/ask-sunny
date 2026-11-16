import { beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

import type { InstanceValueRow, LoadedInstance } from "./instances";

/**
 * ============================================================================
 * nameCorrectionWrite (fix-name, the agent loop rebuild; QA's handoff, 15 Nov 2026): ONLY THE EMPLOYEE'S NAME
 * ============================================================================
 *
 * The agent loop's edit_form intent "correct_name", after its evidence and roster checks, saves the corrected name
 * here: the Employee Name line as the manager's correction (saveInstanceValues, via chat) and the form's subject column
 * with it. Nothing else on the form is written. The words of the old name the manager did not replace are kept, and
 * a form that is not a draft is never written. The harness is form-write-manager-stated.test.ts's (a Corrective
 * Action held in memory, fakes for the protected writers). People are invented.
 */

const rows = vi.hoisted(() => ({ list: [] as InstanceValueRow[], calls: [] as string[], status: "draft", subject: [] as unknown[] }));

function put(fieldKey: string, value: string | string[], filledBy: string, provenance: Record<string, unknown> = {}) {
  const at = rows.list.findIndex((row) => row.fieldKey === fieldKey);
  const row = {
    fieldKey,
    value: typeof value === "string" ? value : null,
    checked: typeof value === "string" ? [] : value,
    filledBy,
    provenance,
  } as unknown as InstanceValueRow;
  if (at >= 0) rows.list[at] = row;
  else rows.list.push(row);
}

vi.mock("./instances", () => ({
  loadInstance: async () => form(),
  saveInstanceValues: async (_id: string, submitted: { values: Record<string, string>; checked: Record<string, string[]> }) => {
    rows.calls.push(`saveInstanceValues:${[...Object.keys(submitted.values), ...Object.keys(submitted.checked)].join(",")}`);
    for (const [key, value] of Object.entries(submitted.values)) put(key, value, "manager");
    for (const [key, value] of Object.entries(submitted.checked)) put(key, value, "manager");
    return { rejected: [], values: submitted.values };
  },
  applyAssistantDraft: async (_id: string, draft: { values?: Record<string, string>; checked?: Record<string, string[]> }, _actor: string, provenance: Record<string, Record<string, unknown>> = {}) => {
    rows.calls.push(`applyAssistantDraft:${[...Object.keys(draft.values ?? {}), ...Object.keys(draft.checked ?? {})].join(",")}`);
    for (const [key, value] of Object.entries(draft.values ?? {})) put(key, value, "ai", provenance[key] ?? {});
    for (const [key, value] of Object.entries(draft.checked ?? {})) put(key, value, "ai", provenance[key] ?? {});
    return { accepted: { values: draft.values ?? {}, checked: draft.checked ?? {} }, rejected: [], policyRefused: [] };
  },
  applyAssistantRevision: async (_id: string, draft: { values?: Record<string, string>; checked?: Record<string, string[]> }, cleared: string[]) => {
    rows.calls.push(`applyAssistantRevision:${[...Object.keys(draft.values ?? {}), ...Object.keys(draft.checked ?? {})].join(",")}|${cleared.join(",")}`);
    for (const [key, value] of Object.entries(draft.values ?? {})) put(key, value, "ai");
    for (const [key, value] of Object.entries(draft.checked ?? {})) put(key, value, "ai");
    for (const key of cleared) put(key, "", "system", { source: "cleared_on_request" });
    return { accepted: { values: draft.values ?? {}, checked: draft.checked ?? {} }, cleared, rejected: [] };
  },
  applyStatedFacts: async (_id: string, stated: { values: Record<string, string>; checked: Record<string, string[]> }) => {
    const keys = [...Object.keys(stated.values), ...Object.keys(stated.checked)];
    rows.calls.push(`applyStatedFacts:${keys.join(",")}`);
    for (const [key, value] of Object.entries(stated.values)) put(key, value, "system", { source: "manager_statement" });
    return keys;
  },
}));
vi.mock("./ca-action-plan-sync", () => ({
  syncCorrectiveActionPlan: async () => {
    rows.calls.push("syncCorrectiveActionPlan");
    return [];
  },
}));
/* The form's subject column (form_instances.employee_name): every update is recorded. */
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          rows.subject.push({ table, ...patch });
          return { error: null };
        },
      }),
    }),
  }),
}));

let documentCache: unknown = null;
function form(): LoadedInstance {
  return {
    instance: { id: "inst-1", status: rows.status, variantKey: null, employeeName: "Remy Calder", employeeRole: "Tanning Consultant", locationName: "NE Kearney", formDate: "2026-10-20", templateKey: "coaching" },
    version: { document: documentCache },
    values: rows.list.map((row) => ({ ...row, checked: [...row.checked] })),
    events: [],
  } as unknown as LoadedInstance;
}


beforeEach(async () => {
  documentCache ??= (await import("./library")).correctiveActionDocument();
  rows.list = [];
  rows.calls = [];
  rows.status = "draft";
  rows.subject = [];
  put("employee_name", "Remy Calder", "system");
  put("observation", "Remy Calder was late to open the salon on 11/10.", "ai");
  put("warning_type", ["written"], "manager");
});

const SAID = "fix her last name, it is Calder-Voss";
const others = () => rows.list.filter((row) => row.fieldKey !== "employee_name").map((row) => [row.fieldKey, row.value, row.checked, row.filledBy]);

describe("nameCorrectionWrite: a name correction saves the name and nothing else", () => {
  it(`"${SAID}" saves Remy Calder-Voss on the Employee Name line, as the manager's, and moves the form's subject`, async () => {
    const { nameCorrectionWrite } = await import("./form-write");
    const before = others();
    const written = await nameCorrectionWrite("inst-1", "Remy Calder-Voss", { actorId: "manager-1", said: SAID, today: "2026-11-15" });
    expect(written.rejected).toEqual([]);
    expect(written.accepted.values).toEqual({ employee_name: "Remy Calder-Voss" });
    expect(rows.calls.filter((call) => !call.startsWith("syncCorrectiveActionPlan"))).toEqual(["saveInstanceValues:employee_name"]);
    expect(rows.list.find((row) => row.fieldKey === "employee_name")).toMatchObject({ value: "Remy Calder-Voss", filledBy: "manager" });
    expect(rows.subject.filter((update) => "employee_name" in (update as object))).toEqual([{ table: "form_instances", employee_name: "Remy Calder-Voss" }]);
    expect(others(), "another field changed with the name").toEqual(before);
  });

  it("a new name that drops a word of the old one the manager did not replace is refused, and nothing is written", async () => {
    const { nameCorrectionWrite } = await import("./form-write");
    const before = rows.list.map((row) => [row.fieldKey, row.value, row.checked]);
    const written = await nameCorrectionWrite("inst-1", "Calder-Voss", { actorId: "manager-1", said: SAID, today: "2026-11-15" });
    expect(written.accepted.values).toEqual({});
    expect(written.rejected.map((row) => row.key)).toEqual(["employee_name"]);
    expect(rows.calls).toEqual([]);
    expect(rows.subject).toEqual([]);
    expect(rows.list.map((row) => [row.fieldKey, row.value, row.checked])).toEqual(before);
  });

  it("a form that is not a draft is never written", async () => {
    rows.status = "finalized";
    const { nameCorrectionWrite } = await import("./form-write");
    const written = await nameCorrectionWrite("inst-1", "Remy Calder-Voss", { actorId: "manager-1", said: SAID, today: "2026-11-15" });
    expect(written.rejected).toEqual([{ key: "employee_name", reason: "not_draft" }]);
    expect(rows.calls).toEqual([]);
    expect(rows.subject).toEqual([]);
  });

  it("an empty name is never written (the name line is never blanked)", async () => {
    const { nameCorrectionWrite } = await import("./form-write");
    const written = await nameCorrectionWrite("inst-1", "   ", { actorId: "manager-1", said: SAID, today: "2026-11-15" });
    expect(written.rejected.map((row) => row.key)).toEqual(["employee_name"]);
    expect(rows.calls).toEqual([]);
    expect(rows.subject).toEqual([]);
  });

  it("the same name again writes nothing and does not move the subject", async () => {
    const { nameCorrectionWrite } = await import("./form-write");
    const written = await nameCorrectionWrite("inst-1", "Remy Calder", { actorId: "manager-1", said: "her name is Remy Calder", today: "2026-11-15" });
    expect(written.accepted.values).toEqual({});
    expect(rows.calls).toEqual([]);
    expect(rows.subject).toEqual([]);
  });
});
