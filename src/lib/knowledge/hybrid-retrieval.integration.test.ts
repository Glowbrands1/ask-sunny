import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { EMBEDDING_DIMENSIONS } from "@/lib/config/models";
import {
  bagOfWordsEmbedding,
  createKnowledgeTestDatabase,
  type KnowledgeTestDatabase,
} from "@/test/pglite-knowledge-db";

/**
 * ============================================================================
 * HYBRID RETRIEVAL ON THE REAL SQL
 * ============================================================================
 *
 * ASK SUNNY FEEDBACK, 6 OCTOBER 2026. The checking-account answer existed in
 * the TC Mastery books; vector search, reading the question as a COACHING
 * request, returned only coaching frameworks, and Sunny said the knowledge base
 * had nothing on it.
 *
 * The embeddings here are deliberately SEMANTIC rather than lexical: each
 * chunk and each question is embedded from a short description of what it is
 * ABOUT, not from its words. That is what reproduces the failure — the
 * question is about coaching, so its vector sits with the frameworks, and the
 * chunk that says "checking account" sits elsewhere — and it is what makes the
 * keyword leg the only thing that can find it.
 *
 * Everything else is real: the repository's migrations on PGlite with
 * pgvector, `match_knowledge_chunks`, `match_knowledge_chunks_keyword`, and
 * `SupabaseKnowledgeProvider.match`.
 */

const state = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => state.client }));

/* What each question is ABOUT, as an embedding model would read it. */
const INTENT: Record<string, string> = {
  checkingAccounts: "coaching team members behavior feedback observation role play",
  offTopic: "tungsten metallurgy melting temperature element",
};
const QUESTIONS = {
  checkingAccounts: "generate me a coaching worksheet for team memebers about getting checking accounts put onto client profiles",
  offTopic: "What is the boiling point of tungsten?",
};

vi.mock("@/lib/embeddings", () => ({
  getEmbeddingProvider: () => ({
    dimensions: EMBEDDING_DIMENSIONS,
    embedQuery: async (text: string) => {
      const key = (Object.keys(QUESTIONS) as (keyof typeof QUESTIONS)[]).find(
        (name) => QUESTIONS[name] === text,
      );
      return bagOfWordsEmbedding(key ? INTENT[key]! : text, EMBEDDING_DIMENSIONS);
    },
  }),
}));

const SCOPE = "stc-core";
let h: KnowledgeTestDatabase;
let provider: InstanceType<typeof import("./providers/supabase").SupabaseKnowledgeProvider>;

let documents = 0;
async function document(input: {
  title: string;
  scope?: string;
  category?: string;
  status?: "indexed" | "processing" | "superseded";
  version?: number;
}) {
  documents += 1;
  const id = `00000000-0000-4000-8000-${String(documents).padStart(12, "0")}`;
  const status = input.status ?? "indexed";
  const scope = input.scope ?? SCOPE;
  await h.db.query(
    `insert into public.knowledge_documents (id, knowledge_scope_id, title, description, category, tags, original_filename, mime_type, file_type, storage_path, size_bytes, character_count, source, status, indexed, version, previous_versions, uploaded_by_name, indexed_at)
     values ($1, $2, $3, '', $4, '{}', $5, 'text/plain', 'txt', $6, 10, 10, 'woven', $7, $8, $9, '[]', 'fixture', case when $8 then now() end)`,
    [id, scope, input.title, input.category ?? "other", `${input.title}.txt`, `${scope}/${id}/1/doc.txt`, status, status === "indexed", input.version ?? 1],
  );
  return id;
}

let chunks = 0;
async function chunk(documentId: string, content: string, about: string, options: { scope?: string; version?: number } = {}) {
  chunks += 1;
  await h.db.query(
    `insert into public.knowledge_chunks (document_id, knowledge_scope_id, chunk_index, version, content, locator, embedding_model, embedding)
     values ($1, $2, $3, $4, $5, $6, 'semantic-test', $7::extensions.vector)`,
    [documentId, options.scope ?? SCOPE, chunks, options.version ?? 1, content, `Chunk ${chunks}`, `[${bagOfWordsEmbedding(about, EMBEDDING_DIMENSIONS).join(",")}]`],
  );
}

const TC_MASTERY =
  "Activity - Properly explain the benefits of signing up for a membership with a checking account. Answer: Using your checking account limits the need for updating billing & any billing errors. Clients also get a $10 off (Checking) cost to join coupon.";

