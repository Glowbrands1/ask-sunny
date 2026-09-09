import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

/**
 * ============================================================================
 * UPLOAD → EXTRACT → DRAFT → REVIEW → PUBLISH, AND WHAT EACH STEP MAY NOT DO
 * ============================================================================
 *
 * Extraction can be wrong. Everything here is about what happens when it is,
 * and the answer is the same at every step: THE LIVE FORM DOES NOT MOVE until a
 * person publishes. A proposal is an ordinary draft, so it inherits the rules
 * the engine already enforces — one draft at a time, a published version cannot
 * be edited, publishing archives the version it replaces — and these tests
 * check that the new path really does go through them rather than around them.
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

const {
  ensureTemplateLibrary,
  getCurrentVersion,
  listVersions,
  openProposalDraft,
  publishDraft,
  openDraft,
} = await import("../repository");
const { ingestSourceDocument } = await import("./index");
const { loadInstance } = await import("../instances");
const { coachingDocument } = await import("../library");
const { proposalNeedsAttention } = await import("./proposal");

const fixture = (name: string) =>
  new Uint8Array(readFileSync(`src/test/fixtures/forms/${name}`));

function templateId(key: string) {
  return String(store.form_templates!.find((row) => row.key === key)!.id);
}
function currentVersionId(key: string) {
  return String(
    store.form_template_current!.find((row) => row.template_id === templateId(key))!.version_id,
  );
}

async function proposeFromFixture(name: string) {
  const current = await getCurrentVersion(templateId("coaching"));
  const read = await ingestSourceDocument({
    bytes: fixture(name),
    fileName: name,
    current: current?.document ?? null,
    refine: false,
  });
  if (!read.ok) throw new Error(`fixture did not read: ${read.reason}`);
  return openProposalDraft(
    templateId("coaching"),
    {
      document: read.document,
      proposal: {
        assetId: "asset-1",
        fileName: name,
        format: read.format,
        extractedAt: "2026-09-07T00:00:00.000Z",
        extractedBy: "dana",
        ...read.report,
      },
      notes: `Proposed from ${name}.`,
    },
    "dana",
  );
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

describe("uploading a document against an existing form", () => {
  it("creates a DRAFT and does not touch the live version", async () => {
    const before = currentVersionId("coaching");

    const opened = await proposeFromFixture("coaching-form.pdf");

    expect("draft" in opened).toBe(true);
    if (!("draft" in opened)) return;
    expect(opened.draft.status).toBe("draft");
    // The one that matters: the template still points where it pointed.
    expect(currentVersionId("coaching")).toBe(before);
    expect(opened.draft.id).not.toBe(before);
  });

  it("stays the same template — no second Coaching form appears", async () => {
    await proposeFromFixture("coaching-form.pdf");

    expect(store.form_templates!.filter((row) => row.key === "coaching")).toHaveLength(1);
    /*
     * Fourteen: the thirteen paper-sourced templates plus the framework-defined
     * Follow-Up Coaching Form. The number is asserted rather than derived so
     * that a template appearing by accident — a seeder that inserts on a key it
     * should have matched — is caught here.
     */
    expect(store.form_templates).toHaveLength(14);
    // Two versions of one template, addressed by the same stable key.
    expect(await listVersions(templateId("coaching"))).toHaveLength(2);
  });

  it("records which upload the draft came from, and what to check", async () => {
    const opened = await proposeFromFixture("coaching-form.pdf");
    if (!("draft" in opened)) throw new Error("refused");

    expect(opened.draft.proposal).toMatchObject({
      assetId: "asset-1",
      fileName: "coaching-form.pdf",
      format: "pdf",
    });
    // This document reads cleanly, so there is nothing flagged — which the
    // review screen shows as "proposed" rather than "needs review".
    expect(proposalNeedsAttention(opened.draft.proposal!)).toBe(false);
    expect(opened.draft.proposal!.stats).toMatchObject({ groups: 2, signatures: 2 });
  });

  it("proposes the same form from the Word file as from the PDF", async () => {
    const fromPdf = await proposeFromFixture("coaching-form.pdf");
    if (!("draft" in fromPdf)) throw new Error("refused");
    const pdfDocument = fromPdf.draft.document;

    // Clear the draft so the second upload is not refused, exactly as an
    // administrator discarding it would.
    store.form_template_versions = store.form_template_versions.filter(
      (row) => row.id !== fromPdf.draft.id,
    );

    const fromDocx = await proposeFromFixture("coaching-form.docx");
    if (!("draft" in fromDocx)) throw new Error("refused");

    expect(fromDocx.draft.document).toEqual(pdfDocument);
  });

  it("refuses rather than destroying a draft somebody is working on", async () => {
    const { draft } = await openDraft(templateId("coaching"), "priya");

    const opened = await proposeFromFixture("coaching-form.pdf");

    expect(opened).toEqual({
      refused: expect.stringContaining(`version ${draft.version}`),
    });
    // Their draft is untouched, and no proposal was written.
    expect(await listVersions(templateId("coaching"))).toHaveLength(2);
  });
});

