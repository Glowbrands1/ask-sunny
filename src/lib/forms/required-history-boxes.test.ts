import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

/**
 * CORRECTIVE ACTION REVISION 9 (HR via Pau, 19 Nov 2026, after meeting with
 * their director, for both apps): "remove line I've screenshot below and add
 * two separate boxes that are required to fill in by form creator. question 1
 * needs to be: List date of JBA policy manual signed by employee, question 2
 * is 'List previous coaching and corrective actions and include date signed
 * by employee in past 90 days'".
 *
 * The screenshot is the line "List previously received coaching and/or
 * corrective action with date signed".
 */

const store: FakeStore = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
};

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => fakeSupabase(store),
}));

const { ensureTemplateLibrary } = await import("./repository");
const { writeFormEdits } = await import("./form-write");
const { applyAssistantDraft, createInstance, loadInstance, saveInstanceValues, finalizeInstance, RequiredFieldsBlankError } = await import("./instances");
const { correctiveActionDocument } = await import("./library");
const { fieldsForVariant, parseFormDocument } = await import("./document");
const { blankRequiredFields, requiredFieldsMessage } = await import("./required-fields");
const { default: REVISION_7 } = await import("@/test/fixtures/forms/corrective-action-revision-7.json");

const Q1 = "List date of JBA policy manual signed by employee";
// Changed on purpose (Pau, 26 Nov 2026: "just remove the 90 day wording"): HR's question 2 no longer says "in past 90 days".
const Q2 = "List previous coaching and corrective actions and include date signed by employee";
const OLD_LINE = "List previously received coaching and/or corrective action with date signed";

describe("the Corrective Action Form's two history boxes", () => {
  const fields = fieldsForVariant(correctiveActionDocument(), null);

  it("has the two boxes in HR's exact words, question 1 then question 2, and not the old line", () => {
    const labels = fields.map((field) => field.label);
    expect(labels).toContain(Q1);
    expect(labels).toContain(Q2);
    expect(labels.indexOf(Q1)).toBe(labels.indexOf(Q2) - 1);
    expect(labels).not.toContain(OLD_LINE);
  });

  it("marks both required; the manual's date is the form creator's, the history keeps its key", () => {
    const q1 = fields.find((field) => field.label === Q1)!;
    const q2 = fields.find((field) => field.label === Q2)!;
    expect(q1).toMatchObject({ key: "policy_manual_signed", responsibility: "manager", required: true });
    expect(q2).toMatchObject({ key: "prior_actions", required: true });
  });

  it("a revision 7 form keeps the old line and is never held to the new boxes", () => {
    const old = parseFormDocument(REVISION_7);
    const labels = fieldsForVariant(old, null).map((field) => field.label);
    expect(labels).toContain(OLD_LINE);
    expect(labels).not.toContain(Q1);
    expect(blankRequiredFields(old, null, [])).toEqual([]);
  });
});

describe("blankRequiredFields", () => {
  const document = correctiveActionDocument();

  it("names both boxes when nothing is filled in, and neither once both are", () => {
    expect(blankRequiredFields(document, null, []).map((field) => field.key)).toEqual(["policy_manual_signed", "prior_actions"]);
    const filled = [
      { fieldKey: "policy_manual_signed", value: "01/01/2026" },
      { fieldKey: "prior_actions", value: "None — first occurrence" },
    ];
    expect(blankRequiredFields(document, null, filled)).toEqual([]);
  });

  it("treats whitespace as blank", () => {
    const rows = [
      { fieldKey: "policy_manual_signed", value: "   " },
      { fieldKey: "prior_actions", value: "\n" },
    ];
    expect(blankRequiredFields(document, null, rows)).toHaveLength(2);
  });

  it("says which box is missing in the box's own words", () => {
    expect(requiredFieldsMessage([{ label: Q1 }])).toBe(`"${Q1}" is required. Fill it in before finalizing this form.`);
  });
});

