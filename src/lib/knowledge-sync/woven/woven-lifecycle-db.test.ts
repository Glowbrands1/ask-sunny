import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { answerQuestion } from "@/lib/ai/server-ask";
import { groundPolicy } from "@/lib/forms/policy-grounding";
import { ingestDocument } from "@/lib/ingestion/pipeline";
import { activeKnowledgeCorpus } from "@/lib/knowledge/corpus";
import { SupabaseKnowledgeProvider } from "@/lib/knowledge/providers/supabase";
import { minimalPdf } from "@/test/minimal-pdf";

import type { SyncReport } from "../types";
import { WovenIntoKnowledge } from "./integration-support";
import { LIVE_STATUS, PASSWORD, USERNAME, uuid } from "./test-support";

/* A fresh PGlite database per test: its start-up is slow under a parallel suite. */
vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

/**
 * ============================================================================
 * FILE LIBRARY, PROCEDURES AND THE CURRENT / SUPERSEDED / RETIRED LIFECYCLE,
 * ON THE REAL SCHEMA
 * ============================================================================
 *
 * The fake Woven serves real (minimal) PDFs; everything from the connector
 * down is the production path — the engine, the Supabase sink,
 * `ingestDocument`, `match_knowledge_chunks`, the manual lookup and the chat
 * answer — on the repository's own migrations (PGlite). Only the embedding
 * model (lexical, so questions use the documents' words) and the chat model
 * call are substitutes.
 */

const model = vi.hoisted(() => ({ input: null as Record<string, unknown> | null }));

vi.mock("@/lib/config/server-env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/server-env")>()),
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
}));
vi.mock("@/lib/ai/call-claude", () => ({
  callClaude: async (input: Record<string, unknown>) => {
    model.input = input;
    return "Here is what the document says [S1].";
  },
}));
vi.mock("@/lib/ai/form-proposal", () => ({ proposeFormForTurn: async () => null, suggestFormsForTurn: () => null }));
vi.mock("@/lib/forms/repository", () => ({ listTemplateSummaries: async () => [] }));
vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));
vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => ({ available: false, block: null, reason: "no dataset" }),
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));

const LOTION = ["Lotion guide", "Apply the bronzer lotion after the shower.", "Wait four hours before rinsing the bronzer lotion."];
const LOTION_V2 = ["Lotion guide", "Apply the bronzer lotion to dry skin only.", "Wait six hours before rinsing the bronzer lotion."];
const LOTION_QUESTION = "Lotion guide: apply the bronzer lotion after the shower? Wait hours before rinsing the bronzer lotion?";
const LOTION_V2_QUESTION = "Lotion guide: apply the bronzer lotion to dry skin only? Wait six hours before rinsing the bronzer lotion?";

const CHECKLIST = ["Opening checklist", "Count the till float.", "Sanitize every tanning bed before the first guest."];
const CHECKLIST_V2 = ["Opening checklist", "Count the till float twice.", "Sanitize every tanning bed and the lotion bar before the first guest."];
const CHECKLIST_QUESTION = "Opening checklist: count the till float and sanitize every tanning bed before the first guest?";

const MANUAL = ["JBA Policy Manual", "Dress Code for The Company", "Employees are to keep a neat, clean, professional appearance at all times."];
const MANUAL_OLD = ["JBA Policy Manual", "Dress Code for The Company", "Employees are to keep a neat appearance. Denim is allowed on weekends."];
const MANUAL_TITLE = "JBA Policy Manual Edited 5.2025";
const MANUAL_QUESTION = "Dress code for the company: employees keep a neat, clean, professional appearance at all times?";

const FILE = (id: number) => `woven\u0000file_library\u0000${uuid(id)}\u0000file`;
const STORED = "a1b2c3d4-0000-4000-8000-000000003111.pdf";
const OPENING_TEXT = `woven\u0000procedure\u0000${uuid(301)}\u0000content`;
const CHECKLIST_PART = `woven\u0000procedure\u0000${uuid(301)}\u0000attachment:${uuid(3012)}:${STORED}`;

async function ask(question: string) {
  model.input = null;
  return answerQuestion(
    {
      question,
      mode: "standard",
      history: [],
      scopeId: activeKnowledgeCorpus(),
      context: { userName: "Dana Reyes", locationName: "MO Kansas City Wornall", todayIso: "2026-09-30" },
    } as never,
    { role: "salon_director" as never, scope: { level: "salon", primaryAreaId: "loc-0101", alsoCoversAreaIds: [] } } as never,
  );
}
const grounding = () => String(model.input?.grounding ?? "");
const match = (query: string) => new SupabaseKnowledgeProvider().match({ query, scopeId: activeKnowledgeCorpus() });

