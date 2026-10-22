import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMBEDDING_DIMENSIONS } from "@/lib/config/models";

/**
 * ============================================================================
 * WHAT A FAILED INGESTION LEAVES BEHIND, AND WHEN A DOCUMENT BECOMES CITABLE
 * ============================================================================
 *
 * The pipeline's two load-bearing orderings, asserted rather than commented:
 *
 *   A DOCUMENT IS NEVER CITABLE UNTIL EVERY CHUNK IS STORED. `indexed` flips
 *   true only after the chunk insert returned without error. The retrieval RPC
 *   filters on `indexed = true AND status = 'indexed' AND c.version = d.version`,
 *   so a half-embedded document answering a question is the failure this
 *   prevents.
 *
 *   A FAILURE LEAVES A VISIBLE, NOT-CITABLE RECORD. Status "failed",
 *   `indexed` false, and a reason a manager can act on — not a vanished row and
 *   not a row that still looks indexed.
 *
 * Supabase, the embedding provider and text extraction are all faked. Every
 * operation is recorded in order, because the ORDER is the property.
 */

const ORIGINAL = { ...process.env };

interface Operation {
  table: string;
  verb: string;
  payload: unknown;
}

interface Harness {
  ops: Operation[];
  uploads: string[];
  inserted: Record<string, unknown>[];
  embedded: string[][];
  /** Every pattern passed to `ilike`, in order. */
  likePatterns: string[];
}

/** The final `update` that carries a status — the pipeline's verdict. */
function verdict(ops: Operation[]): Record<string, unknown> | null {
  const updates = ops.filter(
    (op) =>
      op.table === "knowledge_documents" &&
      op.verb === "update" &&
      typeof (op.payload as { status?: unknown })?.status === "string",
  );
  return (updates.at(-1)?.payload as Record<string, unknown>) ?? null;
}

function segment(page: number, text: string) {
  return { text, locator: `Page ${page}`, page, section: null };
}

async function loadPipeline(
  options: {
    /** Pages of extracted text. Each becomes one chunk at these lengths. */
    pages?: string[];
    /** Thrown by the embedding provider instead of returning vectors. */
    embedError?: Error;
    /** Returned by the chunk insert. */
    chunkInsertError?: { message: string } | null;
    /** Rows the title lookup on knowledge_documents returns. */
    existingRows?: Record<string, unknown>[];
  } = {},
) {
  vi.resetModules();

  const harness: Harness = { ops: [], uploads: [], inserted: [], embedded: [], likePatterns: [] };
  const pages =
    options.pages ??
    Array.from({ length: 6 }, (_, i) => `Page ${i + 1} body text. `.repeat(30));

  vi.doMock("./extract", () => ({
    extractDocument: async () => ({
      segments: pages.map((text, i) => segment(i + 1, text)),
      characterCount: pages.reduce((n, t) => n + t.length, 0),
      pageCount: pages.length,
    }),
  }));

  vi.doMock("@/lib/embeddings", () => ({
    getEmbeddingProvider: () => ({
      name: "fake",
      model: "gte-small",
      dimensions: EMBEDDING_DIMENSIONS,
      configured: true,
      embedDocuments: async (texts: string[]) => {
        if (options.embedError) throw options.embedError;
        harness.embedded.push(texts);
        // One vector per input, carrying its ordinal, so a dropped or
        // reordered chunk is visible in what gets inserted.
        return texts.map((_, index) => {
          const row = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
          row[0] = index;
          return row;
        });
      },
      embedQuery: async () => [],
    }),
  }));

  vi.doMock("@/lib/supabase/server", () => ({
    KNOWLEDGE_BUCKET: "knowledge-documents",
    getSupabaseAdmin: () => ({
      from(table: string) {
        let verb = "select";
        let payload: unknown = null;

        const settle = async () => {
          harness.ops.push({ table, verb, payload });

          if (table === "knowledge_chunks" && verb === "insert") {
            harness.inserted.push(...(payload as Record<string, unknown>[]));
            return { data: null, error: options.chunkInsertError ?? null };
          }
          if (verb === "select") {
            return {
              data: table === "knowledge_documents" ? (options.existingRows ?? []) : [],
              error: null,
            };
          }
          if (verb === "update") {
            return {
              data: { id: "doc-1", status: "indexed", ...(payload as object) },
              error: null,
            };
          }
          return { data: null, error: null };
        };

        const builder: Record<string, unknown> = {};
        Object.assign(builder, {
          select: () => builder,
          eq: () => builder,
          neq: () => builder,
          ilike: (_column: string, pattern: string) => (harness.likePatterns.push(pattern), builder),
          order: () => builder,
          limit: () => builder,
          upsert: (values: unknown) => ((verb = "upsert"), (payload = values), builder),
          update: (values: unknown) => ((verb = "update"), (payload = values), builder),
          insert: (values: unknown) => ((verb = "insert"), (payload = values), builder),
          delete: () => ((verb = "delete"), builder),
          single: () => settle(),
          maybeSingle: () => settle(),
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            settle().then(resolve, reject),
        });
        return builder;
      },
      storage: {
        from: () => ({
          upload: async (path: string) => {
            harness.uploads.push(path);
            return { data: { path }, error: null };
          },
        }),
      },
    }),
  }));

  vi.doMock("@/lib/knowledge/mappers", () => ({
    rowToDocument: (row: unknown) => row,
  }));

  const pipeline = await import("./pipeline");
  return { harness, ingestDocument: pipeline.ingestDocument };
}

