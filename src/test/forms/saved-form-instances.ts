import type { FieldResponsibility } from "@/lib/forms/document";
import type { InstanceValueRow, LoadedInstance } from "@/lib/forms/instances";

/**
 * ============================================================================
 * A MOCK OF `instances.ts` THAT KEEPS WHAT WAS SAVED (test harness only)
 * ============================================================================
 *
 * FORM_EDIT_SINGLE_WRITER_ENABLED (Step 2b; ported from Ask Bubbles 44856eb0).
 * With the flag on, every form edit
 * goes through `writeFormEdits` (`lib/forms/form-write.ts`), which reads the
 * form with `loadInstance`, writes through the existing writers and reads the
 * form AGAIN to say what really changed. A test that mocked `instances.ts`
 * with only the writers it spied on had no `loadInstance`, so with the flag on
 * it failed for its harness, not for what it tests.
 *
 * `savedFormInstances(writers, base)` keeps the test's own writer mocks — they
 * are still called, with the same arguments, and still return what they
 * return — and adds:
 *
 *   - a store of the rows each writer saved, written the way `instances.ts`
 *     writes them (`saveInstanceValues` the manager's, `applyAssistantDraft`
 *     and `applyAssistantRevision` the assistant's with their provenance, a
 *     revision's clears `system` and `cleared_on_request`, `applyStatedFacts`
 *     `system` and `manager_statement`; a saved Date line moves the form's
 *     date with it);
 *   - `loadInstance(id)`: the form as the test describes it (`base`), with
 *     every saved row over its own — the SAVED state.
 *
 * So with the flag on, the one writer reads back what the test's writers
 * saved, and the test asserts the saved form. With the flag off nothing reads
 * the store and every writer mock behaves exactly as before.
 *
 * Use it from a `vi.mock` factory (which may only reach hoisted state):
 *
 *   vi.mock("./instances", async () =>
 *     (await import("@/test/forms/saved-form-instances")).savedFormInstances(
 *       { saveInstanceValues: async (...) => ..., },
 *       async (id) => (await (await import("./instance-scope")).authorizeInstance(...)).loaded,
 *     ),
 *   );
 *
 * and `resetSavedForms()` in the test file's `beforeEach`.
 */

type DraftLike = { values?: Record<string, string>; checked?: Record<string, readonly string[]> };
type Rows = Map<string, InstanceValueRow>;

/*
 * On `globalThis`, so a test file that calls `vi.resetModules()` (which loads
 * this module again) still has one store, and `resetSavedForms` clears it.
 */
const STORE = Symbol.for("ask-sunny.test.saved-form-instances");
const store: Map<string, Rows> = ((globalThis as Record<symbol, unknown>)[STORE] as Map<string, Rows> | undefined) ?? new Map<string, Rows>();
(globalThis as Record<symbol, unknown>)[STORE] = store;

/** Forgets every saved row: call it in `beforeEach`. */
export function resetSavedForms(): void {
  store.clear();
}

/** The rows saved to `instanceId` so far, by key (for a test that asserts the saved form directly). */
export function savedRows(instanceId: string): Record<string, InstanceValueRow> {
  return Object.fromEntries(store.get(instanceId) ?? new Map());
}

function rowsOf(instanceId: string): Rows {
  let rows = store.get(instanceId);
  if (!rows) {
    rows = new Map();
    store.set(instanceId, rows);
  }
  return rows;
}

function save(
  instanceId: string,
  written: DraftLike,
  filledBy: FieldResponsibility,
  provenance: Readonly<Record<string, Record<string, unknown>>> = {},
): void {
  const rows = rowsOf(instanceId);
  for (const [fieldKey, value] of Object.entries(written.values ?? {})) {
    rows.set(fieldKey, { fieldKey, value, checked: [], filledBy, provenance: provenance[fieldKey] ?? {} });
  }
  for (const [fieldKey, checked] of Object.entries(written.checked ?? {})) {
    rows.set(fieldKey, { fieldKey, value: null, checked: [...checked], filledBy, provenance: provenance[fieldKey] ?? {} });
  }
}

function only(written: DraftLike, keys: readonly string[]): DraftLike {
  const keep = new Set(keys);
  return {
    values: Object.fromEntries(Object.entries(written.values ?? {}).filter(([key]) => keep.has(key))),
    checked: Object.fromEntries(Object.entries(written.checked ?? {}).filter(([key]) => keep.has(key))),
  };
}