/** `shown`: what a person sees — which may not even carry the stored file name (the server-only manifest keeps it as the download key). */
function expectNoSecrets(value: unknown, shown = true) {
  const text = JSON.stringify(value);
  for (const secret of [PASSWORD, USERNAME, "WovenSession", "blob.core.windows.net", "sig=", "pAzureFileName", "_FileLibrary_Download", ...(shown ? [STORED] : [])]) {
    expect(text, secret).not.toContain(secret);
  }
}

let h: WovenIntoKnowledge;

function fileLibraryRow(id: number, title: string, updated = "9/1/2026", status = "Published") {
  return { EntityID: uuid(id), Column1: "PDF", Column2: `<a href="#">${title}</a>`, Column3: LIVE_STATUS(status), Column4: "Public", Column5: "<span>1 MB</span>", Column6: updated, Column7: "", Column8: "JB & Associates" };
}

async function uploadByHand(title: string, fileName: string, lines: string[], mimeType = "application/pdf", tags: string[] = []) {
  const bytes = mimeType === "application/pdf" ? minimalPdf(lines) : lines.join("\n");
  const result = await ingestDocument({
    file: new Blob([bytes], { type: mimeType }),
    fileName,
    mimeType,
    title,
    category: "policies_compliance",
    tags,
    scopeId: activeKnowledgeCorpus(),
    uploadedByName: "A manager",
    source: "upload",
  });
  return result.document.id;
}

async function row(id: string) {
  const { rows } = await h.database.db.query<Record<string, unknown>>(
    "select title, source::text as source, status::text as status, indexed, version, superseded_by, original_filename from public.knowledge_documents where id = $1",
    [id],
  );
  return rows[0] ?? null;
}

const reportOf = (outcome: unknown) => (outcome as { report: SyncReport }).report;

beforeEach(async () => {
  h = await WovenIntoKnowledge.create();
  h.contentTypes = ["file_library", "procedure"];
  const s = h.fake.state;
  s.fileLibrary = [fileLibraryRow(401, "Lotion Guide")];
  s.fileLibraryFiles = { [uuid(401)]: { bytes: minimalPdf(LOTION), fileName: "Lotion Guide.pdf" } };
  s.procedures[0]!.attachments[0]!.bytes = minimalPdf(CHECKLIST);
  /* Procedures state no audience: an administrator shares them, as in setup. */
  await h.store.saveDecision({ source: "woven", audienceKey: "(none stated)", decision: "company_wide", decidedBy: "admin:test", decidedAt: h.clock.toISOString() });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await h.close();
});

