import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

/**
 * THE COACHING FORM ACROSS ITS WHOLE LIFE, AND THE PROMISE THAT MATTERS MOST.
 *
 * The Coaching Form was re-issued. Everything below is one question asked from
 * several sides: DOES REPLACING THE BLANK FORM CHANGE A FORM SOMEBODY ALREADY
 * SIGNED? It must not, and "must not" is not a comment — a finalized coaching
 * record read against the wrong template would show a supervisor ticks they
 * never made, because the option keys under `coaching_topics` are not the same
 * two lists.
 *
 * So: a new form is created from the CURRENT version, an old form keeps
 * rendering against ITS version, and neither knows about the other. The values
 * already stored are not touched, migrated or reinterpreted.
 *
 * The rest is the ordinary round trip — fill it, save it, finalize it, open it
 * again — because a form that renders correctly and cannot be saved is not
 * finished either.
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
const {
  applyAssistantDraft,
  createInstance,
  loadInstance,
  saveInstanceValues,
  finalizeInstance,
  UnverifiedPolicyError,
} = await import("./instances");
const { checkboxGroupsForVariant, responsibilityMap } = await import("./document");
const { renderFormPdf } = await import("./pdf-render");

/** The Coaching Form as it was BEFORE the re-issue, for the historical case. */
const SUPERSEDED_DOCUMENT = {
  paper: "letter",
  blocks: [
    { kind: "letterhead", brand: "SUN TAN CITY", title: "Coaching Form" },
    { kind: "section", label: "Employee Information" },
    {
      kind: "field_row",
      fields: [
        { key: "employee_name", label: "Employee Name", input: "text", responsibility: "system" },
        { key: "form_date", label: "Date", input: "date", responsibility: "system" },
      ],
    },
    { kind: "section", label: "Topic Of Coaching" },
    {
      kind: "checkbox_group",
      key: "coaching_topics",
      options: [
        { key: "salon_tours", label: "Salon Tours" },
        { key: "selling_memberships", label: "Selling Memberships" },
        { key: "lotion_basics", label: "Lotion Basics" },
      ],
      responsibility: "ai",
      columns: 2,
    },
    { kind: "section", label: "Acknowledgement of Training" },
  ],
};

function coachingTemplateId() {
  return String(store.form_templates!.find((row) => row.key === "coaching")!.id);
}

function currentCoachingVersionId() {
  const pointer = store.form_template_current!.find(
    (row) => row.template_id === coachingTemplateId(),
  );
  return String(pointer!.version_id);
}

beforeEach(async () => {
  store.form_instances = [];
  store.form_instance_values = [];
  store.form_instance_events = [];
  store.form_template_versions = [];
  store.form_templates = [];
  store.form_template_current = [];
  store.form_template_assets = [];
  await ensureTemplateLibrary("system");
});

async function startCoachingForm() {
  return createInstance({
    templateKey: "coaching",
    variantKey: null,
    employeeName: "Jordan Vance",
    employeeRole: "Tanning Consultant",
    locationId: "loc-1",
    locationName: "MO Kansas City Wornall",
    createdBy: "dana",
    source: "manual",
    formDate: "2026-09-07",
  });
}

