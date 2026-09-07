import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { extractText, getDocumentProxy } from "unpdf";

import { renderFormPdf } from "./pdf-render";
import type { FormDocument } from "./document";

/** The same extraction the PDF renderer's own suite uses. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
  return text;
}

/**
 * ============================================================================
 * A FORM IS FILLED AGAINST ONE VERSION, AND KEEPS IT FOREVER
 * ============================================================================
 *
 * Two rules, and they only look like one:
 *
 *   A NEW form pins the CURRENT PUBLISHED version, resolved at CREATE time.
 *   An EXISTING form uses the version stored on the row, resolved never again.
 *
 * Both matter for the same reason. The official Coaching Form is being
 * corrected in a separate workstream; when that version is published, a new
 * coaching form must use it with no change to any chat code. And a coaching
 * record filed last month must print exactly what its manager signed off, even
 * though the library has moved on — otherwise downloading an HR document a year
 * later silently produces a different document.
 *
 * ============================================================================
 * WHY THIS FIXTURE HOLDS TWO REAL VERSIONS
 * ============================================================================
 *
 * A single-version fixture cannot tell "pins the current one" apart from "pins
 * the only one". So v1 and v2 differ in a way that is visible in the rendered
 * output — different checkbox options, different section labels — and every
 * assertion below reads the OUTPUT rather than the id alone.
 *
 * The two documents here are TEST FIXTURES, not a proposal for the official
 * form. Template content belongs to the Forms-template workstream; this file
 * asserts the plumbing carries whatever they publish.
 */

const store: FakeStore = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
};

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => fakeSupabase(store),
}));

const { createInstance, loadInstance } = await import("./instances");

const TEMPLATE_ID = "tpl-coaching";
const V1 = "version-1";
const V2 = "version-2";

/** The shape being replaced: an "OLD TOPIC" list. */
function documentV1(): FormDocument {
  return {
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
      {
        kind: "checkbox_group",
        key: "coaching_topics",
        label: "Topic Of Coaching",
        options: [
          { key: "old_topic_alpha", label: "OLD TOPIC ALPHA" },
          { key: "old_topic_beta", label: "OLD TOPIC BETA" },
        ],
        responsibility: "ai",
        columns: 2,
      },
      {
        kind: "field",
        field: {
          key: "coaching_details",
          label: "Details",
          input: "long_text",
          responsibility: "ai",
        },
      },
    ],
  };
}

/** The shape replacing it: a different list, and a section v1 does not have. */
function documentV2(): FormDocument {
  return {
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
      { kind: "section", label: "NEW OFFICIAL SECTION" },
      {
        kind: "checkbox_group",
        key: "coaching_topics",
        label: "Topic Of Coaching",
        options: [
          { key: "new_topic_punctuality", label: "NEW TOPIC PUNCTUALITY" },
          { key: "new_topic_other", label: "NEW TOPIC OTHER" },
        ],
        responsibility: "ai",
        columns: 2,
      },
      {
        kind: "field",
        field: {
          key: "coaching_details",
          label: "Details",
          input: "long_text",
          responsibility: "ai",
        },
      },
    ],
  };
}

function versionRow(id: string, version: number, document: FormDocument) {
  return {
    id,
    template_id: TEMPLATE_ID,
    version,
    status: "published",
    document,
    variants: [],
    notes: "",
    created_by: "system",
    created_at: `2026-0${version}-01T00:00:00Z`,
    published_at: `2026-0${version}-01T00:00:00Z`,
    published_by: "system",
  };
}

/** Points `form_template_current` at a version, as publishing does. */
function publish(versionId: string) {
  current.length = 0;
  current.push({ template_id: TEMPLATE_ID, version_id: versionId });
}

/*
 * `form_templates` and `form_template_current` are optional on `FakeStore`
 * because most suites do not need them. This one always seeds them, so they are
 * narrowed once here rather than at every use.
 */
const templates = store.form_templates!;
const current = store.form_template_current!;