beforeAll(async () => {
  h = await createKnowledgeTestDatabase();
  state.client = h.client;

  const framework = await document({ title: "ASK SUNNY EMPLOYEE PERFORMANCE FRAMEWORK KB TEXT", category: "leadership_coaching" });
  for (let index = 0; index < 6; index += 1) {
    await chunk(framework, `Coach the behavior, not the number. Observe the team member with the client, give feedback, role play, follow up. Step ${index}.`, INTENT.checkingAccounts!);
  }
  const mastery = await document({ title: "3 KEY TC Mastery Services 10.2024" });
  await chunk(mastery, TC_MASTERY, "membership agreement billing sign up activity answer");

  // The same words where nobody may read them.
  const superseded = await document({ title: "Old TC Mastery upload", status: "superseded" });
  await chunk(superseded, "Superseded: checking account benefits for client profiles.", "membership billing");
  const held = await document({ title: "Held for a Woven audience decision", status: "processing" });
  await chunk(held, "Held: checking account benefits for client profiles.", "membership billing");
  // Buff City Soap's real corpus id, in the same table: the strongest test of the scope clause.
  const otherBrand = await document({ title: "Other brand manual", scope: "bcs-core" });
  await chunk(otherBrand, "Other brand: checking account benefits for client profiles.", "membership billing", { scope: "bcs-core" });
  await chunk(otherBrand, "Other brand: coach the team member on checking accounts for client profiles.", INTENT.checkingAccounts!, { scope: "bcs-core" });
  const reuploaded = await document({ title: "Re-uploaded promo guide", version: 2 });
  await chunk(reuploaded, "Version one: checking account coupon for client profiles.", "promotion coupon", { version: 1 });
  await chunk(reuploaded, "Version two: seasonal promotion calendar.", "promotion coupon", { version: 2 });

  // A word from the off-topic question, in a chunk about something else.
  const steamer = await document({ title: "Steamer maintenance" });
  await chunk(steamer, "Never touch the steamer at the boiling point of water; the point of contact is hot.", "equipment cleaning safety");

  const { SupabaseKnowledgeProvider } = await import("./providers/supabase");
  provider = new SupabaseKnowledgeProvider();
});

afterAll(async () => {
  await h?.close();
});

const titles = (rows: { document_title: string }[]) => rows.map((row) => row.document_title);

describe("The checking-account question", () => {
  it("is missed by vector search alone — the reported failure", async () => {
    const rows = await provider.match({ query: QUESTIONS.checkingAccounts, scopeId: SCOPE });
    expect(rows.length).toBeGreaterThan(0);
    expect(titles(rows)).not.toContain("3 KEY TC Mastery Services 10.2024");
  });

  it("retrieves the TC Mastery answer with the keyword leg", async () => {
    const rows = await provider.match({ query: QUESTIONS.checkingAccounts, scopeId: SCOPE, hybrid: true });
    const mastery = rows.find((row) => row.document_title === "3 KEY TC Mastery Services 10.2024");
    expect(mastery?.content).toBe(TC_MASTERY);
    // Never measured by the vector leg, so it does not pretend to be.
    expect(mastery?.similarity).toBe(0);
    // And the frameworks the vector leg found are still there.
    expect(titles(rows)).toContain("ASK SUNNY EMPLOYEE PERFORMANCE FRAMEWORK KB TEXT");
  });

  it("cites the row the database returned, with its real ids", async () => {
    const rows = await provider.match({ query: QUESTIONS.checkingAccounts, scopeId: SCOPE, hybrid: true });
    const citations = provider.toCitations(rows.map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      documentTitle: row.document_title,
      locator: row.locator,
      content: row.content,
      score: row.similarity,
    })));
    expect(citations.map((citation) => citation.documentTitle)).toContain("3 KEY TC Mastery Services 10.2024");
  });

  it("never returns a superseded, unindexed, other-brand or stale-version chunk", async () => {
    const rows = await provider.match({ query: QUESTIONS.checkingAccounts, scopeId: SCOPE, hybrid: true, limit: 50 });
    const contents = rows.map((row) => row.content);
    expect(contents.some((text) => /^(Superseded|Held|Other brand|Version one):/.test(text))).toBe(false);
  });

  it("keeps the category filter", async () => {
    const rows = await provider.match({
      query: QUESTIONS.checkingAccounts,
      scopeId: SCOPE,
      hybrid: true,
      categories: ["leadership_coaching"],
    });
    expect(new Set(titles(rows))).toEqual(new Set(["ASK SUNNY EMPLOYEE PERFORMANCE FRAMEWORK KB TEXT"]));
  });
});

/*
 * ASK BUBBLES ISOLATION. Each brand runs on its own database, so this is the
 * second line of defence: were both corpora ever in one table, neither brand's
 * retrieval — vector or keyword — may return the other's text.
 */
describe("one brand never retrieves the other's chunks", () => {
  it("keeps Buff City Soap's text out of a Sun Tan City answer", async () => {
    const rows = await provider.match({ query: QUESTIONS.checkingAccounts, scopeId: SCOPE, hybrid: true, limit: 50 });
    expect(rows.some((row) => row.content.startsWith("Other brand:"))).toBe(false);
  });

  it("keeps Sun Tan City's text out of a Buff City Soap answer", async () => {
    const rows = await provider.match({ query: QUESTIONS.checkingAccounts, scopeId: "bcs-core", hybrid: true, limit: 50 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.content.startsWith("Other brand:"))).toBe(true);
  });

  it("scopes the keyword function itself", async () => {
    const { data } = await h.client.rpc("match_knowledge_chunks_keyword", {
      query_terms: ["checking", "accounts"],
      query_phrases: ["checking accounts"],
      scope_id: "bcs-core",
      match_count: 50,
      filter_categories: null,
    });
    expect((data as { content: string }[]).every((row) => row.content.startsWith("Other brand:"))).toBe(true);
  });
});