describe("a new coaching form", () => {
  it("is filled from the re-issued document, not the superseded one", async () => {
    const instance = await startCoachingForm();
    const loaded = await loadInstance(instance.id);

    const topics = checkboxGroupsForVariant(loaded!.version.document, null).find(
      (group) => group.key === "coaching_topics",
    );
    expect(topics?.options.map((option) => option.label)).toEqual([
      "Store Tours",
      "Engaging Conversation",
      "Engaging Questions",
      "Relevant Recommendations",
      "Overcoming Objections",
      "Product Basics",
      "Completing the Engagement",
      "Sales Strategies/Upselling",
      "Cleaning Tasks",
      "New Client Documents",
      "Other",
    ]);
    const sections = loaded!.version.document.blocks
      .filter((block) => block.kind === "section")
      .map((block) => (block as { label: string }).label);
    expect(sections).toContain("Acknowledgement of Coaching");
    expect(sections).not.toContain("Acknowledgement of Training");
  });

  it("keeps the AI-fill mapping the form had before", async () => {
    const instance = await startCoachingForm();
    const loaded = await loadInstance(instance.id);
    const map = responsibilityMap(loaded!.version.document, null);

    // Filled from the record by the server, exactly as before.
    for (const key of ["employee_name", "form_date", "job_title", "location"]) {
      expect(map.get(key), key).toBe("system");
    }
    // Drafted by Ask Sunny, exactly as before.
    for (const key of ["coaching_type", "coaching_topics", "other_topic", "coaching_details"]) {
      expect(map.get(key), key).toBe("ai");
    }
  });

  it("arrives with the header already filled from the record", async () => {
    const instance = await startCoachingForm();
    const loaded = await loadInstance(instance.id);
    const values = Object.fromEntries(
      loaded!.values.map((value) => [value.fieldKey, value.value]),
    );

    expect(values.employee_name).toBe("Jordan Vance");
    expect(values.job_title).toBe("Tanning Consultant");
    expect(values.location).toBe("MO Kansas City Wornall");
    expect(values.form_date).toBe("2026-09-07");
  });

  it("saves ticks, text and details, and reads them all back", async () => {
    const instance = await startCoachingForm();

    const { rejected } = await saveInstanceValues(
      instance.id,
      {
        values: {
          other_topic: "Opening checklist",
          coaching_details: "Walked the opening checklist together on the floor.",
        },
        checked: {
          coaching_type: ["retraining"],
          coaching_topics: ["store_tours", "cleaning_tasks", "other"],
        },
      },
      "dana",
    );
    expect(rejected).toEqual([]);

    const loaded = await loadInstance(instance.id);
    const byKey = new Map(loaded!.values.map((value) => [value.fieldKey, value]));
    expect(byKey.get("coaching_type")?.checked).toEqual(["retraining"]);
    expect(byKey.get("coaching_topics")?.checked).toEqual([
      "store_tours",
      "cleaning_tasks",
      "other",
    ]);
    expect(byKey.get("other_topic")?.value).toBe("Opening checklist");
    expect(byKey.get("coaching_details")?.value).toBe(
      "Walked the opening checklist together on the floor.",
    );
  });

  it("refuses an option the re-issued form does not have", async () => {
    /*
     * `salon_tours` was a real option on the superseded document. A stale
     * browser tab, or a draft carried across the change, must not be able to
     * write it into a form built from the new one: an option the page cannot
     * print is a tick nobody can see.
     */
    const instance = await startCoachingForm();
    const { rejected } = await saveInstanceValues(
      instance.id,
      { checked: { coaching_topics: ["salon_tours", "store_tours"] } },
      "dana",
    );

    expect(rejected.map((entry) => entry.key)).toContain("coaching_topics");
    const loaded = await loadInstance(instance.id);
    const topics = loaded!.values.find((value) => value.fieldKey === "coaching_topics");
    expect(topics?.checked).toEqual(["store_tours"]);
  });

  it("survives being finalized and opened again", async () => {
    const instance = await startCoachingForm();
    await saveInstanceValues(
      instance.id,
      { values: { coaching_details: "Signed on the floor." }, checked: { coaching_type: ["retraining"] } },
      "dana",
    );

    const finalized = await finalizeInstance(instance.id, "dana", null);
    expect(finalized.status).toBe("finalized");

    const reopened = await loadInstance(instance.id);
    expect(reopened!.instance.status).toBe("finalized");
    expect(
      reopened!.values.find((value) => value.fieldKey === "coaching_details")?.value,
    ).toBe("Signed on the floor.");
    // Frozen: a finalized record is corrected by revision, never by overwrite.
    await expect(
      saveInstanceValues(instance.id, { values: { coaching_details: "no" } }, "dana"),
    ).rejects.toThrow(/finalized/i);
  });

  /*
   * ==========================================================================
   * APPROVAL SAYS WHETHER THE POLICY ON THE RECORD WAS EVER VERIFIED
   * ==========================================================================
   *
   * Finalizing is deliberately NOT blocked by an unverified policy field — a
   * manager who has read the manual and typed the reference in is exactly who
   * this form is for. What must not happen is a finalized corrective action
   * carrying policy text nobody checked, with nothing on the record saying so.
   *
   * `refuseUnverifiedPolicyValues` means Ask Sunny cannot have written such a
   * value, so an unverified one on a finalized form is necessarily a person's.
   * That is the fact the event now carries.
   */
  async function startCorrectiveForm() {
    return createInstance({
      templateKey: "dpoa",
      variantKey: null,
      employeeName: "Sarah Test",
      createdBy: "dana",
      source: "ask_sunny",
    });
  }

  function finalizedEvent(
    events: { kind: string; actor: string; detail: Record<string, unknown> }[],
  ) {
    return events.find((event) => event.kind === "finalized")!;
  }

  const VERIFIED = {
    grounded: true,
    verified: true,
    sources: [{ documentId: "doc-manual", documentTitle: "JBA Policy Manual" }],
  };

  /** A form whose policy fields Ask Sunny sourced from the approved manual. */
  async function correctiveFormWithVerifiedPolicy() {
    const instance = await startCorrectiveForm();
    await applyAssistantDraft(
      instance.id,
      {
        values: {
          policy_violated: "Appearance Standards, Section 3.2",
          policy_language: "Skirts and dresses must reach mid-thigh or longer.",
        },
      },
      "sunny",
      { policy_violated: VERIFIED, policy_language: VERIFIED },
    );
    return instance;
  }

  /* -- A. verified policy finalizes exactly as it always did --------------- */

  it("A. finalizes normally when the policy was verified", async () => {
    const instance = await correctiveFormWithVerifiedPolicy();

    const finalized = await finalizeInstance(instance.id, "dana", null);

    expect(finalized.status).toBe("finalized");
    const detail = finalizedEvent((await loadInstance(instance.id))!.events).detail;
    expect(detail.unverifiedPolicy).toBeUndefined();
    expect(detail.policyVerificationOverride).toBeUndefined();
  });

  it("A. leaves a form with no policy fields entirely alone", async () => {
    const instance = await startCoachingForm();

    await finalizeInstance(instance.id, "dana", null);

    const detail = finalizedEvent((await loadInstance(instance.id))!.events).detail;
    expect(detail.unverifiedPolicy).toBeUndefined();
    expect(detail.policyVerificationOverride).toBeUndefined();
  });

  /* -- B/C. unverified policy is refused until somebody says so ------------ */

  /*
   * THE REFUSAL HAPPENS BEFORE THE UPDATE, and that is the property that
   * matters: finalizing freezes an HR record, so a form that should have
   * prompted must not be frozen and then complained about.
   */
  it("B. refuses an unacknowledged finalize when a policy field is unverified", async () => {
    const instance = await startCorrectiveForm();
    // A manager's own edit: `filled_by: "manager"`, and no provenance at all.
    await saveInstanceValues(
      instance.id,
      { values: { policy_violated: "Dress Code Violation" } },
      "dana",
    );

    await expect(finalizeInstance(instance.id, "dana", null)).rejects.toBeInstanceOf(
      UnverifiedPolicyError,
    );
  });

  it("B. names the fields, so the dialog can list them", async () => {
    const instance = await startCorrectiveForm();

    const failure = await finalizeInstance(instance.id, "dana", null).catch((error) => error);

    expect(failure).toBeInstanceOf(UnverifiedPolicyError);
    expect((failure as InstanceType<typeof UnverifiedPolicyError>).fields).toEqual([
      "policy_violated",
      "policy_language",
    ]);
  });

  it("C. leaves the form a draft when the manager does not acknowledge", async () => {
    const instance = await startCorrectiveForm();

    await finalizeInstance(instance.id, "dana", null).catch(() => null);

    const loaded = await loadInstance(instance.id);
    expect(loaded!.instance.status).toBe("draft");
    expect(loaded!.instance.finalizedAt).toBeNull();
    // Nothing was written, so nothing has to be undone.
    expect(loaded!.events.some((event) => event.kind === "finalized")).toBe(false);
    // And it is still editable, which is the whole point of refusing early.
    await expect(
      saveInstanceValues(instance.id, { values: { observation: "Still a draft." } }, "dana"),
    ).resolves.toBeTruthy();
  });

  /* -- D. the override finalizes, and says who decided -------------------- */

  it("D. finalizes on an explicit acknowledgement and records the override", async () => {
    const instance = await startCorrectiveForm();
    await saveInstanceValues(
      instance.id,
      { values: { policy_violated: "Dress Code Violation" } },
      "dana",
    );

    const finalized = await finalizeInstance(instance.id, "dana", null, {
      acknowledgeUnverifiedPolicy: true,
    });

    expect(finalized.status).toBe("finalized");

    const loaded = await loadInstance(instance.id);
    const event = finalizedEvent(loaded!.events);
    /*
     * TWO KEYS, DELIBERATELY: a FACT read off the rows, and a DECISION a named
     * person made after being shown the warning.
     */
    expect(event.detail.unverifiedPolicy).toEqual(["policy_violated", "policy_language"]);
    expect(event.detail.policyVerificationOverride).toBe(true);
    expect(event.actor).toBe("dana");

    // The per-value record still says who wrote it, which is the finer answer.
    const row = loaded!.values.find((value) => value.fieldKey === "policy_violated");
    expect(row?.filledBy).toBe("manager");
    expect(row?.provenance).toEqual({});
  });

  it("D. never records an override on a form that did not need one", async () => {
    const instance = await correctiveFormWithVerifiedPolicy();

    // Acknowledging a form with nothing to acknowledge must not stamp it.
    await finalizeInstance(instance.id, "dana", null, { acknowledgeUnverifiedPolicy: true });

    const detail = finalizedEvent((await loadInstance(instance.id))!.events).detail;
    expect(detail.policyVerificationOverride).toBeUndefined();
  });

  it("never lets a signature be written, on any path", async () => {
    const instance = await startCoachingForm();
    const map = responsibilityMap((await loadInstance(instance.id))!.version.document, null);
    // A signature row has no key at all, so there is nothing to write into.
    expect([...map.keys()].some((key) => key.includes("signature"))).toBe(false);
  });
});