describe("File Library PDFs, end to end", () => {
  it("downloaded by FileLibraryID, validated, ingested — and chat retrieves and cites it by its title", async () => {
    await h.initial();
    const id = await h.documentId(FILE(401));
    expect(await row(id)).toMatchObject({ title: "Lotion Guide", source: "woven", status: "indexed", indexed: true, version: 1 });
    expect((await h.chunks(id)).map((c) => c.content).join("\n")).toContain("Wait four hours before rinsing");

    const answer = await ask(LOTION_QUESTION);
    expect(grounding()).toContain("Wait four hours before rinsing");
    expect(answer.citations).toEqual([expect.objectContaining({ documentId: id, documentTitle: "Lotion Guide" })]);
    expectNoSecrets(answer.citations);
    expectNoSecrets(await h.store.loadManifest("woven"), false);
  });

  it("unchanged: nothing is downloaded or re-indexed; changed: the SAME document, re-indexed, only the new text answers", async () => {
    await h.initial();
    const id = await h.documentId(FILE(401));
    const downloads = () => h.fake.log.filter((r) => r.path === "/Dashboard/_FileLibrary_Download").length;
    const before = downloads();

    await h.run("sync");
    expect(downloads()).toBe(before);
    expect(await row(id)).toMatchObject({ version: 1, status: "indexed" });

    h.fake.state.fileLibrary[0] = fileLibraryRow(401, "Lotion Guide", "10/1/2026");
    h.fake.state.fileLibraryFiles[uuid(401)]!.bytes = minimalPdf(LOTION_V2);
    await h.run("sync");
    /* Citation identity is kept: the same document id and title, a new version. */
    expect(await h.documentId(FILE(401))).toBe(id);
    expect(await row(id)).toMatchObject({ title: "Lotion Guide", version: 2, status: "indexed" });
    expect((await h.chunks(id)).every((c) => c.version === 2)).toBe(true);

    const answer = await ask(LOTION_V2_QUESTION);
    expect(grounding()).toContain("Wait six hours");
    expect(grounding()).not.toContain("Wait four hours");
    expect(answer.citations).toEqual([expect.objectContaining({ documentId: id, documentTitle: "Lotion Guide" })]);
  });

  it("a new UpdatedOn with identical bytes is a metadata-only update, not a re-index", async () => {
    await h.initial();
    const id = await h.documentId(FILE(401));
    h.fake.state.fileLibrary[0] = fileLibraryRow(401, "Lotion Guide", "10/1/2026");
    const outcome = await h.run("sync");
    /* The file, and the procedure attachment's routine byte re-check. */
    expect(reportOf(outcome).totals.metadataOnly).toBe(2);
    expect(reportOf(outcome).totals.updated).toBe(1);
    expect(await row(id)).toMatchObject({ version: 1 });
  });

  it("an error page instead of the file: that item fails on its own, nothing is indexed for it, the rest syncs", async () => {
    h.fake.state.fileLibrary.push(fileLibraryRow(404, "Broken Guide"));
    h.fake.state.fileLibraryFiles[uuid(404)] = { bytes: "", via: "html" };
    const outcome = await h.initial();
    expect(outcome.status).toBe("succeeded_with_warnings");
    expect(await h.item(FILE(404))).toMatchObject({ state: "ERROR", errorCategory: "woven_not_a_file", inAskSunny: false, knowledgeDocumentId: null });
    expect(await row(await h.documentId(FILE(401)))).toMatchObject({ status: "indexed" });
    expect(await h.documentId(OPENING_TEXT)).toBeTruthy();
  });

  it("unpublished: retired and never retrieved; republished: the same document is back", async () => {
    await h.initial();
    const id = await h.documentId(FILE(401));
    h.fake.state.fileLibrary[0] = fileLibraryRow(401, "Lotion Guide", "9/1/2026", "Unpublished");
    await h.run("sync");
    expect(await row(id)).toMatchObject({ status: "retired", indexed: false });
    expect((await match(LOTION_QUESTION)).some((r) => r.document_id === id)).toBe(false);

    h.fake.state.fileLibrary[0] = fileLibraryRow(401, "Lotion Guide");
    await h.run("sync");
    expect(await h.documentId(FILE(401))).toBe(id);
    expect(await row(id)).toMatchObject({ status: "indexed", indexed: true });
    expect((await ask(LOTION_QUESTION)).citations).toEqual([expect.objectContaining({ documentId: id })]);
  });
});

describe("Procedures: step text and step attachments", () => {
  it("the step text is indexed without the 'Not Provided' placeholder, and the attachment as its own cited document", async () => {
    h.fake.state.procedures[0]!.steps.push({ id: uuid(3013), title: "Music", text: "Not Provided" });
    await h.initial();

    const text = (await h.chunks(await h.documentId(OPENING_TEXT))).map((c) => c.content).join("\n");
    expect(text).toContain("Step 1 — Open the Door");
    expect(text).toContain("Unlock the front door.");
    expect(text).not.toMatch(/not provided/i);

    const attachment = await h.documentId(CHECKLIST_PART);
    expect(await row(attachment)).toMatchObject({ title: "Opening the Salon — Opening Checklist", source: "woven", status: "indexed" });
    const answer = await ask(CHECKLIST_QUESTION);
    expect(answer.citations).toEqual(expect.arrayContaining([expect.objectContaining({ documentId: attachment, documentTitle: "Opening the Salon — Opening Checklist" })]));
    expectNoSecrets(answer.citations);
  });

  it("a reworded step re-indexes the text; the attachment is re-checked by its bytes and re-indexed only when they change", async () => {
    await h.initial();
    const textId = await h.documentId(OPENING_TEXT);
    const attachment = await h.documentId(CHECKLIST_PART);

    h.fake.state.procedures[0]!.steps[0]!.text = "Unlock the front door and disarm the alarm.";
    await h.run("sync");
    expect(await row(textId)).toMatchObject({ version: 2 });
    expect((await h.chunks(textId)).map((c) => c.content).join("\n")).toContain("disarm the alarm");
    /* Same bytes: re-downloaded, compared, left as it was. */
    expect(await row(attachment)).toMatchObject({ version: 1 });
    expect(await h.item(CHECKLIST_PART)).toMatchObject({ state: "UNCHANGED", pendingAction: "none" });

    h.fake.state.procedures[0]!.attachments[0]!.bytes = minimalPdf(CHECKLIST_V2);
    await h.run("sync");
    expect(await row(attachment)).toMatchObject({ version: 2, status: "indexed" });
    expect(await h.item(CHECKLIST_PART)).toMatchObject({ state: "UPDATED" });
    expect((await h.chunks(attachment)).map((c) => c.content).join("\n")).toContain("the lotion bar");
  });

  it("an attachment removed from the step is retired; the procedure's text stays", async () => {
    await h.initial();
    const attachment = await h.documentId(CHECKLIST_PART);
    h.fake.state.procedures[0]!.attachments = [];
    await h.run("sync");
    expect(await row(attachment)).toMatchObject({ status: "retired", indexed: false });
    expect(await row(await h.documentId(OPENING_TEXT))).toMatchObject({ status: "indexed" });
    expect((await match(CHECKLIST_QUESTION)).some((r) => r.document_id === attachment)).toBe(false);
  });

  it("one attachment that cannot be downloaded does not fail the sync", async () => {
    h.fake.state.procedures[1]!.attachments.push({ documentId: uuid(3211), stepIndex: 0, fileName: "Bed Chart.pdf", storedName: "b2c3d4e5-0000-4000-8000-000000003211.pdf", bytes: "<html><body>Error</body></html>" });
    const outcome = await h.initial();
    expect(outcome.status).toBe("succeeded_with_warnings");
    const failed = (await h.store.loadManifest("woven")).find((i) => i.partKey.includes("b2c3d4e5"))!;
    expect(failed).toMatchObject({ state: "ERROR", inAskSunny: false });
    expect(await row(await h.documentId(CHECKLIST_PART))).toMatchObject({ status: "indexed" });
  });
});

