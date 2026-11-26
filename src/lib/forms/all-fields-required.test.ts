import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

import type { FormsActor } from "./access";

/**
 * EVERY FIELD BEFORE APPROVAL (Pau, 25 Nov 2026; ALL_FIELDS_REQUIRED_ENABLED), in Pau's words:
 *
 *   "Can you please update all forms so that they cannot submit for approval if all field are not filled out?
 *    for the box with previous coaching/ca, if none found add N/A QA and audit first pls before making everything
 *    required, of course signature is not required for approval, we do it by hand in person"
 *
 * The audit is `docs/all-fields-required-audit.md`. Invented accounts and invented employees.
 */

const ORIGINAL = { ...process.env };

const store: FakeStore = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
} as FakeStore;
const extra = store as unknown as Record<string, Record<string, unknown>[]>;

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));

const { ensureTemplateLibrary } = await import("./repository");
const { createInstance, loadInstance, saveInstanceValues, finalizeInstance, RequiredFieldsBlankError } = await import("./instances");
const { sendForHrApproval } = await import("./hr-approval");
const { TEMPLATE_SEEDS } = await import("./library");
const { blocksForVariant } = await import("./document");
const { blankBeforeSubmission, blankBeforeSubmissionMessage } = await import("./required-fields");
const { groundPriorActions, isNoHistoryLine, NO_PRIOR_ACTIONS_FOUND } = await import("./prior-actions");
const { uniteLines } = await import("./form-reducer");

type Seed = (typeof TEMPLATE_SEEDS)[number];
type Row = { fieldKey: string; value: string | null; checked?: string[] };

const PAU =
  "Can you please update all forms so that they cannot submit for approval if all field are not filled out?";

/** Every keyed part of the form filled, the way a manager who finished it would leave it. */
function everythingFilled(seed: Seed, variantKey: string | null): Row[] {
  const rows: Row[] = [];
  for (const block of blocksForVariant(seed.document, variantKey)) {
    if (block.kind === "field") rows.push({ fieldKey: block.field.key, value: block.field.input === "date" ? "2026-11-20" : "Filled in" });
    else if (block.kind === "field_row")
      for (const field of block.fields) rows.push({ fieldKey: field.key, value: field.input === "date" ? "2026-11-20" : "Filled in" });
    else if (block.kind === "checkbox_group") rows.push({ fieldKey: block.key, value: null, checked: [block.options[0]!.key] });
    else if (block.kind === "numbered_list")
      rows.push({ fieldKey: block.key, value: Array.from({ length: block.count }, (_, index) => `Line ${index + 1}`).join("\n") });
    else if (block.kind === "expectation_checklist")
      rows.push({ fieldKey: block.successKey, value: null, checked: block.options.map((option) => option.key) });
    else if (block.kind === "objective_rows") for (const row of block.rows) rows.push({ fieldKey: row.key, value: "Filled in" });
  }
  return rows;
}

function variantOf(seed: Seed) {
  return seed.variants[0] ?? null;
}

describe(`"${PAU}" — the audit, form by form`, () => {
  for (const seed of TEMPLATE_SEEDS) {
    const variant = variantOf(seed);
    const variantKey = variant?.key ?? null;

    describe(seed.name, () => {
      const blank = blankBeforeSubmission(seed.document, variantKey, [], { variant });

      it("cannot be submitted blank", () => {
        expect(blank.length).toBeGreaterThan(0);
      });

      it("can be submitted once everything the creator fills is filled", () => {
        expect(blankBeforeSubmission(seed.document, variantKey, everythingFilled(seed, variantKey), { variant })).toEqual([]);
      });

      it('never asks for a signature, a line "filled by hand" or a line the employee writes: "we do it by hand in person"', () => {
        const inPerson = new Set<string>();
        for (const block of blocksForVariant(seed.document, variantKey)) {
          const fields = block.kind === "field" ? [block.field] : block.kind === "field_row" ? block.fields : [];
          for (const field of fields) if (["manual", "employee", "signature"].includes(field.responsibility) && !field.required) inPerson.add(field.key);
          if ("responsibility" in block && ["manual", "employee", "signature"].includes(block.responsibility)) {
            if (block.kind === "expectation_checklist") inPerson.add(block.successKey);
            else if ("key" in block) inPerson.add(block.key);
          }
        }
        expect(blank.filter((part) => inPerson.has(part.key))).toEqual([]);
      });

      it("names every blank part in words a manager can find on the form", () => {
        for (const part of blank) {
          expect(part.label.trim()).not.toBe("");
          expect(part.label).not.toContain("{{");
        }
      });
    });
  }
});