describe("a coaching form signed before the re-issue", () => {
  /** A finalized record still pointing at the superseded version. */
  async function historicalForm() {
    store.form_template_versions.push({
      id: "coaching-v0",
      template_id: coachingTemplateId(),
      version: 99,
      status: "archived",
      document: SUPERSEDED_DOCUMENT,
      variants: [],
      seed_revision: 1,
      notes: "The version this record was signed against.",
      created_by: "system",
    });
    store.form_instances.push({
      id: "old-form",
      template_id: coachingTemplateId(),
      template_version_id: "coaching-v0",
      variant_key: null,
      employee_name: "Priya Raghunathan",
      status: "finalized",
      source: "manual",
      created_by: "dana",
      created_at: "2026-01-04T10:00:00.000Z",
      form_date: "2026-01-04",
    });
    store.form_instance_values.push({
      instance_id: "old-form",
      field_key: "coaching_topics",
      value: null,
      checked: ["salon_tours", "lotion_basics"],
      filled_by: "ai",
      provenance: {},
    });
  }

  it("still renders against the document it was signed on", async () => {
    await historicalForm();
    const loaded = await loadInstance("old-form");

    expect(loaded!.version.id).toBe("coaching-v0");
    const topics = checkboxGroupsForVariant(loaded!.version.document, null).find(
      (group) => group.key === "coaching_topics",
    );
    expect(topics?.options.map((option) => option.label)).toEqual([
      "Salon Tours",
      "Selling Memberships",
      "Lotion Basics",
    ]);
  });

  it("keeps every tick readable, and shows none it did not have", async () => {
    await historicalForm();
    const loaded = await loadInstance("old-form");

    const stored = loaded!.values.find((value) => value.fieldKey === "coaching_topics");
    expect(stored?.checked).toEqual(["salon_tours", "lotion_basics"]);

    // Each stored key still names a real option ON ITS OWN VERSION. This is the
    // assertion that would fail if the re-issue had edited the version in place
    // rather than publishing a new one.
    const topics = checkboxGroupsForVariant(loaded!.version.document, null).find(
      (group) => group.key === "coaching_topics",
    );
    const optionKeys = new Set(topics!.options.map((option) => option.key));
    for (const ticked of stored!.checked) {
      expect(optionKeys.has(ticked), ticked).toBe(true);
    }
  });

  it("is not migrated, rewritten or renumbered by the re-issue", async () => {
    await historicalForm();
    const before = JSON.stringify(store.form_instance_values);

    await ensureTemplateLibrary("system");

    expect(JSON.stringify(store.form_instance_values)).toBe(before);
    const loaded = await loadInstance("old-form");
    expect(loaded!.instance.templateVersionId).toBe("coaching-v0");
    expect(loaded!.instance.status).toBe("finalized");
  });

  it("PRINTS against its own version, not against the one now published", async () => {
    /*
     * THE END OF THE CHAIN, AND THE ONE A MANAGER WOULD ACTUALLY SEE. A signed
     * coaching record re-opened and re-printed has to come out saying what it
     * said when it was signed. The version pointer is only half of that; this
     * runs the real renderer over the version `loadInstance` resolved and reads
     * the bytes back, because "the pointer is right" and "the page is right"
     * have been different things before.
     */
    await historicalForm();
    await ensureTemplateLibrary("system");

    const loaded = await loadInstance("old-form");
    const bytes = renderFormPdf(
      loaded!.version.document,
      null,
      { values: {}, checked: { coaching_topics: ["salon_tours"] } },
      {
        templateName: "Coaching Form",
        templateVersion: loaded!.version.version,
        employeeName: loaded!.instance.employeeName,
        formDate: "2026-01-04",
        status: "finalized",
      },
    );

    const { getDocumentProxy, extractText } = await import("unpdf");
    const { text } = await extractText(await getDocumentProxy(Uint8Array.from(bytes)), {
      mergePages: true,
    });

    // Its own options, and its own version stamped in the footer.
    expect(text).toContain("Salon Tours");
    expect(text).toContain("Lotion Basics");
    expect(text).toContain(`Template v${loaded!.version.version}`);
    // Not one word of the form that replaced it.
    expect(text).not.toContain("Store Tours");
    expect(text).not.toContain("Completing the Engagement");
  });

  it("does not stop a NEW form using the re-issued document", async () => {
    await historicalForm();
    const instance = await startCoachingForm();
    const loaded = await loadInstance(instance.id);

    expect(loaded!.instance.templateVersionId).toBe(currentCoachingVersionId());
    expect(loaded!.instance.templateVersionId).not.toBe("coaching-v0");
  });
});
