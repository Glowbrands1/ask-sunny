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

describe("writeFormEdits: all or nothing", () => {
  it("a refused op writes nothing, not even the accepted ones beside it, and hands the turn off", async () => {
    const { writeFormEdits } = await import("./form-write");
    const result = await writeFormEdits(
      "inst-1",
      [
        { op: "set", field: "coaching_topics", value: ["store_tours", "other"] },
        // Drops "Jane", the date and the amount: refused.
        { op: "set", field: "coaching_details", value: "The register was short." },
      ],
      { path: "revision", actorId: "qa", latest: "make it sound more professional" },
    );
    expect(result.handoff).toBe("refused");
    expect(result.refused).toEqual([{ key: "coaching_details", reason: "drops_protected_value" }]);
    expect(result.changed).toEqual([]);
    expect(rows.calls).toEqual([]);
    expect(result.saved.rejected.map((entry) => entry.key).sort()).toEqual(["coaching_details", "coaching_topics"]);
  });

  it("an unknown field is refused before anything is read", async () => {
    const { writeFormEdits } = await import("./form-write");
    const result = await writeFormEdits("inst-1", [{ op: "set", field: "no_such_line", value: "x" }], { path: "tool", actorId: "qa", latest: "x" });
    expect(result).toMatchObject({ handoff: "refused", refused: [{ key: "no_such_line", reason: "unknown_field" }] });
    expect(rows.calls).toEqual([]);
  });

  it("CHAT_GLOSSARY_ENABLED: \"Msb\" is never saved as the employee (sf-s12, \"I need to make a corrective action for msb\"); off, written as before", async () => {
    const saved = process.env.CHAT_GLOSSARY_ENABLED;
    const { writeFormEdits } = await import("./form-write");
    // A blank name line, so the flag-off write drops no words (step 2b's correction rule refuses a replaced name it was not told).
    put("employee_name", "", "system");
    try {
      process.env.CHAT_GLOSSARY_ENABLED = "true";
      const refused = await writeFormEdits("inst-1", [{ op: "set", field: "employee_name", value: "Msb" }], { path: "correction", actorId: "qa", latest: "I need to make a corrective action for msb" });
      expect(refused).toMatchObject({ handoff: "refused", refused: [{ key: "employee_name", reason: "glossary_term" }] });
      expect(rows.calls).toEqual([]);
      const column = await writeFormEdits("inst-1", [{ op: "set", field: "employee_name", value: "Msb" }], { path: "correction", actorId: "qa", employeeColumn: "MSB" });
      expect(column.handoff).toBe("refused");
      expect(rows.calls).toEqual([]);
      delete process.env.CHAT_GLOSSARY_ENABLED;
      const written = await writeFormEdits("inst-1", [{ op: "set", field: "employee_name", value: "Msb" }], { path: "correction", actorId: "qa", latest: "I need to make a corrective action for msb" });
      expect(written.handoff).not.toBe("refused");
      expect(rows.calls).toEqual(["saveInstanceValues:employee_name"]);
    } finally {
      if (saved === undefined) delete process.env.CHAT_GLOSSARY_ENABLED;
      else process.env.CHAT_GLOSSARY_ENABLED = saved;
    }
  });

  it("a finalized form is never written", async () => {
    rows.status = "final";
    const { writeFormEdits } = await import("./form-write");
    const result = await writeFormEdits("inst-1", [{ op: "set", field: "other_topic", value: "x" }], { path: "copy", actorId: "qa" });
    expect(result.handoff).toBe("refused");
    expect(rows.calls).toEqual([]);
  });

  it("ops that change nothing: handoff noop, nothing written, the reply says so", async () => {
    const { writeFormEdits } = await import("./form-write");
    const result = await writeFormEdits("inst-1", [{ op: "set", field: "coaching_details", value: DETAILS }], { path: "copy", actorId: "qa" });
    expect(result.handoff).toBe("noop");
    expect(result.saved.nothingChanged).toBe("I didn't change anything on the form.");
    expect(rows.calls).toEqual([]);
  });
});

