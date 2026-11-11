import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMBEDDING_DIMENSIONS } from "@/lib/config/models";

/**
 * WOVEN_DUPLICATE_CONTENT_HOLD_ENABLED. QA, 10 Nov 2026: the live Woven documents "14K Gold Rush" and "Nothing But
 * Bronze" had identical content (the Nothing But Bronze sheet), all indexed, so a 14K Gold Rush question got Nothing But
 * Bronze's answer. A Woven file whose text matches another live document with a different title is not indexed; the
 * first one stays. Supabase, extraction and embeddings are faked.
 */
const ORIGINAL = { ...process.env };
const FLAG = "WOVEN_DUPLICATE_CONTENT_HOLD_ENABLED";

interface Op {
  table: string;
  verb: string;
  payload: unknown;
}

async function load(options: { sameContent?: { id: string; title: string }[] } = {}) {
  vi.resetModules();
  const ops: Op[] = [];
  const inserted: unknown[] = [];
  vi.doMock("./extract", () => ({
    extractDocument: async () => ({ segments: [{ text: "Nothing But Bronze. Apply evenly after the session. ".repeat(20), locator: "Page 1", page: 1, section: null }], characterCount: 1000, pageCount: 1 }),
  }));
  vi.doMock("@/lib/embeddings", () => ({
    getEmbeddingProvider: () => ({
      name: "fake",
      model: "gte-small",
      dimensions: EMBEDDING_DIMENSIONS,
      configured: true,
      embedDocuments: async (texts: string[]) => texts.map(() => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0)),
      embedQuery: async () => [],
    }),
  }));
  vi.doMock("@/lib/supabase/server", () => ({
    KNOWLEDGE_BUCKET: "knowledge-documents",
    getSupabaseAdmin: () => ({
      from(table: string) {
        let verb = "select";
        let payload: unknown = null;
        let filteredByHash = false;
        const settle = async () => {
          ops.push({ table, verb, payload });
          if (table === "knowledge_chunks" && verb === "insert") inserted.push(...(payload as unknown[]));
          if (verb === "select" && table === "knowledge_documents") return { data: filteredByHash ? (options.sameContent ?? []) : null, error: null };
          return { data: verb === "update" ? { id: "doc-14k", ...(payload as object) } : null, error: null };
        };
        const builder: Record<string, unknown> = {};
        Object.assign(builder, {
          select: () => builder,
          eq: (column: string) => ((filteredByHash ||= column === "content_hash"), builder),
          neq: () => builder,
          ilike: () => builder,
          order: () => builder,
          limit: () => builder,
          upsert: (values: unknown) => ((verb = "upsert"), (payload = values), builder),
          update: (values: unknown) => ((verb = "update"), (payload = values), builder),
          insert: (values: unknown) => ((verb = "insert"), (payload = values), builder),
          delete: () => ((verb = "delete"), builder),
          single: () => settle(),
          maybeSingle: () => settle(),
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => settle().then(resolve, reject),
        });
        return builder;
      },
      storage: { from: () => ({ upload: async (path: string) => ({ data: { path }, error: null }) }) },
    }),
  }));
  vi.doMock("@/lib/knowledge/mappers", () => ({ rowToDocument: (row: unknown) => row }));
  const { ingestDocument } = await import("./pipeline");
  return { ops, inserted, ingestDocument };
}

const woven = (title: string) => ({
  file: new Blob(["%PDF-1.4"], { type: "application/pdf" }),
  fileName: `${title}.pdf`,
  mimeType: "application/pdf",
  title,
  category: "operations" as never,
  scopeId: "jba-core",
  uploadedByName: "Woven sync",
  source: "woven" as const,
  documentId: "doc-14k",
});

const verdict = (ops: Op[]) =>
  ops.filter((op) => op.table === "knowledge_documents" && op.verb === "update" && typeof (op.payload as { status?: unknown }).status === "string").at(-1)
    ?.payload as Record<string, unknown>;

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

describe('"14K Gold Rush" with the same content as the live "Nothing But Bronze"', () => {
  const SAME = [{ id: "doc-nbb", title: "Nothing But Bronze" }];

  it("off (production today): indexed a second time (the bug)", async () => {
    const { ops, inserted, ingestDocument } = await load({ sameContent: SAME });
    await ingestDocument(woven("14K Gold Rush"));
    expect(verdict(ops)).toMatchObject({ status: "indexed" });
    expect(inserted.length).toBeGreaterThan(0);
  });

  it("on: not indexed; fails naming the live document, with no chunk written", async () => {
    process.env[FLAG] = "true";
    const { ops, inserted, ingestDocument } = await load({ sameContent: SAME });
    await expect(ingestDocument(woven("14K Gold Rush"))).rejects.toMatchObject({
      code: "duplicate_content",
      message: 'Same file as "Nothing But Bronze"; not indexed a second time.',
    });
    expect(inserted).toEqual([]);
    expect(verdict(ops)).toMatchObject({ status: "failed", indexed: false });
  });

  it("on: the same content under the SAME title (an edition of itself) is indexed as before", async () => {
    process.env[FLAG] = "true";
    const { ops, ingestDocument } = await load({ sameContent: [{ id: "doc-other", title: "14K Gold Rush" }] });
    await ingestDocument(woven("14K Gold Rush"));
    expect(verdict(ops)).toMatchObject({ status: "indexed" });
  });

  it("on: an upload is never held", async () => {
    process.env[FLAG] = "true";
    const { ops, ingestDocument } = await load({ sameContent: SAME });
    await ingestDocument({ ...woven("14K Gold Rush"), source: "upload" as const, documentId: undefined });
    expect(verdict(ops)).toMatchObject({ status: "indexed" });
  });
});
