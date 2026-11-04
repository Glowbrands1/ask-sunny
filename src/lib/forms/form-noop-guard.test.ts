import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The first test imports the one writer; as in `form-write.test.ts`, more than the default under load.
vi.setConfig({ testTimeout: 30_000 });

import { UNCHANGED_FORM_REPLY, UPDATED_VALUE_MAX, updatedLines, updatedValue } from "./form-diff-reply";
import { applyPatch, copiesMessage, type FormDraft, type FormPatch, type PatchRules } from "./form-reducer";
import type { InstanceValueRow, LoadedInstance } from "./instances";

/**
 * ============================================================================
 * FORM_EDIT_NOOP_GUARD_ENABLED (STEP 4): NO EDIT THAT DOES NOTHING, NO REQUEST
 * COPIED INTO A FIELD, AND THE REPLY FROM THE SAVED DIFF
 * ============================================================================
 *
 * Ported from Ask Bubbles (bdabffbe). The reducer's two new rules on their
 * own, the one writer with them on each path the design names (tool, patch,
 * revision, correction) and off, and the "Updated:" reply. The writer runs over a Coaching Form held in memory, the
 * existing writers stood in for as in `form-write.test.ts`. People invented.
 *
 * The overnight scan's sf-s11, the manager's words: "Can you do the same
 * thing for Perrin Haldane but switch it to a written" written into the
 * account — refused as `copies_message`.
 */

const SF_S11 = "Can you do the same thing for Perrin Haldane but switch it to a written";

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

const DETAILS = "Jane was short at the register by $25 at close on 10-20-26.";

beforeEach(async () => {
  documentCache ??= (await import("./library")).coachingDocument();
  rows.list = [];
  rows.calls = [];
  rows.status = "draft";
  put("employee_name", "Jane Doe", "system");
  put("coaching_details", DETAILS, "ai");
  put("coaching_topics", ["store_tours"], "ai");
});