function without(written: DraftLike, rejected: readonly { key: string }[] | undefined): DraftLike {
  const refused = new Set((rejected ?? []).map((entry) => entry.key));
  return {
    values: Object.fromEntries(Object.entries(written.values ?? {}).filter(([key]) => !refused.has(key))),
    checked: Object.fromEntries(Object.entries(written.checked ?? {}).filter(([key]) => !refused.has(key))),
  };
}

type AnyAsync = (...args: never[]) => Promise<unknown>;

/** The base form: what the test says is on file before anything is saved. */
export type SavedFormBase = (instanceId: string) => Promise<LoadedInstance | null | undefined> | LoadedInstance | null | undefined;

/**
 * The test's `instances.ts` mock, plus a `loadInstance` that returns the saved
 * state. A `loadInstance` the test wrote itself is kept, with the saved rows
 * laid over what it returns.
 */
export function savedFormInstances<W extends Record<string, unknown>>(writers: W, base: SavedFormBase): W & { loadInstance: (id: string) => Promise<LoadedInstance | null> } {
  const wrapped: Record<string, unknown> = { ...writers };
  const call = (name: string) => writers[name] as AnyAsync | undefined;

  const saveInstanceValues = call("saveInstanceValues");
  if (saveInstanceValues) {
    wrapped.saveInstanceValues = async (id: string, submitted: DraftLike, ...rest: unknown[]) => {
      const result = (await (saveInstanceValues as (...args: unknown[]) => Promise<{ rejected?: { key: string }[]; values?: Record<string, string> }>)(id, submitted, ...rest)) ?? {};
      const accepted = without(submitted, result.rejected);
      save(id, { values: { ...accepted.values, ...only({ values: result.values ?? {} }, Object.keys(accepted.values ?? {})).values }, checked: accepted.checked }, "manager");
      return result;
    };
  }

  const applyAssistantDraft = call("applyAssistantDraft");
  if (applyAssistantDraft) {
    wrapped.applyAssistantDraft = async (id: string, draft: DraftLike, actor: string, provenance: Record<string, Record<string, unknown>> = {}, ...rest: unknown[]) => {
      const result = (await (applyAssistantDraft as (...args: unknown[]) => Promise<{ accepted?: DraftLike }>)(id, draft, actor, provenance, ...rest)) ?? {};
      save(id, result.accepted ?? draft, "ai", provenance);
      return result;
    };
  }

  const applyAssistantRevision = call("applyAssistantRevision");
  if (applyAssistantRevision) {
    wrapped.applyAssistantRevision = async (id: string, draft: DraftLike, cleared: readonly string[] = [], ...rest: unknown[]) => {
      const result = (await (applyAssistantRevision as (...args: unknown[]) => Promise<{ accepted?: DraftLike; cleared?: string[] }>)(id, draft, cleared, ...rest)) ?? {};
      save(id, result.accepted ?? draft, "ai");
      const emptied = result.cleared ?? [...cleared];
      const rows = rowsOf(id);
      for (const key of emptied) {
        const was = rows.get(key);
        const group = was ? was.value === null : false;
        rows.set(key, { fieldKey: key, value: group ? null : "", checked: [], filledBy: "system", provenance: { source: "cleared_on_request", via: "chat_revision" } });
      }
      return result;
    };
  }

  const applyStatedFacts = call("applyStatedFacts");
  if (applyStatedFacts) {
    wrapped.applyStatedFacts = async (id: string, stated: DraftLike, ...rest: unknown[]) => {
      const keys = ((await (applyStatedFacts as (...args: unknown[]) => Promise<string[]>)(id, stated, ...rest)) ?? []) as string[];
      save(id, only(stated, keys), "system", Object.fromEntries(keys.map((key) => [key, { source: "manager_statement" }])));
      return keys;
    };
  }

  const ownLoad = call("loadInstance") as ((id: string) => Promise<LoadedInstance | null>) | undefined;
  wrapped.loadInstance = async (id: string): Promise<LoadedInstance | null> => {
    const loaded = ownLoad ? await ownLoad(id) : await base(id);
    if (!loaded) return null;
    const rows = new Map<string, InstanceValueRow>((loaded.values ?? []).map((row) => [row.fieldKey, { ...row, checked: [...(row.checked ?? [])] }]));
    for (const [key, row] of store.get(id) ?? new Map<string, InstanceValueRow>()) rows.set(key, { ...row, checked: [...row.checked] });
    const date = rows.get("form_date")?.value;
    const movedDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { formDate: date } : {};
    return {
      ...loaded,
      instance: { ...loaded.instance, ...movedDate },
      values: [...rows.values()],
      events: loaded.events ?? [],
    };
  };

  return wrapped as W & { loadInstance: (id: string) => Promise<LoadedInstance | null> };
}
