import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * fix-name with FORM_EDIT_SINGLE_WRITER off (QA's review of the fix-name PR, 16 Nov 2026): `managerNameSave` writes the
 * form's subject column (form_instances.employee_name) with the admin client, so it must write it ONLY after the
 * manager's save took the name. A rejected or failed save leaves the column untouched. (That it runs only after
 * `authorizeInstance(…, "edit")` passed is the replay case nov16-fix-name-fallback-*: another manager's turn never reaches
 * it.) People are invented.
 */
const calls = vi.hoisted(() => ({ saves: [] as unknown[], updates: [] as unknown[], rejected: [] as { key: string; reason: string }[], saveThrows: false, updateError: null as null | { message: string } }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/forms/instances", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/instances")>()),
  saveInstanceValues: async (id: string, submitted: unknown, actor: string, options: unknown) => {
    calls.saves.push({ id, submitted, actor, options });
    if (calls.saveThrows) throw new Error("save failed");
    return { rejected: calls.rejected, values: {} };
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async (column: string, value: string) => {
          calls.updates.push({ table, patch, column, value });
          return { error: calls.updateError };
        },
      }),
    }),
  }),
}));

const { managerNameSave } = await import("./tools");

beforeEach(() => {
  calls.saves = [];
  calls.updates = [];
  calls.rejected = [];
  calls.saveThrows = false;
  calls.updateError = null;
});

describe("managerNameSave (fix-name, the one writer off)", () => {
  it("saves employee_name only, as the manager via chat, then moves the form's subject column to the new name", async () => {
    const result = await managerNameSave("inst-1", "Remy Calder-Voss", "manager-1");
    expect(calls.saves).toEqual([{ id: "inst-1", submitted: { values: { employee_name: "Remy Calder-Voss" }, checked: {} }, actor: "manager-1", options: { via: "chat" } }]);
    expect(calls.updates).toEqual([{ table: "form_instances", patch: { employee_name: "Remy Calder-Voss" }, column: "id", value: "inst-1" }]);
    expect(result).toEqual({ accepted: { values: { employee_name: "Remy Calder-Voss" }, checked: {} }, rejected: [] });
  });

  it("a rejected employee_name leaves the subject column untouched and is reported rejected", async () => {
    calls.rejected = [{ key: "employee_name", reason: "system fields are not completed in the app" }];
    const result = await managerNameSave("inst-1", "Remy Calder-Voss", "manager-1");
    expect(calls.updates, "the subject column was written although the name was rejected").toEqual([]);
    expect(result).toEqual({ accepted: { values: {}, checked: {} }, rejected: calls.rejected });
  });

  it("a save that fails leaves the subject column untouched (the error goes up; edit_form reports write_failed)", async () => {
    calls.saveThrows = true;
    await expect(managerNameSave("inst-1", "Remy Calder-Voss", "manager-1")).rejects.toThrow();
    expect(calls.updates).toEqual([]);
  });

  it("with the one writer on it refuses and writes nothing (nameCorrectionWrite saves the name then)", async () => {
    vi.stubEnv("FORM_EDIT_SINGLE_WRITER_ENABLED", "true");
    try {
      await expect(managerNameSave("inst-1", "Remy Calder-Voss", "manager-1")).rejects.toThrow(/flag-off/);
      expect(calls.saves).toEqual([]);
      expect(calls.updates).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("a failed column write is an error, never a silent success", async () => {
    calls.updateError = { message: "db down" };
    await expect(managerNameSave("inst-1", "Remy Calder-Voss", "manager-1")).rejects.toThrow(/employee name/);
  });
});
