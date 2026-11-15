import { beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

import type { InstanceValueRow, LoadedInstance } from "./instances";

/**
 * ============================================================================
 * writeRevisionEdits' managerStated (batch G5, QA approved 15 Nov 2026): THE MANAGER'S STATED PAYROLL ANSWER
 * ============================================================================
 *
 * Only payroll deduct and its amount, and only when the caller passes them, are written as the manager's
 * (saveInstanceValues, as the card's Create); without the option, or for any other key, the write goes to the
 * assistant's writer, which refuses manager fields as before. The harness below is form-write.test.ts's.
 *
 * The one writer over a Coaching Form held in memory. The existing writers
 * (`instances.ts`, protected) are stood in for by fakes that record each call
 * and write the rows the way the real ones do (who filled it, its
 * provenance), so what is asserted is which writer each change went through,
 * that a refusal writes nothing, and what the form holds after. People are
 * invented. Ported from Ask Bubbles (117e33b1), in this app's setting.
 */

const rows = vi.hoisted(() => ({ list: [] as InstanceValueRow[], calls: [] as string[], status: "draft" }));

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
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => ({}) }));

let documentCache: unknown = null;
function form(): LoadedInstance {
  return {
    instance: { id: "inst-1", status: rows.status, variantKey: null, employeeName: "Jane Doe", employeeRole: "Tanning Consultant", locationName: "NE Kearney", formDate: "2026-10-20", templateKey: "coaching" },
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
  put("employee_name", "Wren Ashby", "system");
});

describe("the manager's stated payroll answer", () => {
  it("with the option, \"yes payroll $15\" writes both payroll fields as the manager's", async () => {
    const { writeRevisionEdits } = await import("./form-write");
    await writeRevisionEdits("inst-1", { values: { payroll_deduct_amount: "$15" }, checked: { payroll_deduct: ["yes"] } }, [], {
      actorId: "manager-1",
      latest: "make it a written and yes payroll $15",
      managerStated: ["payroll_deduct", "payroll_deduct_amount"],
    });
    expect(rows.calls.find((call) => call.startsWith("saveInstanceValues:"))?.split(":")[1]?.split(",").sort()).toEqual(["payroll_deduct", "payroll_deduct_amount"]);
  });
  it("without the option, neither goes through the manager's writer (the assistant's writer refuses manager fields, as today)", async () => {
    const { writeRevisionEdits } = await import("./form-write");
    await writeRevisionEdits("inst-1", { values: { payroll_deduct_amount: "$15" }, checked: { payroll_deduct: ["yes"] } }, [], { actorId: "manager-1", latest: "make it a written and yes payroll $15" });
    expect(rows.calls.some((call) => call.startsWith("saveInstanceValues:"))).toBe(false);
  });
  it("with the option, any other key is never written as the manager's, even if passed in", async () => {
    const { writeRevisionEdits } = await import("./form-write");
    await writeRevisionEdits("inst-1", { values: { manager_comments: "Agreed.", payroll_deduct_amount: "$15" } }, [], {
      actorId: "manager-1",
      latest: "yes payroll $15",
      managerStated: ["manager_comments", "employee_signature", "payroll_deduct_amount"],
    });
    const asManager = rows.calls.filter((call) => call.startsWith("saveInstanceValues:")).flatMap((call) => call.split(":")[1]!.split(","));
    expect(asManager).not.toContain("manager_comments");
    expect(asManager).not.toContain("employee_signature");
  });
});
