import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMBEDDING_DIMENSIONS } from "@/lib/config/models";

/**
 * INGEST_FAILURE_KEEPS_LAST_GOOD_ENABLED. Ported from the sibling app (QA, 10 Nov 2026): a searchable Woven document
 * (version 1, indexed 6 Oct 2026) got a newer file that is a scan over the OCR cap; the re-ingest failed with "This
 * scanned PDF has 45 pages; it can be read automatically up to 40." and the row became "failed", so its stored sections
 * dropped out of search. The document here is invented. Supabase, extraction and embeddings are faked.
 */
const ORIGINAL = { ...process.env };
const FLAG = "INGEST_FAILURE_KEEPS_LAST_GOOD_ENABLED";
const TOO_MANY = "This scanned PDF has 45 pages; it can be read automatically up to 40.";
const DOC_ID = "45e10eea-5532-5fb7-8e30-90e9df3ded8b";

interface Op {
  table: string;
  verb: string;
  payload: unknown;
}

const EXISTING = {
  id: DOC_ID,
  knowledge_scope_id: "jba-core",
  title: "Equipment Care Guide",
  original_filename: "Equipment-Care-Guide.pdf",
  storage_path: `jba-core/${DOC_ID}/v4/Equipment-Care-Guide.pdf`,
  size_bytes: 8314891,
  status: "failed",
  indexed: false,
  indexed_at: "2026-10-06T12:41:09Z",
  version: 4,
  previous_versions: [1, 2, 3].map((version) => ({ version, sizeBytes: version === 1 ? 11257584 : 8314891, note: "Updated in Woven" })),
  created_at: "2026-10-06T12:40:45Z",
  uploaded_by_name: "Woven sync",
  content_hash: null,
  source: "woven",
};

async function load(options: { existing?: Record<string, unknown> | null; chunkVersions?: number[]; uploadErrorFor?: string } = {}) {
  vi.resetModules();
  const ops: Op[] = [];
  const uploads: string[] = [];
  const { IngestionError } = await import("./errors");
  vi.doMock("./extract", () => ({
    extractDocument: async () => {
      throw new IngestionError("ocr_too_many_pages", TOO_MANY, 422);
    },
  }));
  vi.doMock("@/lib/embeddings", () => ({
    getEmbeddingProvider: () => ({ name: "fake", model: "gte-small", dimensions: EMBEDDING_DIMENSIONS, configured: true, embedDocuments: async () => [], embedQuery: async () => [] }),
  }));
  vi.doMock("@/lib/supabase/server", () => ({
    KNOWLEDGE_BUCKET: "knowledge-documents",
    getSupabaseAdmin: () => ({
      from(table: string) {
        let verb = "select";
        let payload: unknown = null;
        let one = false;
        const settle = async () => {
          ops.push({ table, verb, payload });
          if (verb === "select" && table === "knowledge_documents") {
            const row = options.existing === undefined ? EXISTING : options.existing;
            return { data: one ? row : row ? [row] : [], error: null };
          }
          if (verb === "select" && table === "knowledge_chunks") {
            return { data: (options.chunkVersions ?? [1]).map((version) => ({ version })), error: null };
          }
          return { data: verb === "update" ? { id: DOC_ID, ...(payload as object) } : null, error: null };
        };
        const builder: Record<string, unknown> = {};
        Object.assign(builder, {
          select: () => builder,
          eq: () => builder,
          neq: () => builder,
          ilike: () => builder,
          order: () => builder,
          limit: () => builder,
          upsert: (values: unknown) => ((verb = "upsert"), (payload = values), builder),
          update: (values: unknown) => ((verb = "update"), (payload = values), builder),
          insert: (values: unknown) => ((verb = "insert"), (payload = values), builder),
          delete: () => ((verb = "delete"), builder),
          single: () => ((one = true), settle()),
          maybeSingle: () => ((one = true), settle()),
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => settle().then(resolve, reject),
        });
        return builder;
      },
      storage: {
        from: () => ({
          upload: async (path: string) => {
            uploads.push(path);
            return { data: { path }, error: null };
          },
        }),
      },
    }),
  }));
  vi.doMock("@/lib/knowledge/mappers", () => ({ rowToDocument: (row: unknown) => row }));
  const { ingestDocument } = await import("./pipeline");
  return { ops, uploads, ingestDocument };
}

