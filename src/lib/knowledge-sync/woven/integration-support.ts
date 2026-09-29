import { EMBEDDING_DIMENSIONS } from "@/lib/config/models";
import { __setEmbeddingProvider } from "@/lib/embeddings";
import { __setSupabaseAdmin } from "@/lib/supabase/server";
import { bagOfWordsEmbedding, createKnowledgeTestDatabase, type KnowledgeTestDatabase } from "@/test/pglite-knowledge-db";

import { MemoryKnowledgeSyncStore } from "../memory-store";
import type { KnowledgeSyncStore } from "../ports";
import { createSupabaseKnowledgeSink } from "../sink";
import { createSupabaseKnowledgeSyncStore } from "../store";
import { CONTENT_TYPES, type ContentType, type ManifestItem } from "../types";
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
 * the repository's own knowledge migrations on PGlite. The substitutes are
 * the embedding model (a deterministic bag of words) and, unless `realStore`
 * is asked for, the manifest store (in memory).
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
  readonly memory = new MemoryKnowledgeSyncStore({ now: () => this.clock });
  /** The manifest store the runs use: in memory, or the real Supabase store on PGlite. */
  readonly store: KnowledgeSyncStore;
  clock = new Date("2026-09-29T12:00:00Z");
  contentTypes: readonly ContentType[] = ["policy"];

  private constructor(
    readonly database: KnowledgeTestDatabase,
    realStore: boolean,
  ) {
    /* Attachments are PDFs whose fixture bytes are not a real PDF; the policy TEXT is what these tests read. */
    for (const policy of this.fake.state.policies) policy.attachments = [];
    this.store = realStore ? createSupabaseKnowledgeSyncStore(database.client) : this.memory;
  }

  /** Every content type the connector lists, not only policies. */
  allContentTypes(): this {
    this.contentTypes = CONTENT_TYPES;
    return this;
  }

  static async create(options: { realStore?: boolean } = {}): Promise<WovenIntoKnowledge> {
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
    return new WovenIntoKnowledge(database, options.realStore ?? false);
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
      { config: CONFIG, store: this.store, sink: createSupabaseKnowledgeSink("woven"), connector, now: () => this.clock, contentTypes: this.contentTypes },
    );
    if (!/^succeeded/.test(outcome.status)) throw new Error(`the ${mode} run ended ${outcome.status}: ${JSON.stringify({ errorCode: (outcome as { errorCode?: unknown }).errorCode, reason: (outcome as { reason?: unknown }).reason, attention: (outcome as { report?: { attention?: unknown } }).report?.attention })}`);
    this.clock = new Date(this.clock.getTime() + 86_400_000);
    return outcome;
  }

  /** Preview, then the initial sync: the setup flow. */
  async initial() {
    await this.run("preview");
    return this.run("sync");
  }

  async item(key: string): Promise<ManifestItem> {
    const found = (await this.store.loadManifest("woven")).find((i) => `woven\u0000${i.contentType}\u0000${i.entityId}\u0000${i.partKey}` === key);
    if (!found) throw new Error(`no manifest item ${key.replaceAll("\u0000", "/")}`);
    return found;
  }

  async documentId(key: string): Promise<string> {
    const id = (await this.item(key)).knowledgeDocumentId;
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