beforeEach(() => {
  store.form_instances.length = 0;
  store.form_instance_values.length = 0;
  store.form_instance_events.length = 0;
  store.form_template_versions.length = 0;
  templates.length = 0;
  current.length = 0;

  templates.push({ id: TEMPLATE_ID, key: "coaching", active: true });
  store.form_template_versions.push(versionRow(V1, 1, documentV1()));
  store.form_template_versions.push(versionRow(V2, 2, documentV2()));
  // v2 is what the library currently publishes.
  publish(V2);
});

function newCoachingForm() {
  return createInstance({
    templateKey: "coaching",
    variantKey: null,
    employeeName: "Sarah Test",
    locationId: null,
    locationName: null,
    createdBy: "user-a",
    createdByRole: "admin",
    source: "ask_sunny",
  });
}

/* ============================================ the fixture can tell them apart */

describe("TV-0. the two versions are genuinely different", () => {
  it("differ in the output, not only in their ids", () => {
    // The guard on the guard: an assertion on rendered text proves nothing if
    // both documents render the same thing.
    const one = JSON.stringify(documentV1());
    const two = JSON.stringify(documentV2());

    expect(one).not.toBe(two);
    expect(one).toContain("OLD TOPIC ALPHA");
    expect(one).not.toContain("NEW TOPIC PUNCTUALITY");
    expect(two).toContain("NEW TOPIC PUNCTUALITY");
    expect(two).not.toContain("OLD TOPIC ALPHA");
  });
});

/* ==================================================== a NEW form pins current */

describe("TV-1. a new coaching form pins the CURRENT published version", () => {
  it("stores v2's id on the instance", async () => {
    const instance = await newCoachingForm();
    expect(instance.templateVersionId).toBe(V2);

    /*
     * The version NUMBER is read through the loaded version row rather than off
     * the instance: `template_version` is a column of the
     * `form_instance_overview` VIEW, and the fake serves that view from the raw
     * table, so it has no join to supply it. The id is the authority either
     * way — the number is derived from it.
     */
    const loaded = await loadInstance(instance.id);
    expect(loaded!.version.version).toBe(2);
  });

  it("follows the pointer when publishing moves it", async () => {
    /*
     * THE ACCEPTANCE CRITERION, stated as a test: publishing a different
     * version changes what a NEW form pins, with no code change anywhere.
     */
    publish(V1);
    expect((await newCoachingForm()).templateVersionId).toBe(V1);

    publish(V2);
    expect((await newCoachingForm()).templateVersionId).toBe(V2);
  });

  it("refuses rather than guessing when nothing is published", async () => {
    current.length = 0;
    await expect(newCoachingForm()).rejects.toThrow(/no published version/i);
  });
});

/* ================================================ the editor reads the pin */

describe("TV-2. the inline editor renders the instance's PINNED version", () => {
  it("serves v2's blocks for a form created now", async () => {
    const instance = await newCoachingForm();
    const loaded = await loadInstance(instance.id)!;

    const rendered = JSON.stringify(loaded!.version.document);
    expect(rendered).toContain("NEW TOPIC PUNCTUALITY");
    expect(rendered).toContain("NEW OFFICIAL SECTION");
    expect(rendered).not.toContain("OLD TOPIC ALPHA");
  });

  it("serves v1's blocks for a form filled against v1, even though v2 is current", async () => {
    /*
     * THE OTHER HALF, AND THE ONE THAT PROTECTS SIGNED RECORDS. A form filed
     * last month must open as the document its manager reviewed — not as
     * whatever the library publishes today.
     */
    publish(V1);
    const old = await newCoachingForm();
    publish(V2);

    const loaded = await loadInstance(old.id);
    const rendered = JSON.stringify(loaded!.version.document);

    expect(loaded!.instance.templateVersionId).toBe(V1);
    expect(rendered).toContain("OLD TOPIC ALPHA");
    expect(rendered).not.toContain("NEW TOPIC PUNCTUALITY");
  });

  it("does not migrate an existing instance when the pointer moves", async () => {
    const old = await newCoachingForm();
    expect(old.templateVersionId).toBe(V2);

    publish(V1);
    const reloaded = await loadInstance(old.id);

    // Still v2. Versioning is the point, not an accident to be tidied up.
    expect(reloaded!.instance.templateVersionId).toBe(V2);
  });
});