describe("writeFormEdits: split by owner into the existing writers, then the saved diff", () => {
  it("a correction is the manager's (saveInstanceValues); a moved date in a drafted paragraph is the assistant's (applyAssistantDraft)", async () => {
    const { correctionWrite } = await import("./form-write");
    const saved = await correctionWrite({
      instanceId: "inst-1",
      loaded: form(),
      stated: { values: { form_date: "2026-10-19" }, checked: {} },
      assistant: { values: { coaching_details: DETAILS.replace("10-20-26", "10-19-26") }, provenance: { coaching_details: { source: "x" } } },
      actorId: "qa",
      said: "change the date to 10/19",
      today: "2026-10-26",
      readerValues: ["2026-10-19"],
    });
    expect(saved.result.handoff).toBeNull();
    expect(rows.calls).toEqual(["saveInstanceValues:form_date", "applyAssistantDraft:coaching_details"]);
    expect(saved.assistantKeys).toEqual(["coaching_details"]);
    expect(saved.result.changed.map((change) => change.key).sort()).toEqual(["coaching_details", "form_date"]);
  });

  it("the patch turn's split: an assistant line through applyAssistantRevision, a typed line stays the manager's, a clear through the revision", async () => {
    put("other_topic", "Greeting guests", "manager");
    put("coaching_topics", ["store_tours", "other"], "ai");
    const { writeFormEdits } = await import("./form-write");
    const latest = "add that she also greeted every guest at the door, and clear the topics";
    const result = await writeFormEdits(
      "inst-1",
      [
        { op: "append", field: "coaching_details", value: "She also greeted every guest at the door." },
        { op: "append", field: "other_topic", value: "every guest at the door" },
      ],
      { path: "tool", actorId: "qa", latest, managerTurns: [latest] },
    );
    expect(result.handoff).toBeNull();
    expect(rows.calls).toEqual(["saveInstanceValues:other_topic", "applyAssistantRevision:coaching_details|"]);
    expect(result.changed.map((change) => change.key).sort()).toEqual(["coaching_details", "other_topic"]);
  });

  it("stated facts go through applyStatedFacts, only into an empty line (a filled one is kept, not refused)", async () => {
    put("other_topic", "Typed by her", "manager");
    const { statedWrite } = await import("./form-write");
    const keys = await statedWrite("inst-1", { values: { other_topic: "From her words", job_title: "Assistant Salon Director" }, checked: {} }, "qa", undefined);
    expect(rows.calls).toEqual(["applyStatedFacts:job_title"]);
    expect(keys).toEqual(["job_title"]);
  });

  it("code's own value (derived) passes through, but never over a typed line unless exempt", async () => {
    put("other_topic", "Typed by her", "manager");
    const { draftWrite } = await import("./form-write");
    const refused = await draftWrite("inst-1", { values: { other_topic: "Policy words" } }, "qa", {}, { path: "policy" });
    expect(refused.result.refused).toEqual([{ key: "other_topic", reason: "typed_by_manager" }]);
    expect(rows.calls).toEqual([]);
    const exempt = await draftWrite("inst-1", { values: { other_topic: "Policy words" } }, "qa", { other_topic: { verified: true } }, { path: "policy", typedExempt: new Set(["other_topic"]) });
    expect(exempt.result.handoff).toBeNull();
    expect(rows.calls).toEqual(["applyAssistantDraft:other_topic"]);
  });

  it("the helpers each call writeFormEdits (refusals come back from it)", async () => {
    const writer = await import("./form-write");
    const latest = "make it sound more professional";
    const revision = await writer.writeRevisionEdits("inst-1", { values: { coaching_details: "Short at close." } }, [], { actorId: "qa", latest });
    expect(revision.accepted).toEqual({ values: {}, checked: {} });
    expect(revision.rejected).toEqual([{ key: "coaching_details", reason: "drops_protected_value" }]);
    const draft = await writer.draftWrite("inst-1", { values: { coaching_details: "Short at close." } }, "qa", {}, { path: "redraft", notes: latest });
    expect(draft.result.refused).toEqual([{ key: "coaching_details", reason: "drops_protected_value" }]);
    put("other_topic", "Typed by her", "manager");
    const cleared = await writer.clearWrite("inst-1", ["other_topic"], "qa", { path: "policy" });
    // A line the manager typed is never blanked.
    expect(cleared).toMatchObject({ cleared: [], rejected: [{ key: "other_topic", reason: "would_blank" }] });
    expect(rows.calls).toEqual([]);
  });
});

describe("classification fixes (flag on): what the old writer did that the one writer must keep", () => {
  it("the redraft's own decision for a key outside the reducer stands over a typed line (revision-5: the Action Plan the route builds)", async () => {
    put("job_title", "Typed by her", "manager");
    const { draftWrite } = await import("./form-write");
    const out = await draftWrite("inst-1", { values: { job_title: "Built by the route" } }, "qa", {}, { path: "redraft", notes: "x" });
    expect(out.result.handoff).toBeNull();
    expect(rows.calls).toEqual(["applyAssistantDraft:job_title"]);
  });

  it("the same words with new provenance are still written (Q18: a policy line re-verified against the manual)", async () => {
    put("job_title", "Same words", "ai", { ownerConfirmed: null });
    const { draftWrite } = await import("./form-write");
    const out = await draftWrite("inst-1", { values: { job_title: "Same words" } }, "qa", { job_title: { ownerConfirmed: true } }, { path: "redraft", notes: "x" });
    expect(out.result.handoff).toBeNull();
    expect(rows.list.find((row) => row.fieldKey === "job_title")?.provenance).toEqual({ ownerConfirmed: true });
  });

  it("on a draft path the manager's notes name what may change (same-form-copy: \"Coaching for Remy Calder.\" → her own account)", async () => {
    put("employee_name", "Remy Calder", "system");
    put("coaching_details", "Observed:\nCoaching for Remy Calder.", "ai");
    const { draftWrite } = await import("./form-write");
    const notes = "create a coaching form for remy calder\n\nShe was late again today, same thing as last week";
    const instance = form();
    (instance.instance as { employeeName: string }).employeeName = "Remy Calder";
    const out = await draftWrite("inst-1", { values: { coaching_details: "Observed:\nRemy was late again today." } }, "qa", {}, { path: "redraft", notes, loaded: instance });
    expect(out.result.refused).toEqual([]);
  });
});

describe("writeRevisionEdits (2b; built, not wired)", () => {
  it("keeps applyAssistantRevision's return shape and accepts a rewrite that keeps the protected values", async () => {
    const { writeRevisionEdits } = await import("./form-write");
    const out = await writeRevisionEdits(
      "inst-1",
      { values: { coaching_details: "At close on 10-20-26, Jane's register was short by $25.00." } },
      [],
      { actorId: "qa", latest: "make it sound more professional" },
    );
    expect(out.rejected).toEqual([]);
    expect(out.accepted.values.coaching_details).toContain("Jane");
    expect(rows.calls).toEqual(["applyAssistantRevision:coaching_details|"]);
  });

  it("a name the latest message names may change", async () => {
    const { writeRevisionEdits } = await import("./form-write");
    const out = await writeRevisionEdits(
      "inst-1",
      { values: { coaching_details: "Ms. Doe was short at the register by $25 at close on 10-20-26." } },
      [],
      { actorId: "qa", latest: "use her last name, not jane" },
    );
    expect(out.rejected).toEqual([]);
  });
});