describe("a hand upload that a current Woven copy replaces is SUPERSEDED", () => {
  beforeEach(() => {
    h.fake.state.fileLibrary.push(fileLibraryRow(405, MANUAL_TITLE));
    h.fake.state.fileLibraryFiles[uuid(405)] = { bytes: minimalPdf(MANUAL), fileName: `${MANUAL_TITLE}.pdf` };
  });

  it("the old upload stops answering: not retrieved, not cited, not used by the forms — and the manual is the Woven copy", async () => {
    /* The older hand upload, tagged as THE manual, with different (outdated) wording. */
    const upload = await uploadByHand(MANUAL_TITLE, `${MANUAL_TITLE}.pdf`, MANUAL_OLD, "application/pdf", ["official-policy-manual"]);
    const outcome = await h.initial();
    const woven = await h.documentId(FILE(405));

    expect(await row(upload)).toMatchObject({ status: "superseded", indexed: false, superseded_by: woven, source: "upload" });
    expect(await row(woven)).toMatchObject({ status: "indexed", source: "woven" });
    expect(reportOf(outcome).duplicates).toEqual({ superseded: [{ uploadTitle: MANUAL_TITLE, currentTitle: MANUAL_TITLE }], held: [] });
    /* Kept for audit: its chunks are still there. */
    expect((await h.chunks(upload)).length).toBeGreaterThan(0);

    /* Not a lower score — not a candidate at all. */
    expect((await match(MANUAL_QUESTION)).some((r) => r.document_id === upload)).toBe(false);
    expect((await match("neat appearance denim allowed on weekends")).some((r) => r.document_id === upload)).toBe(false);

    const answer = await ask(MANUAL_QUESTION);
    expect(answer.citations.some((c) => c.documentId === upload)).toBe(false);
    expect(answer.citations).toEqual(expect.arrayContaining([expect.objectContaining({ documentId: woven, documentTitle: MANUAL_TITLE })]));
    expect(grounding()).not.toContain("Denim");

    /* Forms: the pinned manual is the Woven copy — found by the tag its predecessor carried — and retrieval never returns the upload. */
    const manual = await new SupabaseKnowledgeProvider().fetchOfficialPolicyManual(activeKnowledgeCorpus());
    expect(manual).toMatchObject({ ok: true, documentId: woven, matchedBy: "tag" });
    const policy = await groundPolicy("Dress code for the company: keep a neat, clean, professional appearance at all times. Denim on weekends.");
    expect(policy.sources.some((s) => s.documentId === upload)).toBe(false);
    expect(policy.passages.map((p) => p.text).join("\n")).not.toContain("Denim");
  });

  it("a title alone, across file types, is not identity: held for review and left exactly as it was", async () => {
    const lookalike = await uploadByHand("Lotion Guide", "lotion-notes.txt", ["My own lotion notes."], "text/plain");
    const outcome = await h.initial();
    expect(await row(lookalike)).toMatchObject({ status: "indexed", indexed: true, superseded_by: null });
    expect(reportOf(outcome).duplicates!.held).toEqual([{ uploadTitle: "Lotion Guide", candidateTitles: ["Lotion Guide"], reason: "title_only" }]);
    expect(reportOf(outcome).attention.map((a) => a.code)).toContain("duplicates_held");
  });

  it("unrelated uploads are never touched", async () => {
    const unrelated = await uploadByHand("Holiday Schedule", "holiday-schedule.pdf", ["Holiday schedule", "Closed on Thanksgiving."]);
    await h.initial();
    expect(await row(unrelated)).toMatchObject({ status: "indexed", superseded_by: null });
  });

  it("an incomplete pass changes no upload; the next complete one does", async () => {
    await h.initial();
    const upload = await uploadByHand(MANUAL_TITLE, `${MANUAL_TITLE}.pdf`, MANUAL);
    h.fake.failures.set("/KnowledgeCenter/_Search_Procedures", 500);
    await h.run("sync");
    expect(await row(upload)).toMatchObject({ status: "indexed" });

    h.fake.failures.clear();
    await h.run("sync");
    expect(await row(upload)).toMatchObject({ status: "superseded", superseded_by: await h.documentId(FILE(405)) });
  });

  it("a Woven update keeps the replacement's identity; retiring it in Woven does not bring the old upload back", async () => {
    const upload = await uploadByHand(MANUAL_TITLE, `${MANUAL_TITLE}.pdf`, MANUAL_OLD);
    await h.initial();
    const woven = await h.documentId(FILE(405));

    h.fake.state.fileLibrary[1] = fileLibraryRow(405, MANUAL_TITLE, "10/1/2026");
    h.fake.state.fileLibraryFiles[uuid(405)]!.bytes = minimalPdf([...MANUAL, "Name tags are worn at all times."]);
    await h.run("sync");
    expect(await h.documentId(FILE(405))).toBe(woven);
    expect(await row(woven)).toMatchObject({ version: 2, title: MANUAL_TITLE });
    expect(await row(upload)).toMatchObject({ status: "superseded", superseded_by: woven });

    h.fake.state.fileLibrary[1] = fileLibraryRow(405, MANUAL_TITLE, "10/1/2026", "Unpublished");
    await h.run("sync");
    expect(await row(woven)).toMatchObject({ status: "retired" });
    expect(await row(upload)).toMatchObject({ status: "superseded" });
    expect((await match(MANUAL_QUESTION)).some((r) => r.document_id === upload || r.document_id === woven)).toBe(false);
  });

  it("a new hand upload never becomes a version of the Woven document of the same title", async () => {
    await h.initial();
    const woven = await h.documentId(FILE(405));
    const upload = await uploadByHand(MANUAL_TITLE, "manual-copy.pdf", MANUAL_OLD);
    expect(upload).not.toBe(woven);
    expect(await row(woven)).toMatchObject({ source: "woven", version: 1 });
  });
});