describe("what applies only after another answer", () => {
  const seed = (key: string) => TEMPLATE_SEEDS.find((entry) => entry.key === key)!;
  const without = (rows: Row[], ...keys: string[]) => rows.filter((row) => !keys.includes(row.fieldKey));
  const ticking = (rows: Row[], key: string, checked: string[]) =>
    rows.map((row) => (row.fieldKey === key ? { ...row, checked } : row));

  it("Corrective Action: the payroll amount only when payroll deduct is Yes", () => {
    const ca = seed("dpoa");
    const filled = without(everythingFilled(ca, null), "payroll_deduct_amount");
    expect(blankBeforeSubmission(ca.document, null, ticking(filled, "payroll_deduct", ["no"])).map((part) => part.key)).toEqual([]);
    expect(blankBeforeSubmission(ca.document, null, ticking(filled, "payroll_deduct", ["yes"])).map((part) => part.key)).toEqual([
      "payroll_deduct_amount",
    ]);
  });

  it("Corrective Action: the two history boxes are still asked for", () => {
    const ca = seed("dpoa");
    const keys = blankBeforeSubmission(ca.document, null, without(everythingFilled(ca, null), "policy_manual_signed", "prior_actions")).map(
      (part) => part.key,
    );
    expect(keys).toEqual(["policy_manual_signed", "prior_actions"]);
  });

  it("Coaching Form: the Other line only when Other is a topic", () => {
    const coaching = seed("coaching");
    const filled = without(everythingFilled(coaching, null), "other_topic");
    expect(blankBeforeSubmission(coaching.document, null, ticking(filled, "coaching_topics", ["store_tours"]))).toEqual([]);
    expect(blankBeforeSubmission(coaching.document, null, ticking(filled, "coaching_topics", ["other"])).map((part) => part.key)).toEqual([
      "other_topic",
    ]);
  });

  it("Exit form: the notice dates when notice was fulfilled, otherwise how they left", () => {
    const exit = TEMPLATE_SEEDS.find((entry) => blocksForVariant(entry.document, null).some((block) => block.kind === "checkbox_group" && block.key === "resignation_notice"))!;
    const filled = without(everythingFilled(exit, null), "notice_given_date", "notice_fulfilled_date", "resignation_type", "resignation_notice");
    expect(blankBeforeSubmission(exit.document, null, filled).map((part) => part.key)).toEqual(["resignation_type"]);
    const fulfilled = [...filled, { fieldKey: "resignation_notice", value: null, checked: ["submitted_fulfilled_notice"] }];
    expect(blankBeforeSubmission(exit.document, null, fulfilled).map((part) => part.key)).toEqual(["notice_given_date", "notice_fulfilled_date"]);
  });

  it('Exit form: "Additional Details" is optional (Pau: "Should it be optional? - yes")', () => {
    const exit = TEMPLATE_SEEDS.find((entry) => blocksForVariant(entry.document, null).some((block) => block.kind === "checkbox_group" && block.key === "resignation_notice"))!;
    expect(blankBeforeSubmission(exit.document, null, without(everythingFilled(exit, null), "details"))).toEqual([]);
  });

  it("an EPP's Re-Evaluation section waits for the re-evaluation", () => {
    const epp = seed("sdit-epp");
    const variant = variantOf(epp);
    const filled = without(everythingFilled(epp, variant?.key ?? null), "objectives_met", "reevaluation_plan", "policy_references");
    expect(blankBeforeSubmission(epp.document, variant?.key ?? null, filled, { variant })).toEqual([]);
    expect(
      blankBeforeSubmission(epp.document, variant?.key ?? null, filled, { variant, reEvaluation: true }).map((part) => part.key),
    ).toEqual(["objectives_met", "reevaluation_plan"]);
  });

  it("an expectation row nobody marked is blank; every row needs a mark", () => {
    const epp = seed("sdit-epp");
    const variant = variantOf(epp);
    const rows = everythingFilled(epp, variant?.key ?? null).map((row) =>
      row.fieldKey === "expectations_success" ? { ...row, checked: row.checked!.slice(1) } : row,
    );
    expect(blankBeforeSubmission(epp.document, variant?.key ?? null, rows, { variant }).map((part) => part.key)).toEqual(["expectations_success"]);
  });
});

