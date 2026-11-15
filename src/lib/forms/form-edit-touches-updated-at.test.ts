import { beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

import type { InstanceValueRow, LoadedInstance } from "./instances";

/**
 * ============================================================================
 * writeFormEdits (FORM_EDIT_SINGLE_WRITER_ENABLED, Step 2a), ON ITS OWN
 * ============================================================================
 *
 * The one writer over a Coaching Form held in memory. The existing writers
 * (`instances.ts`, protected) are stood in for by fakes that record each call
 * and write the rows the way the real ones do (who filled it, its
 * provenance), so what is asserted is which writer each change went through,
 * that a refusal writes nothing, and what the form holds after. People are
 * invented. Ported from Ask Bubbles (117e33b1), in this app's setting.
 */

/*
 * FORM_EDIT_TOUCHES_UPDATED_AT_ENABLED (QA's batch F8, 15 Nov 2026): a chat edit that writes only values moves the
 * form's updated_at; a failed touch after the values were saved is logged, never a failed edit. Set-up as
 * form-write.test.ts's, with the database standing in as a recorder of instance updates. People are invented.
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
const touched = vi.hoisted(() => ({ updates: [] as { table: string; patch: Record<string, unknown>; id: unknown }[], fail: false }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async (_column: string, id: unknown) => {
          touched.updates.push({ table, patch, id });
          return { error: touched.fail ? { message: "touch failed" } : null };
        },
      }),
    }),
  }),
}));


let documentCache: unknown = null;
function form(): LoadedInstance {
  return {
    instance: { id: "inst-1", status: rows.status, variantKey: null, employeeName: "Jane Doe", employeeRole: "Tanning Consultant", locationName: "NE Kearney", formDate: "2026-10-20", templateKey: "coaching" },
    version: { document: documentCache },
    values: rows.list.map((row) => ({ ...row, checked: [...row.checked] })),
    events: [],
  } as unknown as LoadedInstance;
}

const DETAILS = "Jane was short at the register by $25 at close on 10-20-26.";

beforeEach(async () => {
  documentCache ??= (await import("./library")).coachingDocument();
  rows.list = [];
  rows.calls = [];
  rows.status = "draft";
  touched.updates = [];
  touched.fail = false;
  put("employee_name", "Jane Doe", "system");
  put("coaching_details", DETAILS, "ai");
  put("coaching_topics", ["store_tours"], "ai");
});

describe("FORM_EDIT_TOUCHES_UPDATED_AT_ENABLED", () => {
  const edit = async () => {
    const { writeFormEdits } = await import("./form-write");
    return writeFormEdits("inst-1", [{ op: "set", field: "coaching_topics", value: ["store_tours", "other"] }], { path: "tool", actorId: "qa", latest: "add other to the topics" });
  };
  const instanceTouches = () => touched.updates.filter((update) => update.table === "form_instances" && "updated_at" in update.patch);

  it("on: a value-only edit touches the form's updated_at", async () => {
    const saved = process.env.FORM_EDIT_TOUCHES_UPDATED_AT_ENABLED;
    process.env.FORM_EDIT_TOUCHES_UPDATED_AT_ENABLED = "true";
    try {
      const result = await edit();
      expect(result.handoff).toBeNull();
      expect(instanceTouches()).toEqual([expect.objectContaining({ id: "inst-1" })]);
    } finally {
      if (saved === undefined) delete process.env.FORM_EDIT_TOUCHES_UPDATED_AT_ENABLED;
      else process.env.FORM_EDIT_TOUCHES_UPDATED_AT_ENABLED = saved;
    }
  });

  it("on: a refused edit writes nothing and touches nothing", async () => {
    process.env.FORM_EDIT_TOUCHES_UPDATED_AT_ENABLED = "true";
    try {
      const { writeFormEdits } = await import("./form-write");
      await writeFormEdits("inst-1", [{ op: "set", field: "no_such_line", value: "x" }], { path: "tool", actorId: "qa", latest: "x" });
      expect(instanceTouches()).toEqual([]);
    } finally {
      delete process.env.FORM_EDIT_TOUCHES_UPDATED_AT_ENABLED;
    }
  });

  it("on: a failed touch after the values were saved is logged, never reported as a failed edit (QA's review)", async () => {
    process.env.FORM_EDIT_TOUCHES_UPDATED_AT_ENABLED = "true";
    touched.fail = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await edit();
      expect(result.handoff).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("inst-1"));
    } finally {
      warn.mockRestore();
      delete process.env.FORM_EDIT_TOUCHES_UPDATED_AT_ENABLED;
    }
  });

  it("off: as before, the instance row is not touched", async () => {
    delete process.env.FORM_EDIT_TOUCHES_UPDATED_AT_ENABLED;
    await edit();
    expect(instanceTouches()).toEqual([]);
  });
});