describe("a question the knowledge base does not cover", () => {
  it("still gets no company knowledge, even when a word of it appears somewhere", async () => {
    const rows = await provider.match({ query: QUESTIONS.offTopic, scopeId: SCOPE, hybrid: true });
    expect(rows).toEqual([]);
  });
});

describe("the keyword leg on its own", () => {
  it("ranks a chunk with the phrase above one with scattered words", async () => {
    const { data } = await h.client.rpc("match_knowledge_chunks_keyword", {
      query_terms: ["checking", "accounts", "client", "profiles"],
      query_phrases: ["checking accounts", "client profiles"],
      scope_id: SCOPE,
      match_count: 5,
      filter_categories: null,
    });
    expect((data as { document_title: string }[])[0]?.document_title).toBe("3 KEY TC Mastery Services 10.2024");
  });

  it("is not callable by an anonymous visitor", async () => {
    const rows = await h.db.query<{ allowed: boolean }>(
      `select has_function_privilege('anon', 'public.match_knowledge_chunks_keyword(text[], text[], text, integer, text[])', 'execute') as allowed`,
    );
    expect(rows.rows[0]?.allowed).toBe(false);
  });

  it("treats hostile input as words", async () => {
    const { error } = await h.client.rpc("match_knowledge_chunks_keyword", {
      query_terms: ["a' | !(b", "&&&", "<->", "::tsquery"],
      query_phrases: ["')); drop table knowledge_chunks; --"],
      scope_id: SCOPE,
      match_count: 5,
      filter_categories: null,
    });
    expect(error).toBeNull();
    const count = await h.db.query<{ n: number }>("select count(*)::int as n from public.knowledge_chunks");
    expect(count.rows[0]?.n).toBeGreaterThan(0);
  });
});

/*
 * PRODUCTION ROLLOUT PREPARATION, 8 OCTOBER 2026. The first version of the
 * function recomputed its word weights, corpus count included, once per
 * candidate chunk: Postgres guesses that a run-time tsquery matches one row and
 * planned a nested loop on that guess. Fast on a rare phrase, past the 8 s
 * statement timeout once common words ("client", "tanning", "salon") reached a
 * few thousand chunks, which a real question does. Its own corpus id, so no
 * other test sees these rows.
 */
describe("the keyword leg when common words match most of the corpus", () => {
  it("answers in time, in work that grows with the matches rather than their square", async () => {
    const scope = "load-test";
    const manual = await document({ title: "Load test manual", scope });
    await h.db.query(
      `insert into public.knowledge_chunks (document_id, knowledge_scope_id, chunk_index, version, content, locator, embedding_model, embedding)
       select $1, $2, g, 1, 'Client team salon tanning membership sales coaching manager, note ' || g, 'Load ' || g, 'semantic-test', $3::extensions.vector
       from generate_series(1, 1500) g`,
      [manual, scope, `[${bagOfWordsEmbedding("load test", EMBEDDING_DIMENSIONS).join(",")}]`],
    );
    const terms = ["client", "team", "salon", "tanning", "membership", "sales", "coaching", "manager"];
    const phrases = terms.slice(1).map((word, index) => `${terms[index]} ${word}`);

    const started = performance.now();
    const { data, error } = await h.client.rpc("match_knowledge_chunks_keyword", {
      query_terms: terms,
      query_phrases: phrases,
      scope_id: scope,
      match_count: 8,
      filter_categories: null,
    });
    const elapsed = performance.now() - started;

    expect(error).toBeNull();
    const rows = data as { matched_units: number }[];
    expect(rows).toHaveLength(8);
    expect(rows.every((row) => row.matched_units === terms.length + phrases.length)).toBe(true);
    expect(elapsed).toBeLessThan(10_000);
  }, 60_000);
});

describe("before the migration is applied", () => {
  it("falls back to vector search rather than failing the answer", async () => {
    await h.db.exec("alter function public.match_knowledge_chunks_keyword(text[], text[], text, integer, text[]) rename to match_knowledge_chunks_keyword_off");
    try {
      const rows = await provider.match({ query: QUESTIONS.checkingAccounts, scopeId: SCOPE, hybrid: true });
      expect(rows.length).toBeGreaterThan(0);
      expect(titles(rows)).not.toContain("3 KEY TC Mastery Services 10.2024");
    } finally {
      await h.db.exec("alter function public.match_knowledge_chunks_keyword_off(text[], text[], text, integer, text[]) rename to match_knowledge_chunks_keyword");
    }
  });
});