/* ==================================================== the PDF reads the pin */

describe("TV-3. the PDF renders the instance's PINNED version", () => {
  async function pdfFor(instanceId: string) {
    const loaded = await loadInstance(instanceId);
    const bytes = renderFormPdf(loaded!.version.document, null, { values: {}, checked: {} }, {
      templateName: "Coaching Form",
      templateVersion: loaded!.instance.templateVersion,
      employeeName: loaded!.instance.employeeName,
      formDate: loaded!.instance.formDate,
      locationName: null,
      reference: loaded!.instance.id.slice(0, 8),
      status: loaded!.instance.status,
    });
    return pdfText(bytes);
  }

  it("prints v2's options for a form created now", async () => {
    const instance = await newCoachingForm();
    const text = await pdfFor(instance.id);

    expect(text).toContain("NEW TOPIC PUNCTUALITY");
    expect(text).not.toContain("OLD TOPIC ALPHA");
  });

  it("prints v1's options for a v1 record, after v2 is published", async () => {
    /*
     * Downloading a filed HR document a year later must not quietly produce a
     * different document.
     */
    publish(V1);
    const old = await newCoachingForm();
    publish(V2);

    const text = await pdfFor(old.id);
    expect(text).toContain("OLD TOPIC ALPHA");
    expect(text).not.toContain("NEW TOPIC PUNCTUALITY");
  });

  it("takes its document from the loaded instance, never from the library", () => {
    const route = readFileSync(
      "src/app/api/forms/instances/[id]/pdf/route.ts",
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(route).toContain("renderFormPdf(loaded.version.document");
    // Re-resolving here is the defect this whole file exists to prevent.
    expect(route).not.toContain("getCurrentVersion");
    expect(route).not.toContain("TEMPLATE_SEEDS");
  });
});

/* =================================== nothing downstream owns the field list */

describe("TV-4. no layer duplicates the Coaching Form's structure", () => {
  const code = (path: string) =>
    readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

  const RENDER_PATH = [
    "src/features/chat/chat-screen.tsx",
    "src/features/chat/message-bubble.tsx",
    "src/features/chat/inline-form.tsx",
    "src/features/chat/create-inline-form.ts",
    "src/features/forms/document/responsive-form.tsx",
    "src/lib/ai/form-proposal.ts",
    "src/lib/forms/proposal.ts",
    "src/lib/forms/pdf-render.ts",
  ];

  it.each(RENDER_PATH)("%s names no coaching field or option", (path) => {
    /*
     * THE ACCEPTANCE CRITERION FROM THE OTHER SIDE. If v3 is published
     * tomorrow, Ask Sunny must use it without a line changing here — which is
     * only true while no layer holds its own copy of the field list.
     */
    const source = code(path);
    for (const owned of [
      "coaching_topics",
      "coaching_type",
      "coaching_details",
      "other_topic",
      "Topic Of Coaching",
      "Type Of Coaching",
      "Under Performance",
      "Re-Training",
    ]) {
      expect(source, `${path} names ${owned}`).not.toContain(owned);
    }
  });

  it.each(RENDER_PATH)("%s imports no seeded template data", (path) => {
    const source = code(path);
    for (const seeded of ["TEMPLATE_SEEDS", "DEMO_FORM_TEMPLATES", "forms/library"]) {
      expect(source, `${path} imports ${seeded}`).not.toContain(seeded);
    }
  });

  it("renders the editor from the loaded version's document", () => {
    const inline = code("src/features/chat/inline-form.tsx");
    expect(inline).toContain("document={loaded.version.document}");
  });
});