describe("Finalize with the boxes blank (REQUIRED_FIELDS_AT_FINALIZE_ENABLED)", () => {
  beforeEach(async () => {
    for (const rows of Object.values(store)) rows.length = 0;
    await ensureTemplateLibrary("system");
  });
  afterEach(() => {
    delete process.env.REQUIRED_FIELDS_AT_FINALIZE_ENABLED;
  });

  // The policy gate is not what this file tests: the manager has verified the policy themselves.
  const ACK = { acknowledgeUnverifiedPolicy: true };

  async function draft() {
    return createInstance({ templateKey: "dpoa", variantKey: null, employeeName: "Sarah Test", createdBy: "dana", source: "ask_sunny" });
  }

  it("on: refuses while a draft, names the boxes, and files once both are filled", async () => {
    process.env.REQUIRED_FIELDS_AT_FINALIZE_ENABLED = "1";
    const instance = await draft();

    const refused = await finalizeInstance(instance.id, "dana", null, ACK).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(RequiredFieldsBlankError);
    expect((refused as InstanceType<typeof RequiredFieldsBlankError>).fields.map((field) => field.label)).toEqual([Q1, Q2]);

    await saveInstanceValues(instance.id, { values: { policy_manual_signed: "01/01/2026" } }, "dana");
    const half = await finalizeInstance(instance.id, "dana", null, ACK).catch((error: unknown) => error);
    expect((half as InstanceType<typeof RequiredFieldsBlankError>).fields.map((field) => field.key)).toEqual(["prior_actions"]);

    await saveInstanceValues(instance.id, { values: { prior_actions: "None — first occurrence" } }, "dana");
    expect((await finalizeInstance(instance.id, "dana", null, ACK)).status).toBe("finalized");
  });

  it("the assistant can never write the manual's signed date: it stays the form creator's", async () => {
    const instance = await draft();
    const result = await applyAssistantDraft(
      instance.id,
      { values: { policy_manual_signed: "01/01/2026", prior_actions: "Coaching — 09/02/2026" }, checked: {} },
      "sunny",
    );
    expect(result.rejected.map((entry: { key: string }) => entry.key)).toContain("policy_manual_signed");
    const saved = store.form_instance_values!.filter((row) => row.instance_id === instance.id);
    expect(saved.find((row) => row.field_key === "policy_manual_signed")).toBeUndefined();
    expect(saved.find((row) => row.field_key === "prior_actions")?.value).toBe("Coaching — 09/02/2026");
  });

  it("off: files with the boxes blank, as before", async () => {
    const instance = await draft();
    expect((await finalizeInstance(instance.id, "dana", null, ACK)).status).toBe("finalized");
  });

  /*
   * "set the manual date to 01/01/2026" — the form creator edits box 1 by
   * prompting the chat. It is written only as their own words (the patch
   * path's verbatim rule, as the job title is), and never as the assistant's.
   */
  async function patch(latest: string, value: string) {
    const loaded = (await loadInstance((await draft()).id))!;
    const result = await writeFormEdits(
      loaded.instance.id,
      [{ op: "set", field: "policy_manual_signed", value }],
      {
        path: "patch",
        actorId: "dana",
        latest,
        managerTurns: [latest],
        today: "2026-11-19",
        loaded,
        writable: new Set(["policy_manual_signed"]),
        readerFixes: { employeeName: "Sarah Test", formText: "", verbatimKeys: new Set(["policy_manual_signed"]) },
      },
    );
    return { result, rows: store.form_instance_values!.filter((row) => row.instance_id === loaded.instance.id && row.field_key === "policy_manual_signed") };
  }

  it("a chat edit sets box 1 to the date the manager typed", async () => {
    const { rows } = await patch("set the manual date to 01/01/2026", "01/01/2026");
    expect(rows.map((row) => row.value)).toEqual(["01/01/2026"]);
  });

  it("a chat edit never invents box 1: a date the manager did not type is refused", async () => {
    const { rows } = await patch("update the form please", "01/01/2026");
    expect(rows).toEqual([]);
  });
});
