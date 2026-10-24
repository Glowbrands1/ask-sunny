import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import {
  choosePolicyManuals,
  isJbaPolicyManualTitle,
  type FullManualAssembly,
  type FullManualChunk,
  type FullManualDocument,
} from "./full-manual-context";

/**
 * Read the current JBA Policy Manual for one scope and assemble the Sun Tan
 * City text.
 *
 * Current means status indexed, indexed, and superseded_by null. Retired
 * and superseded rows are not read. Another brand's policy manual is not
 * read. This does not write and does not touch ingest. A failed read is a
 * missing manual, so the caller keeps retrieval.
 */

interface DocumentRow {
  id: string;
  title: string;
  category: string;
  version: number;
}

interface ChunkRow {
  chunk_index: number;
  page: number | null;
  section: string | null;
  content: string | null;
}

function asPage(value: unknown): number | null {
  const page = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(page) && page > 0 ? page : null;
}

async function readChunks(documentId: string, version: number): Promise<FullManualChunk[]> {
  const client = getSupabaseAdmin();
  const chunks: FullManualChunk[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from("knowledge_chunks")
      .select("chunk_index, page, section, content")
      .eq("document_id", documentId)
      .eq("version", version)
      .order("chunk_index", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error("chunk read failed");
    const rows = (data ?? []) as ChunkRow[];
    for (const row of rows) {
      chunks.push({
        chunkIndex: row.chunk_index,
        page: asPage(row.page),
        section: row.section,
        content: row.content ?? "",
      });
    }
    if (rows.length < pageSize) break;
  }
  return chunks;
}

export async function loadFullManualContext(input: {
  readonly scopeId: string;
  readonly question: string;
}): Promise<FullManualAssembly> {
  try {
    const client = getSupabaseAdmin();
    const { data, error } = await client
      .from("knowledge_documents")
      .select("id, title, category, version")
      .eq("knowledge_scope_id", input.scopeId)
      .eq("status", "indexed")
      .eq("indexed", true)
      .is("superseded_by", null);
    if (error) return { ok: false, reason: "missing" };

    const documents = ((data ?? []) as DocumentRow[]).filter((doc) => isJbaPolicyManualTitle(doc.title));
    const loaded = (
      await Promise.all(
        documents.map(async (doc): Promise<FullManualDocument | null> => {
          try {
            const chunks = await readChunks(doc.id, doc.version);
            if (chunks.length === 0) return null;
            return { id: doc.id, title: doc.title, category: doc.category, chunks };
          } catch {
            return null;
          }
        }),
      )
    ).filter((doc): doc is FullManualDocument => doc !== null);

    return choosePolicyManuals(input.question, loaded);
  } catch {
    return { ok: false, reason: "missing" };
  }
}