describe("Courses stay blocked", () => {
  it("are listed and counted, never downloaded or indexed", async () => {
    h.contentTypes = ["course"];
    const outcome = await h.run("preview");
    expect(reportOf(outcome).byType.course).toMatchObject({ blocked: 1, blockedCapabilities: ["course_content"] });
    await h.run("sync");
    expect(await h.documentCount()).toBe(0);
    expect(h.fake.log.some((r) => /\/Course\/(?!_Course_List)/.test(r.path))).toBe(false);
  });
});

describe("on the real manifest tables", () => {
  it("File Library and procedure attachment parts save and re-check through the Supabase store", async () => {
    await h.close();
    h = await WovenIntoKnowledge.create({ realStore: true });
    h.contentTypes = ["file_library", "procedure"];
    h.fake.state.fileLibrary = [fileLibraryRow(401, "Lotion Guide")];
    h.fake.state.fileLibraryFiles = { [uuid(401)]: { bytes: minimalPdf(LOTION), fileName: "Lotion Guide.pdf" } };
    h.fake.state.procedures[0]!.attachments[0]!.bytes = minimalPdf(CHECKLIST);
    await h.store.saveDecision({ source: "woven", audienceKey: "(none stated)", decision: "company_wide", decidedBy: "admin:test", decidedAt: h.clock.toISOString() });

    await h.initial();
    expect(await h.item(CHECKLIST_PART)).toMatchObject({ inAskSunny: true, locator: { procedureId: uuid(301), stepId: uuid(3012), storedFileName: STORED } });
    expect(await h.item(FILE(401))).toMatchObject({ inAskSunny: true, locator: { fileLibraryId: uuid(401) } });
    await h.run("sync");
    expect(await h.item(CHECKLIST_PART)).toMatchObject({ state: "UNCHANGED", pendingAction: "none", inAskSunny: true });
  });
});
