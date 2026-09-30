import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readWovenKnowledgeContent, readWovenKnowledgeStatus } from "./status";
import { CONFIG, WovenIntoKnowledge } from "./integration-support";
import { PASSWORD, uuid } from "./test-support";

/* A fresh PGlite database per test: its start-up is slow under a parallel suite. */
vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

/**
 * ============================================================================
 * THE SETUP FLOW ON THE REAL SCHEMA: scan → choose audiences → initial sync
 * ============================================================================
 *
 * Every content type, through the real connector and engine, the REAL
 * Supabase sync store and the real knowledge sink, on the repository's own
 * migrations (PGlite). What an in-memory store cannot show is shown here:
 * that the rows Production will write satisfy the tables' constraints, that
 * the dry run's inventory lands in `knowledge_sync_preview_items` and holds
 * nothing secret, and that the initial sync is idempotent in the database.
 */

let h: WovenIntoKnowledge;

beforeEach(async () => {
  h = (await WovenIntoKnowledge.create({ realStore: true })).allContentTypes();
});

afterEach(async () => {
  await h.close();
});

const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await h.database.db.query<T>(sql, params)).rows;

describe("scan, audience choices and the initial sync, in the database", () => {
  it("the dry run writes its inventory and nothing else; the choices are offered from it", async () => {
    await h.run("preview");

    expect(await q("select * from public.knowledge_sync_items")).toEqual([]);
    expect(await q("select * from public.knowledge_documents")).toEqual([]);
    const inventory = await q<{ content_type: string; state: string }>("select * from public.knowledge_sync_preview_items");
    expect(inventory.length).toBeGreaterThan(10);
    const serialised = JSON.stringify(inventory);
    for (const secret of ["sig=", "blob.core.windows.net", "https://", PASSWORD, "WovenSession", "Arrive on time"]) expect(serialised, secret).not.toContain(secret);

    const status = await readWovenKnowledgeStatus({ config: CONFIG, store: h.store });
    expect(status.setupStep).toBe("initial_sync");
    expect(status.awaitingAudience).toBe(status.latestPreview!.totals.needsReview);
    expect(status.audienceReviews.map((a) => a.label)).toEqual(expect.arrayContaining(["All Teams 8 Positions", "No audience stated"]));
  });

  it("a choice is saved in knowledge_sync_audience_decisions and the initial sync follows it; a failing file does not stop the rest", async () => {
    await h.run("preview");
    await h.store.saveDecision({ source: "woven", audienceKey: "all teams 8 positions", decision: "company_wide", decidedBy: "admin:test", decidedAt: h.clock.toISOString() });
    expect(await q("select audience_key, decision from public.knowledge_sync_audience_decisions")).toEqual([{ audience_key: "all teams 8 positions", decision: "company_wide" }]);

    const outcome = await h.run("sync");
    expect(outcome.status).toMatch(/^succeeded/);

    const docs = await q<{ title: string; source: string; status: string }>("select title, source::text as source, status::text as status from public.knowledge_documents order by title");
    /* The Public policies' text and the shared Targeted one; the no-audience items wait. */
    expect(docs.filter((d) => d.status === "indexed").map((d) => d.title)).toEqual(expect.arrayContaining(["Attendance Policy", "Dress Code", "Manager Bonus Policy"]));
    expect(docs.every((d) => d.source === "woven")).toBe(true);

    const manifest = await q<{ entity_id: string; part_key: string; record_title: string | null; state: string; in_ask_sunny: boolean; error_category: string | null }>(
      "select entity_id, part_key, record_title, state, in_ask_sunny, error_category from public.knowledge_sync_items",
    );
    expect(manifest.find((m) => m.entity_id === uuid(101) && m.part_key === "content")).toMatchObject({ record_title: "Attendance Policy", in_ask_sunny: true });
    /* The fixture handbook's bytes are not a real PDF: that one item fails and will retry; the others are unaffected. */
    const handbook = manifest.find((m) => m.entity_id === uuid(201))!;
    expect(handbook).toMatchObject({ state: "ERROR", in_ask_sunny: false });
    expect(manifest.filter((m) => m.in_ask_sunny).length).toBeGreaterThanOrEqual(3);
    /* Nothing without an audience choice, nothing draft and nothing unsupported was added. */
    expect(manifest.filter((m) => m.state === "NEEDS_REVIEW").every((m) => !m.in_ask_sunny)).toBe(true);
    expect(manifest.filter((m) => m.state === "BLOCKED").every((m) => !m.in_ask_sunny)).toBe(true);
    expect(manifest.filter((m) => m.state === "EXCLUDED").every((m) => !m.in_ask_sunny)).toBe(true);
  });

  it("running the sync again adds nothing: same documents, same ids, no duplicates", async () => {
    await h.run("preview");
    await h.run("sync");
    const before = await q<{ id: string; version: number }>("select id, version from public.knowledge_documents where status::text = 'indexed' order by id");

    h.clock = new Date(h.clock.getTime() + 60_000);
    await h.run("sync");
    const after = await q<{ id: string; version: number }>("select id, version from public.knowledge_documents where status::text = 'indexed' order by id");
    expect(after).toEqual(before);
    const owners = await q<{ n: number }>("select count(*)::int as n from public.knowledge_sync_items where knowledge_document_id is not null group by knowledge_document_id having count(*) > 1");
    expect(owners).toEqual([]);
  });

  it("the Content view reads the manifest after the initial sync, with Ask Sunny titles", async () => {
    await h.run("preview");
    await h.run("sync");
    const content = await readWovenKnowledgeContent({
      store: h.store,
      documentTitles: async (ids) =>
        new Map((await q<{ id: string; title: string }>("select id::text as id, title from public.knowledge_documents where id::text = any($1)", [ids])).map((r) => [r.id, r.title])),
    });
    expect(content.basis).toBe("manifest");
    expect(content.rows.find((r) => r.title === "Attendance Policy")).toMatchObject({ syncState: "up_to_date", askSunny: [expect.objectContaining({ title: "Attendance Policy" })] });
    expect(content.rows.find((r) => r.title === "Team Member Handbook")).toMatchObject({ syncState: "error" });
  });
});