describe("the refusal", () => {
  it("names what is blank, and how many more past eight", () => {
    const parts = Array.from({ length: 10 }, (_, index) => ({ label: `Line ${index + 1}` }));
    expect(blankBeforeSubmissionMessage(parts)).toBe(
      'Fill in every field before finalizing or sending this form for approval (signatures are signed in person). Still blank: "Line 1", "Line 2", "Line 3", "Line 4", "Line 5", "Line 6", "Line 7", "Line 8", and 2 more.',
    );
  });
});

describe('"for the box with previous coaching/ca, if none found add N/A"', () => {
  it("N/A is a no-history line, dropped once a real step is listed", () => {
    expect(NO_PRIOR_ACTIONS_FOUND).toBe("N/A");
    expect(isNoHistoryLine("N/A")).toBe(true);
    expect(isNoHistoryLine("n/a")).toBe(true);
    expect(isNoHistoryLine("Coaching — 09/02/2026")).toBe(false);
    expect(uniteLines("N/A", "Verbal warning — 10/02/2026", "None — first occurrence")).toBe("Verbal warning — 10/02/2026");
    const grounded = groundPriorActions({ drafted: "N/A\nCoaching — 09/02/2026", notes: "she was coached 9/2/2026", today: "2026-11-25" });
    expect(grounded.value).not.toContain("N/A");
  });
});

/* ------------------------------------------------- the real send for approval --- */

const CREATOR = "sd-larkspur";
const HR = "hr-maple-quill";
const manager: FormsActor = { id: CREATOR, role: "salon_director", verified: true, scope: null, visibility: null, hrApprover: false };
const ACK = { acknowledgeUnverifiedPolicy: true };