function upload() {
  return {
    file: new Blob(["%PDF-1.4 fixture"], { type: "application/pdf" }),
    fileName: "safety-binder.pdf",
    mimeType: "application/pdf",
    title: "Safety Binder",
    category: "safety" as never,
    scopeId: "stc-core",
    uploadedByName: "Tester",
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SECRET_KEY = ["sb", "secret", "TESTFIXTURE"].join("_");
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.doUnmock("./extract");
  vi.doUnmock("@/lib/embeddings");
  vi.doUnmock("@/lib/supabase/server");
  vi.doUnmock("@/lib/knowledge/mappers");
  vi.resetModules();
});

describe("a document becomes citable only when every chunk is stored", () => {
  it("inserts the chunks before it marks the document indexed", async () => {
    const { harness, ingestDocument } = await loadPipeline();
    await ingestDocument(upload());

    const insertAt = harness.ops.findIndex(
      (op) => op.table === "knowledge_chunks" && op.verb === "insert",
    );
    const indexedAt = harness.ops.findIndex(
      (op) =>
        op.table === "knowledge_documents" &&
        op.verb === "update" &&
        (op.payload as { indexed?: unknown })?.indexed === true,
    );

    expect(insertAt).toBeGreaterThanOrEqual(0);
    expect(indexedAt).toBeGreaterThan(insertAt);
  });

  it("stores one row per chunk, in chunk order, with its own vector", async () => {
    // NO CHUNK DROPPED. The pipeline zips vectors against chunks by position,
    // so this is where a lost or shuffled vector would show up.
    const { harness, ingestDocument } = await loadPipeline();
    const result = await ingestDocument(upload());

    expect(harness.inserted).toHaveLength(result.chunkCount);
    expect(harness.embedded[0]).toHaveLength(result.chunkCount);
    expect(harness.inserted.map((row) => row.chunk_index)).toEqual(
      harness.inserted.map((_, index) => index),
    );
    expect(
      harness.inserted.map((row) => (row.embedding as number[])[0]),
    ).toEqual(harness.inserted.map((_, index) => index));
  });

  it("embeds exactly the text it stores", async () => {
    const { harness, ingestDocument } = await loadPipeline();
    await ingestDocument(upload());

    expect(harness.embedded[0]).toEqual(harness.inserted.map((row) => row.content));
  });

  it("reports indexed and not-failed once it is done", async () => {
    const { harness, ingestDocument } = await loadPipeline();
    await ingestDocument(upload());

    expect(verdict(harness.ops)).toMatchObject({
      status: "indexed",
      indexed: true,
      failure_reason: null,
    });
  });
});