const verdict = (ops: Op[]) =>
  ops.filter((op) => op.table === "knowledge_documents" && op.verb === "update" && typeof (op.payload as { status?: unknown }).status === "string").at(-1)
    ?.payload as Record<string, unknown>;

const sync = () => ({
  file: new Blob(["%PDF-1.4 scan"], { type: "application/pdf" }),
  fileName: "Equipment-Care-Guide.pdf",
  mimeType: "application/pdf",
  title: "Equipment Care Guide",
  category: "operations" as never,
  scopeId: "jba-core",
  uploadedByName: "Woven sync",
  source: "woven" as const,
  documentId: DOC_ID,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SECRET_KEY = ["sb", "secret", "TESTFIXTURE"].join("_");
});
afterEach(() => {
  process.env = { ...ORIGINAL };
  for (const name of ["./extract", "@/lib/embeddings", "@/lib/supabase/server", "@/lib/knowledge/mappers"]) vi.doUnmock(name);
  vi.resetModules();
});

describe("a failed newer file never hides the document's last good version", () => {
  it("off (production today): the row becomes failed and leaves search (the bug)", async () => {
    process.env[FLAG] = "";
    const { ops, ingestDocument } = await load();
    await expect(ingestDocument(sync())).rejects.toMatchObject({ code: "ocr_too_many_pages" });
    expect(verdict(ops)).toMatchObject({ status: "failed", indexed: false, failure_reason: TOO_MANY });
  });

  it("on: the row is put back on version 1, indexed, with its own file and size; the error still reaches the sync", async () => {
    process.env[FLAG] = "true";
    const { ops, uploads, ingestDocument } = await load();
    await expect(ingestDocument(sync())).rejects.toMatchObject({ code: "ocr_too_many_pages" });
    const final = verdict(ops);
    expect(final).toMatchObject({
      status: "indexed",
      indexed: true,
      version: 1,
      storage_path: `jba-core/${DOC_ID}/v1/Equipment-Care-Guide.pdf`,
      size_bytes: 11257584,
    });
    expect(String(final.failure_reason)).toContain("the last good version (v1) is still in use");
    expect(String(final.failure_reason)).toContain(TOO_MANY);
    // The failed attempt was stored past every version in the history.
    expect(uploads).toEqual([`jba-core/${DOC_ID}/v5/Equipment-Care-Guide.pdf`]);
  });

  it("on: after being put back on v1, the next attempt is v5 again past the history, never v2's stored path", async () => {
    process.env[FLAG] = "true";
    const restored = { ...EXISTING, version: 1, status: "indexed", indexed: true, previous_versions: [1, 2, 3, 4].map((version) => ({ version, sizeBytes: 1, note: "Updated in Woven" })) };
    const { uploads, ingestDocument } = await load({ existing: restored });
    await expect(ingestDocument(sync())).rejects.toMatchObject({ code: "ocr_too_many_pages" });
    expect(uploads).toEqual([`jba-core/${DOC_ID}/v5/Equipment-Care-Guide.pdf`]);
  });

  it("on: a document with no earlier chunks fails as before", async () => {
    process.env[FLAG] = "true";
    const { ops, ingestDocument } = await load({ chunkVersions: [] });
    await expect(ingestDocument(sync())).rejects.toMatchObject({ code: "ocr_too_many_pages" });
    expect(verdict(ops)).toMatchObject({ status: "failed", indexed: false });
  });

  it("on: a first ingest (never indexed) fails as before", async () => {
    process.env[FLAG] = "true";
    const { ops, ingestDocument } = await load({ existing: null });
    await expect(ingestDocument(sync())).rejects.toMatchObject({ code: "ocr_too_many_pages" });
    expect(verdict(ops)).toMatchObject({ status: "failed" });
  });
});