describe(`"${PAU}" — Finalize and send for approval`, () => {
  beforeEach(async () => {
    process.env.FORMS_HR_APPROVAL_ENABLED = "true";
    for (const key of Object.keys(store)) (store as unknown as Record<string, unknown[]>)[key] = [];
    extra.form_hr_approvers = [{ app_user_id: HR, revoked_at: null }];
    extra.form_hr_approval_events = [];
    extra.app_notifications = [];
    extra.app_users = [
      { id: HR, email: "hr.maple@example.com", display_name: "Maple", status: "active" },
      { id: CREATOR, email: "larkspur@example.com", display_name: "Larkspur", status: "active" },
    ];
    await ensureTemplateLibrary("system");
  });
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  async function correctiveAction() {
    return createInstance({
      templateKey: "dpoa",
      variantKey: null,
      employeeName: "Briar Holloway",
      employeeRole: "Tanning Consultant",
      locationId: "loc-test",
      locationName: "Test Salon",
      createdBy: CREATOR,
      source: "manual",
      formDate: "2026-11-20",
    });
  }

  const filledButHistory = {
    values: {
      policy_manual_signed: "01/05/2026",
      observation: "Observed: arrived 40 minutes late.\nExpectation: arrive on time.\nGoing Forward: arrive on time.",
      policy_violated: "Attendance Policy",
      policy_language: "Employees are expected to arrive on time for every scheduled shift.",
      action_plan: "Management will review the attendance policy with Briar.",
    },
    checked: { warning_type: ["verbal"], offense_type: ["attendance_policy"], payroll_deduct: ["no"] },
  };

  it("on: a blank form is refused while it is still a draft, naming what is blank", async () => {
    process.env.ALL_FIELDS_REQUIRED_ENABLED = "1";
    const instance = await correctiveAction();
    const refused = await sendForHrApproval(instance.id, manager, null, ACK).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(RequiredFieldsBlankError);
    const keys = (refused as InstanceType<typeof RequiredFieldsBlankError>).fields.map((field) => field.key);
    expect(keys).toEqual(expect.arrayContaining(["warning_type", "policy_manual_signed", "offense_type", "observation", "action_plan", "payroll_deduct"]));
    // "for the box with previous coaching/ca, if none found add N/A": never a reason to refuse.
    expect(keys).not.toContain("prior_actions");
    expect((refused as Error).message).toMatch(/^Fill in every field before finalizing or sending this form for approval/);
    expect((await loadInstance(instance.id))!.instance.status).toBe("draft");
    expect((await loadInstance(instance.id))!.instance.hrApprovalState ?? null).toBeNull();
  });

  it("on: once everything is filled it goes to HR, and the empty history box says N/A", async () => {
    process.env.ALL_FIELDS_REQUIRED_ENABLED = "1";
    const instance = await correctiveAction();
    await saveInstanceValues(instance.id, filledButHistory, CREATOR);
    const sent = await sendForHrApproval(instance.id, manager, null, ACK);
    expect(sent.hrApprovalState).toBe("pending");
    const history = (await loadInstance(instance.id))!.values.find((row) => row.fieldKey === "prior_actions");
    expect(history?.value).toBe("N/A");
    expect(history?.provenance).toMatchObject({ source: "no_prior_actions_found" });
  });

  it("on: a history the manager listed is kept as it is", async () => {
    process.env.ALL_FIELDS_REQUIRED_ENABLED = "1";
    const instance = await correctiveAction();
    await saveInstanceValues(instance.id, { ...filledButHistory, values: { ...filledButHistory.values, prior_actions: "Coaching — 09/02/2026" } }, CREATOR);
    await sendForHrApproval(instance.id, manager, null, ACK);
    expect((await loadInstance(instance.id))!.values.find((row) => row.fieldKey === "prior_actions")?.value).toBe("Coaching — 09/02/2026");
  });

  it("on: a coaching form (finalized without HR) is held to the same rule", async () => {
    process.env.ALL_FIELDS_REQUIRED_ENABLED = "1";
    const instance = await createInstance({
      templateKey: "coaching",
      variantKey: null,
      employeeName: "Briar Holloway",
      employeeRole: "Tanning Consultant",
      locationId: "loc-test",
      locationName: "Test Salon",
      createdBy: CREATOR,
      source: "manual",
      formDate: "2026-11-20",
    });
    const refused = await finalizeInstance(instance.id, CREATOR, null, ACK).catch((error: unknown) => error);
    expect((refused as InstanceType<typeof RequiredFieldsBlankError>).fields.map((field) => field.key)).toEqual([
      "coaching_type",
      "coaching_topics",
      "coaching_details",
    ]);
  });

  it("off: a blank form is sent as before", async () => {
    const instance = await correctiveAction();
    const sent = await sendForHrApproval(instance.id, manager, null, ACK);
    expect(sent.hrApprovalState).toBe("pending");
    expect((await loadInstance(instance.id))!.values.find((row) => row.fieldKey === "prior_actions")?.value ?? "").toBe("");
  });
});

describe('"add N/A AI filled out none, since it auto adds it there pls change verbage here"', () => {
  it("the history box's help says N/A is filled in automatically, not to write None", async () => {
    const { shownHelp } = await import("./required-fields");
    const { correctiveActionDocument } = await import("./library");
    const { fieldsForVariant } = await import("./document");
    const field = fieldsForVariant(correctiveActionDocument(), null).find((entry) => entry.key === "prior_actions")!;
    const help = shownHelp(field)!;
    expect(help).toContain('"N/A" is filled in automatically');
    expect(help).not.toContain('Write "None — first occurrence"');
    // A help line an administrator wrote is kept as it is.
    expect(shownHelp({ key: "prior_actions", help: "List every step." })).toBe("List every step.");
  });
});
