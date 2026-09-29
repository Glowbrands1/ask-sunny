import { EMBEDDING_DIMENSIONS } from "@/lib/config/models";
import { __setEmbeddingProvider } from "@/lib/embeddings";
import { __setSupabaseAdmin } from "@/lib/supabase/server";
import { bagOfWordsEmbedding, createKnowledgeTestDatabase, type KnowledgeTestDatabase } from "@/test/pglite-knowledge-db";

import { MemoryKnowledgeSyncStore } from "../memory-store";
import { createSupabaseKnowledgeSink } from "../sink";
import type { ManifestItem } from "../types";
import type { WovenKnowledgeConfig } from "./config";
import { WovenKnowledgeConnector } from "./connector";
import { WovenTeamClient } from "./http";
import { runWovenKnowledgeSync } from "./sync";
import { COMPANY, FakeWoven, PASSWORD, USERNAME, noSleep, uuid } from "./test-support";

/**
 * ============================================================================
 * A WOVEN SYNC INTO THE REAL KNOWLEDGE PIPELINE
 * ============================================================================
 *
 * For the integration tests that prove synced Woven content is USED: chat
 * retrieval and citations, and the form policy search.
 *
 * Everything from the connector down is the production path: the fake Woven
 * server, the real connector and engine, the real Supabase sink
 * (`createSupabaseKnowledgeSink`), `ingestDocument` / `retireDocument`, and
 * the repository's own knowledge migrations on PGlite. The two substitutes are
 * the manifest store (in memory; it is not what is under test) and the
 * embedding model (a deterministic bag of words).
 */

export const CONFIG: WovenKnowledgeConfig = {
  enabled: true,
  baseUrl: "https://app.woven.team",
  company: COMPANY,
  credentials: { username: USERNAME, password: PASSWORD },
  missingCredentials: [],
  problems: [],
  previewTestModeAllowed: false,
};

/** The Attendance Policy's text part: the policy body, as its own document. */
export const ATTENDANCE_POLICY_TEXT = `woven\u0000policy\u0000${uuid(101)}\u0000content`;

export class WovenIntoKnowledge {
  readonly fake = new FakeWoven();
  readonly store = new MemoryKnowledgeSyncStore({ now: () => this.clock });
  clock = new Date("2026-09-29T12:00:00Z");

  private constructor(readonly database: KnowledgeTestDatabase) {
    /* Attachments are PDFs whose fixture bytes are not a real PDF; the policy TEXT is what these tests read. */
    for (const policy of this.fake.state.policies) policy.attachments = [];
  }

  static async create(): Promise<WovenIntoKnowledge> {
    const database = await createKnowledgeTestDatabase();
    __setSupabaseAdmin(database.client);
    __setEmbeddingProvider({
      name: "bag of words (test)",
      model: "bag-of-words-test",
      dimensions: EMBEDDING_DIMENSIONS,
      configured: true,
      embedDocuments: async (texts) => texts.map((text) => bagOfWordsEmbedding(text, EMBEDDING_DIMENSIONS)),
      embedQuery: async (text) => bagOfWordsEmbedding(text, EMBEDDING_DIMENSIONS),
    });
    return new WovenIntoKnowledge(database);
  }

  async close(): Promise<void> {
    __setSupabaseAdmin(null);
    __setEmbeddingProvider(null);
    await this.database.close();
  }

  async run(mode: "preview" | "sync") {
    const connector = new WovenKnowledgeConnector({
      client: new WovenTeamClient({ baseUrl: CONFIG.baseUrl, fetch: this.fake.fetch, sleep: noSleep, transport: { minIntervalMs: 0, baseBackoffMs: 0 } }),
      credentials: CONFIG.credentials!,
      company: COMPANY,
    });
    const outcome = await runWovenKnowledgeSync(
      { mode, trigger: "manual", requestedBy: "admin:test" },
      { config: CONFIG, store: this.store, sink: createSupabaseKnowledgeSink("woven"), connector, now: () => this.clock, contentTypes: ["policy"] },
    );
    if (!/^succeeded/.test(outcome.status)) throw new Error(`the ${mode} run ended ${outcome.status}`);
    this.clock = new Date(this.clock.getTime() + 86_400_000);
    return outcome;
  }

  /** Preview, then the initial sync: the setup flow. */
  async initial() {
    await this.run("preview");
    return this.run("sync");
  }

  item(key: string): ManifestItem {
    const found = this.store.items.get(key);
    if (!found) throw new Error(`no manifest item ${key.replaceAll("\u0000", "/")}`);
    return found;
  }

  documentId(key: string): string {
    const id = this.item(key).knowledgeDocumentId;
    if (!id) throw new Error("the item has no Ask Sunny document");
    return id;
  }

  async document(id: string) {
    const { rows } = await this.database.db.query<Record<string, unknown>>(
      "select id, title, source::text as source, status::text as status, indexed, version, category, tags from public.knowledge_documents where id = $1",
      [id],
    );
    return rows[0] ?? null;
  }

  async chunks(documentId: string) {
    const { rows } = await this.database.db.query<{ version: number; content: string }>(
      "select version, content from public.knowledge_chunks where document_id = $1 order by version, chunk_index",
      [documentId],
    );
    return rows;
  }

  async documentCount(): Promise<number> {
    const { rows } = await this.database.db.query<{ n: number }>("select count(*)::int as n from public.knowledge_documents");
    return rows[0]!.n;
  }
}