describe("an embedding failure leaves a failed, not-citable record", () => {
  it("never marks the document indexed", async () => {
    const { harness, ingestDocument } = await loadPipeline({
      embedError: new Error("The embedding worker reached its processing limit."),
    });

    await expect(ingestDocument(upload())).rejects.toThrow();

    const everIndexed = harness.ops.some(
      (op) => (op.payload as { indexed?: unknown })?.indexed === true,
    );
    expect(everIndexed).toBe(false);
  });

  it("records status failed with indexed false and a reason", async () => {
    const { harness, ingestDocument } = await loadPipeline({
      embedError: new Error("The embedding worker reached its processing limit."),
    });

    await expect(ingestDocument(upload())).rejects.toThrow();

    const final = verdict(harness.ops)!;
    expect(final.status).toBe("failed");
    expect(final.indexed).toBe(false);
    expect(String(final.failure_reason)).toContain("processing limit");
  });

  it("writes no chunk rows at all", async () => {
    // Partial embedding must not become partial indexing.
    const { harness, ingestDocument } = await loadPipeline({
      embedError: new Error("worker limit"),
    });

    await expect(ingestDocument(upload())).rejects.toThrow();
    expect(harness.inserted).toEqual([]);
  });

  it("keeps the stored original, which is what makes a retry possible", async () => {
    /*
     * The row and the bytes both survive a failure on purpose:
     * `reindexDocument` re-reads this object and re-runs the pipeline without
     * asking anybody to find the file again.
     */
    const { harness, ingestDocument } = await loadPipeline({
      embedError: new Error("worker limit"),
    });

    await expect(ingestDocument(upload())).rejects.toThrow();
    expect(harness.uploads).toHaveLength(1);
  });
});

describe("a chunk insert that fails does not index the document", () => {
  it("stops at failed when the rows could not be written", async () => {
    const { harness, ingestDocument } = await loadPipeline({
      chunkInsertError: { message: "deadlock detected" },
    });

    await expect(ingestDocument(upload())).rejects.toThrow();

    expect(verdict(harness.ops)!.status).toBe("failed");
    expect(
      harness.ops.some((op) => (op.payload as { indexed?: unknown })?.indexed === true),
    ).toBe(false);
  });
});

describe("a same-title upload supersedes only the document with exactly that title", () => {
  function stored(title: string) {
    return {
      id: "doc-existing",
      title,
      version: 3,
      previous_versions: [],
      created_at: "2026-10-01T00:00:00Z",
      uploaded_by_name: "Earlier",
      size_bytes: 10,
    };
  }

  it("escapes LIKE wildcards in the title it looks up", async () => {
    const { harness, ingestDocument } = await loadPipeline();
    await ingestDocument({ ...upload(), title: "Policy_A 100%" });

    expect(harness.likePatterns).toContain("Policy\\_A 100\\%");
  });

  it("starts a new document when the only near-match differs from the title", async () => {
    // "Policy-A" is what an unescaped "Policy_A" would have matched.
    const { harness, ingestDocument } = await loadPipeline({ existingRows: [stored("Policy-A")] });
    await ingestDocument({ ...upload(), title: "Policy_A" });

    const record = harness.ops.find((op) => op.table === "knowledge_documents" && op.verb === "upsert");
    expect(record?.payload).toMatchObject({ version: 1 });
    expect((record?.payload as { id?: unknown }).id).not.toBe("doc-existing");
  });

  it("still supersedes the document whose title matches, ignoring case", async () => {
    const { harness, ingestDocument } = await loadPipeline({ existingRows: [stored("safety binder")] });
    await ingestDocument(upload());

    const record = harness.ops.find((op) => op.table === "knowledge_documents" && op.verb === "upsert");
    expect(record?.payload).toMatchObject({ id: "doc-existing", version: 4 });
  });
});