const FLAGS = ["FORM_EDIT_NOOP_GUARD_ENABLED", "FORM_EDIT_SINGLE_WRITER_ENABLED"] as const;
const savedEnv = new Map(FLAGS.map((name) => [name, process.env[name]]));
function guard(on: boolean) {
  for (const name of FLAGS) delete process.env[name];
  process.env.FORM_EDIT_SINGLE_WRITER_ENABLED = "true";
  if (on) process.env.FORM_EDIT_NOOP_GUARD_ENABLED = "true";
}
afterEach(() => {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

/* ------------------------------------------------------------ reducer ---- */

const draft: FormDraft = {
  details: { key: "details", value: "Jane was late to open on 10-20-26.", owner: "assistant" },
  topics: { key: "topics", value: ["attendance"], owner: "assistant" },
  other: { key: "other", value: "", owner: "empty" },
};
const editRules = (extra: Partial<PatchRules> = {}): PatchRules => ({
  mode: "edit",
  writable: new Set(["details", "topics", "other"]),
  checkboxGroups: { topics: { options: ["attendance", "service"], single: false } },
  sources: { manager: SF_S11, managerTurns: [SF_S11] },
  ...extra,
});
const evidence = { details: SF_S11, topics: SF_S11, other: SF_S11 };

describe("the reducer's rules (absent: unchanged)", () => {
  it("same_value: a set to the value already there, an append already there, a tick already ticked, a clear of an empty field", () => {
    const patch = { set: { details: "Jane was late to open on 10-20-26.", topics: ["attendance"] }, clear: ["other"], how: { details: "add" as const }, evidence };
    expect(applyPatch(draft, patch, editRules()).diff).toEqual({ changed: [], refused: [] });
    expect(applyPatch(draft, patch, editRules({ refuseSameValue: true })).diff.refused).toEqual([
      { key: "details", reason: "same_value" },
      { key: "topics", reason: "same_value" },
      { key: "other", reason: "same_value" },
    ]);
  });

  it("same_value leaves a real change alone", () => {
    const { diff } = applyPatch(draft, { set: { topics: ["attendance", "service"] }, clear: [], evidence }, editRules({ refuseSameValue: true }));
    expect(diff.refused).toEqual([]);
    expect(diff.changed.map((change) => change.key)).toEqual(["topics"]);
  });

  it(`copies_message (sf-s11): "${SF_S11}" appended, or set into an empty line, is refused; without the rule it is written`, () => {
    for (const patch of <FormPatch[]>[
      { set: { details: SF_S11 }, clear: [], how: { details: "add" as const }, evidence },
      { set: { other: `${SF_S11}.` }, clear: [], evidence },
    ]) {
      expect(applyPatch(draft, patch, editRules()).diff.changed.length).toBe(1);
      const { diff } = applyPatch(draft, patch, editRules({ copiesMessage: SF_S11 }));
      expect(diff.changed).toEqual([]);
      expect(diff.refused.map((refusal) => refusal.reason)).toEqual(["copies_message"]);
    }
  });

  it("copies_message needs the whole message, of 3 words or more, compared on fold and on its words", () => {
    expect(copiesMessage(`Observed: ${SF_S11.toUpperCase()}`, SF_S11)).toBe(true);
    expect(copiesMessage("Can you do the same thing, for Perrin Haldane — but switch it to a written!", SF_S11)).toBe(true);
    expect(copiesMessage("Perrin Haldane switched to a written.", SF_S11)).toBe(false);
    expect(copiesMessage("Doe-Smith", "Doe-Smith")).toBe(false);
    expect(copiesMessage("she was late", "she was late")).toBe(true);
  });
});

/* -------------------------------------------------------------- writer --- */

describe("the one writer: the rules on the tool, patch, revision and correction paths", () => {
  const latest = SF_S11;
  for (const path of ["tool", "patch"] as const) {
    it(`${path}: a set to the same value is refused as same_value (guard on), a noop (guard off)`, async () => {
      const { writeFormEdits } = await import("./form-write");
      guard(false);
      const off = await writeFormEdits("inst-1", [{ op: "set", field: "coaching_details", value: DETAILS }], { path, actorId: "qa", latest });
      expect(off.handoff).toBe("noop");
      guard(true);
      const on = await writeFormEdits("inst-1", [{ op: "set", field: "coaching_details", value: DETAILS }], { path, actorId: "qa", latest });
      expect(on).toMatchObject({ handoff: "refused", refused: [{ key: "coaching_details", reason: "same_value" }], changed: [] });
      expect(rows.calls).toEqual([]);
    });

    it(`${path}: the request appended to the account is refused as copies_message (guard on), written (guard off)`, async () => {
      const { writeFormEdits } = await import("./form-write");
      guard(true);
      const on = await writeFormEdits("inst-1", [{ op: "append", field: "coaching_details", value: SF_S11 }], { path, actorId: "qa", latest });
      expect(on).toMatchObject({ handoff: "refused", refused: [{ key: "coaching_details", reason: "copies_message" }] });
      expect(rows.calls).toEqual([]);
      guard(false);
      const off = await writeFormEdits("inst-1", [{ op: "append", field: "coaching_details", value: SF_S11 }], { path, actorId: "qa", latest });
      expect(off.handoff).toBe(null);
      expect(rows.list.find((row) => row.fieldKey === "coaching_details")?.value).toContain(SF_S11);
    });
  }

  it("the whole patch is refused when one op is a same value (all or nothing)", async () => {
    const { writeFormEdits } = await import("./form-write");
    guard(true);
    const result = await writeFormEdits(
      "inst-1",
      [
        { op: "set", field: "coaching_topics", value: ["store_tours"] },
        { op: "append", field: "coaching_details", value: "She also skipped the opening checklist." },
      ],
      { path: "tool", actorId: "qa", latest: "add that she also skipped the opening checklist" },
    );
    expect(result.handoff).toBe("refused");
    expect(result.refused).toEqual([{ key: "coaching_topics", reason: "same_value" }]);
    expect(rows.calls).toEqual([]);
  });

  it("a real tool edit is written as before with the guard on", async () => {
    const { writeFormEdits } = await import("./form-write");
    guard(true);
    const result = await writeFormEdits("inst-1", [{ op: "append", field: "coaching_details", value: "She also skipped the opening checklist." }], {
      path: "tool",
      actorId: "qa",
      latest: "add that she also skipped the opening checklist",
    });
    expect(result.handoff).toBe(null);
    expect(result.changed.map((change) => change.key)).toEqual(["coaching_details"]);
  });

  it("revision: an unchanged rewrite is refused (same_value); a rewrite holding the message is refused (copies_message)", async () => {
    const { writeRevisionEdits } = await import("./form-write");
    guard(true);
    const same = await writeRevisionEdits("inst-1", { values: { coaching_details: DETAILS } }, [], { actorId: "qa", latest: "make it sound more professional" });
    expect(same.rejected).toEqual([{ key: "coaching_details", reason: "same_value" }]);
    const copied = await writeRevisionEdits("inst-1", { values: { coaching_details: `${DETAILS} make it sound more professional` } }, [], {
      actorId: "qa",
      latest: "make it sound more professional",
    });
    expect(copied.rejected).toEqual([{ key: "coaching_details", reason: "copies_message" }]);
    expect(rows.calls).toEqual([]);
    // A real rewrite still reaches the form.
    const reworded = await writeRevisionEdits("inst-1", { values: { coaching_details: "On 10-20-26 Jane was short at the register by $25 at close." } }, [], {
      actorId: "qa",
      latest: "make it sound more professional",
    });
    expect(reworded.rejected).toEqual([]);
    expect(Object.keys(reworded.accepted.values)).toEqual(["coaching_details"]);
  });

  it("correction: the date the form already has is refused (same_value) and the turn is handed off; guard off, nothing changed", async () => {
    const { correctionWrite } = await import("./form-write");
    put("form_date", "2026-10-20", "system");
    const input = {
      instanceId: "inst-1",
      loaded: form(),
      stated: { values: { form_date: "2026-10-20" }, checked: {} },
      actorId: "qa",
      said: "change the date to 10/20",
      today: "2026-10-26",
    };
    guard(false);
    const off = await correctionWrite(input);
    expect(off.result.handoff).toBe("noop");
    expect(off.nothingChanged).toBe("I didn't change anything on the form.");
    guard(true);
    const on = await correctionWrite(input);
    expect(on.result).toMatchObject({ handoff: "refused", refused: [{ key: "form_date", reason: "same_value" }] });
    expect(on.nothingChanged).toBeUndefined();
    expect(rows.calls).toEqual([]);
  });

  it("correction: a value restated beside a real change is not refused (whole_patch) — classification, qa-oct21-audit Issue 4", async () => {
    const { correctionWrite } = await import("./form-write");
    put("form_date", "2026-10-20", "system");
    guard(true);
    const saved = await correctionWrite({
      instanceId: "inst-1",
      loaded: form(),
      stated: { values: { form_date: "2026-10-20", job_title: "Salon Director" }, checked: {} },
      actorId: "qa",
      said: "her position is Salon Director, the date is 10/20",
      today: "2026-10-26",
    });
    expect(saved.result.handoff).toBe(null);
    expect(saved.result.refused).toEqual([]);
    expect(Object.keys(saved.values)).toEqual(["job_title"]);
  });

  it("draft paths (redraft, copy) are not checked: a same value is still a noop", async () => {
    const { writeFormEdits } = await import("./form-write");
    guard(true);
    const result = await writeFormEdits("inst-1", [{ op: "set", field: "coaching_details", value: DETAILS }], { path: "copy", actorId: "qa" });
    expect(result.handoff).toBe("noop");
  });

  it("the guard alone, without the single writer, is off", async () => {
    for (const name of FLAGS) delete process.env[name];
    process.env.FORM_EDIT_NOOP_GUARD_ENABLED = "true";
    expect((await import("@/lib/config/chat-quality-flags")).formEditNoopGuardEnabled()).toBe(false);
    process.env.FORM_EDIT_SINGLE_WRITER_ENABLED = "true";
    expect((await import("@/lib/config/chat-quality-flags")).formEditNoopGuardEnabled()).toBe(true);
    delete process.env.FORM_EDIT_NOOP_GUARD_ENABLED;
    expect((await import("@/lib/config/chat-quality-flags")).formEditNoopGuardEnabled()).toBe(false);
  });
});

/* --------------------------------------------------------------- reply --- */

describe("the reply from the saved diff", () => {
  const labels = { observation: "Observation of Offense", offense_type: "Type of Offense", other_offense: "Other" };
  const options = { offense_type: { tardiness: "Tardiness", under_performance: "Under Performance" } };

  it("nothing changed: exactly the new sentence", () => {
    expect(updatedLines([], labels, options)).toBe("I didn't change anything on the form. Tell me which part to change and what it should say.");
    expect(UNCHANGED_FORM_REPLY).toBe("I didn't change anything on the form. Tell me which part to change and what it should say.");
  });

  it("one line per change: the value on one line, a checkbox by its option labels, a clear as (cleared)", () => {
    expect(
      updatedLines(
        [
          { key: "other_offense", after: "Late to open\ntwice" },
          { key: "offense_type", after: ["tardiness", "under_performance"] },
          { key: "observation", after: "" },
        ],
        labels,
        options,
      ),
    ).toBe("Updated: Other: Late to open twice\nUpdated: Type of Offense: Tardiness, Under Performance\nUpdated: Observation of Offense: (cleared)");
    expect(updatedLines([{ key: "offense_type", after: [] }], labels, options)).toBe("Updated: Type of Offense: (cleared)");
  });

  it(`a long value is cut at a word, at most ${UPDATED_VALUE_MAX} characters`, () => {
    const long = "Observed:\nJane Doe was late to open on October 20, 2026.\n\nExpectation:\nAn employee scheduled to open is expected to arrive on time.";
    const shown = updatedValue(long);
    expect(shown.length).toBeLessThanOrEqual(UPDATED_VALUE_MAX);
    expect(shown).toBe("Observed: Jane Doe was late to open on October 20, 2026. Expectation: An…");
    expect(long.split(/\s+/).join(" ").startsWith(shown.slice(0, -1))).toBe(true);
    expect(updatedValue("short")).toBe("short");
  });

  it('never the old "Changed … to" text', () => {
    expect(updatedLines([{ key: "other_offense", after: "Late" }], labels)).not.toMatch(/^Changed /);
  });
});