describe("publishing a proposal", () => {
  it("makes it the live version, and archives the one it replaced", async () => {
    const replaced = currentVersionId("coaching");
    const opened = await proposeFromFixture("coaching-form.pdf");
    if (!("draft" in opened)) throw new Error("refused");

    await publishDraft(opened.draft.id, "dana");

    expect(currentVersionId("coaching")).toBe(opened.draft.id);
    const versions = await listVersions(templateId("coaching"));
    expect(versions.find((version) => version.id === replaced)).toMatchObject({
      status: "archived",
    });
    // Archived, not deleted: a form signed against it still has to render.
    expect(versions).toHaveLength(2);
  });

  it("keeps the provenance stamp, so the live form says where it came from", async () => {
    const opened = await proposeFromFixture("coaching-form.pdf");
    if (!("draft" in opened)) throw new Error("refused");

    const published = await publishDraft(opened.draft.id, "dana");

    expect(published.status).toBe("published");
    expect(published.proposal).toMatchObject({ fileName: "coaching-form.pdf" });
  });

  it("leaves a form signed against the old version reading against it", async () => {
    const signedAgainst = currentVersionId("coaching");
    store.form_instances.push({
      id: "old-form",
      template_id: templateId("coaching"),
      template_version_id: signedAgainst,
      variant_key: null,
      employee_name: "Priya Raghunathan",
      status: "finalized",
      source: "manual",
      created_by: "dana",
      created_at: "2026-02-01T10:00:00.000Z",
      form_date: "2026-02-01",
    });
    store.form_instance_values.push({
      instance_id: "old-form",
      field_key: "coaching_topics",
      value: null,
      checked: ["store_tours"],
      filled_by: "ai",
      provenance: {},
    });

    const opened = await proposeFromFixture("coaching-form.pdf");
    if (!("draft" in opened)) throw new Error("refused");
    await publishDraft(opened.draft.id, "dana");

    const loaded = await loadInstance("old-form");
    expect(loaded!.instance.templateVersionId).toBe(signedAgainst);
    expect(loaded!.instance.status).toBe("finalized");
    expect(
      loaded!.values.find((value) => value.fieldKey === "coaching_topics")?.checked,
    ).toEqual(["store_tours"]);
  });
});

describe("when extraction fails", () => {
  it("leaves the live form, the drafts and the versions exactly as they were", async () => {
    const before = JSON.stringify(store);

    const read = await ingestSourceDocument({
      bytes: new TextEncoder().encode("this is a text file, not a form"),
      fileName: "notes.txt",
      current: coachingDocument(),
      refine: false,
    });

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toMatch(/not a PDF or a Word document/);
    expect(JSON.stringify(store)).toBe(before);
  });

  it("refuses a Word 97-2003 file, and says how to make it readable", async () => {
    const read = await ingestSourceDocument({
      bytes: fixture("prescreen-form.doc"),
      fileName: "prescreen-form.doc",
      current: null,
      refine: false,
    });

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.format).toBe("doc");
    expect(read.reason).toMatch(/Save As/);
  });

  it("refuses a damaged Word file without throwing", async () => {
    const damaged = fixture("coaching-form.docx");
    damaged.set([0, 0, 0, 0], damaged.byteLength - 10);

    const read = await ingestSourceDocument({
      bytes: damaged,
      fileName: "damaged.docx",
      current: null,
      refine: false,
    });

    expect(read.ok).toBe(false);
  });

  it("refuses an empty document rather than proposing an empty form", async () => {
    const read = await ingestSourceDocument({
      bytes: new TextEncoder().encode("%PDF-1.7\nnot really a pdf"),
      fileName: "empty.pdf",
      current: null,
      refine: false,
    });
    expect(read.ok).toBe(false);
  });

  it("goes by the bytes, so a Word file named .pdf still reads as Word", async () => {
    const read = await ingestSourceDocument({
      bytes: fixture("coaching-form.docx"),
      fileName: "coaching-form.pdf",
      current: coachingDocument(),
      refine: false,
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.format).toBe("docx");
  });
});
