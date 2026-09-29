// Verifies supabase/migrations/20260929001000_woven_knowledge_sync.sql against a
// real Postgres engine (PGlite), with minimal stubs for the Supabase and
// knowledge-schema objects it depends on. Nothing here touches a real database.
//
//   npm install --no-save @electric-sql/pglite
//   node scripts/verify-woven-knowledge-migration.mjs
//
// PGlite is deliberately not a declared dependency: this is a pre-apply check a
// reviewer runs on demand, not part of the build.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const MIGRATION = new URL("../supabase/migrations/20260929001000_woven_knowledge_sync.sql", import.meta.url);
const db = new PGlite();
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures += 1;
};
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const rejects = async (sql, params, label) => {
  try {
    await db.query(sql, params);
    ok(false, label);
  } catch {
    ok(true, label);
  }
};

// ---- Supabase and knowledge-schema stand-ins ----
await db.exec(`
  create role anon; create role authenticated;
  create schema extensions;
  create function extensions.gen_random_uuid() returns uuid language sql as 'select gen_random_uuid()';
  alter default privileges in schema public grant all on tables to anon, authenticated;
  create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
    begin new.updated_at := now(); return new; end; $$;
  create type public.knowledge_document_status as enum ('uploading','processing','indexed','failed');
  create table public.knowledge_documents (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    status public.knowledge_document_status not null default 'uploading',
    indexed boolean not null default false,
    indexed_at timestamptz,
    constraint knowledge_documents_indexed_requires_status
      check (indexed = false or (status = 'indexed' and indexed_at is not null))
  );
  create table public.knowledge_chunks (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references public.knowledge_documents (id) on delete cascade,
    content text not null
  );
  alter table public.knowledge_documents enable row level security;
  alter table public.knowledge_documents force row level security;
  alter table public.knowledge_chunks enable row level security;
  alter table public.knowledge_chunks force row level security;
  -- the original policies, as 20260829000400_rls.sql wrote them
  create policy knowledge_documents_read_authenticated on public.knowledge_documents for select to authenticated using (true);
  create policy knowledge_chunks_read_authenticated on public.knowledge_chunks for select to authenticated
    using (exists (select 1 from public.knowledge_documents d where d.id = knowledge_chunks.document_id));
  revoke all on public.knowledge_documents from anon, authenticated;
  revoke all on public.knowledge_chunks from anon, authenticated;
  grant select on public.knowledge_documents to authenticated;
  grant select on public.knowledge_chunks to authenticated;
  insert into public.knowledge_documents (id, title, status, indexed, indexed_at)
    values ('00000000-0000-0000-0000-00000000000a', 'Handbook', 'indexed', true, '2026-09-01T00:00:00Z'),
           ('00000000-0000-0000-0000-00000000000b', 'Policy', 'indexed', true, '2026-09-01T00:00:00Z');
  insert into public.knowledge_chunks (document_id, content)
    values ('00000000-0000-0000-0000-00000000000a', 'handbook chunk'),
           ('00000000-0000-0000-0000-00000000000b', 'policy chunk');
`);
const knowledgeBefore = JSON.stringify((await db.query("select * from public.knowledge_documents order by id")).rows);

// ---- apply in ONE transaction, verbatim, twice ----
const sql = readFileSync(MIGRATION, "utf8");
await db.exec(`begin;\n${sql}\ncommit;`);
ok(true, "migration applies in one transaction");
await db.exec(`begin;\n${sql}\ncommit;`);
ok(true, "migration re-applies cleanly (idempotent DDL)");

ok(
  JSON.stringify((await db.query("select * from public.knowledge_documents order by id")).rows) === knowledgeBefore,
  "existing knowledge documents are untouched",
);
const labels = (await db.query("select unnest(enum_range(null::public.knowledge_document_status))::text as v")).rows.map((r) => r.v);
ok(labels.join(",") === "uploading,processing,indexed,failed,retired", "knowledge_document_status gains 'retired' once");

// ---- `retired` as a persisted lifecycle state ----
await db.query("update public.knowledge_documents set status = 'retired', indexed = false where id = '00000000-0000-0000-0000-00000000000b'");
ok((await one("select status::text s from public.knowledge_documents where id = '00000000-0000-0000-0000-00000000000b'")).s === "retired", "a document can be persisted as retired");
await rejects(
  "update public.knowledge_documents set indexed = true where id = '00000000-0000-0000-0000-00000000000b'",
  [],
  "a retired document can never be marked indexed",
);
await db.exec("set role authenticated");
const visibleDocs = (await db.query("select title from public.knowledge_documents order by title")).rows.map((r) => r.title);
const visibleChunks = (await db.query("select content from public.knowledge_chunks order by content")).rows.map((r) => r.content);
await db.exec("reset role");
ok(visibleDocs.join(",") === "Handbook", "a signed-in user cannot read a retired document");
ok(visibleChunks.join(",") === "handbook chunk", "a signed-in user cannot read a retired document's chunks");
await db.query("update public.knowledge_documents set status = 'indexed', indexed = true, indexed_at = now() where id = '00000000-0000-0000-0000-00000000000b'");
await db.exec("set role authenticated");
ok((await one("select count(*)::int n from public.knowledge_documents")).n === 2, "re-publishing (back to indexed) makes it readable again");
await db.exec("reset role");

// ---- privileges and RLS ----
const TABLES = [
  "knowledge_sync_settings",
  "knowledge_sync_runs",
  "knowledge_sync_items",
  "knowledge_sync_events",
  "knowledge_sync_audience_decisions",
];
for (const table of TABLES) {
  for (const role of ["anon", "authenticated"]) {
    const r = await one(
      `select has_table_privilege($1, 'public.${table}', 'select') as s,
              has_table_privilege($1, 'public.${table}', 'insert') as i,
              has_table_privilege($1, 'public.${table}', 'update') as u,
              has_table_privilege($1, 'public.${table}', 'delete') as d`,
      [role],
    );
    ok(!r.s && !r.i && !r.u && !r.d, `${role} has no access to ${table}`);
  }
  const rls = await one(`select relrowsecurity r, relforcerowsecurity f from pg_class where oid = 'public.${table}'::regclass`);
  ok(rls.r && rls.f, `RLS enabled and forced on ${table}`);
}

// ---- settings seed ----
const settings = await one("select * from public.knowledge_sync_settings where source = 'woven'");
ok(settings && settings.auto_sync_enabled === false && settings.interval_days === 30, "woven settings seeded: automatic sync OFF, 30 days");
await rejects("update public.knowledge_sync_settings set interval_days = 1", [], "interval below 7 days refused");

// ---- run lock ----
await db.query("insert into public.knowledge_sync_runs (source, mode, trigger, requested_by) values ('woven','sync','manual','admin:a')");
await rejects(
  "insert into public.knowledge_sync_runs (source, mode, trigger, requested_by) values ('woven','preview','manual','admin:b')",
  [],
  "a second live run is refused (run lock)",
);
await rejects("update public.knowledge_sync_runs set status = 'succeeded'", [], "a finished run must have finished_at");
await db.query("update public.knowledge_sync_runs set status = 'succeeded', finished_at = now()");
await db.query("insert into public.knowledge_sync_runs (source, mode, trigger, requested_by) values ('woven','sync','schedule','schedule')");
ok(true, "a new run may start once the previous one finished");
await rejects("update public.knowledge_sync_runs set error_code = 'Has Spaces'", [], "error_code must be a code");

// ---- manifest ----
const H = (c) => c.repeat(64);
const insertItem = (over = {}) => {
  const row = {
    source: "woven",
    content_type: "handbook",
    entity_id: "hb-1",
    part_key: "current-version",
    observed_fingerprint: H("a"),
    state: "NEW",
    pending_action: "ingest",
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    locator: JSON.stringify({ handbookId: "hb-1", versionId: "v-1" }),
    ...over,
  };
  const cols = Object.keys(row);
  return db.query(
    `insert into public.knowledge_sync_items (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})`,
    Object.values(row),
  );
};
await insertItem({ knowledge_document_id: "00000000-0000-0000-0000-00000000000a", in_ask_sunny: true });
ok(true, "a manifest item inserts");
try {
  await insertItem();
  ok(false, "the same source item part cannot be inserted twice");
} catch {
  ok(true, "the same source item part cannot be inserted twice");
}
try {
  await insertItem({ entity_id: "hb-2", knowledge_document_id: "00000000-0000-0000-0000-00000000000a" });
  ok(false, "two items cannot own one Ask Sunny document");
} catch {
  ok(true, "two items cannot own one Ask Sunny document");
}
for (const [label, locator] of [
  ["a URL", { url: "https://woven.blob.core.windows.net/policy/x.pdf" }],
  ["a SAS signature", { q: "sv=1&sig=abc" }],
  ["a blob host", { host: "woven.blob.core.windows.net" }],
]) {
  try {
    await insertItem({ entity_id: `bad-${label}`, locator: JSON.stringify(locator) });
    ok(false, `a locator carrying ${label} is refused`);
  } catch {
    ok(true, `a locator carrying ${label} is refused`);
  }
}
try {
  await insertItem({ entity_id: "hb-3", state: "SOMETHING" });
  ok(false, "an unknown state is refused");
} catch {
  ok(true, "an unknown state is refused");
}

await db.query("delete from public.knowledge_documents where id = '00000000-0000-0000-0000-00000000000a'");
const orphan = await one("select knowledge_document_id from public.knowledge_sync_items where entity_id = 'hb-1'");
ok(orphan.knowledge_document_id === null, "deleting an Ask Sunny document by hand detaches the manifest item");

// ---- events ----
const run = await one("select id from public.knowledge_sync_runs order by started_at desc limit 1");
await db.query(
  "insert into public.knowledge_sync_events (run_id, content_type, entity_id, part_key, action, result, content_hash, duration_ms) values ($1,'handbook','hb-1','current-version','ingest','ok',$2,120)",
  [run.id, H("b")],
);
ok(true, "an audit event inserts");
await rejects(
  "insert into public.knowledge_sync_events (run_id, content_type, entity_id, part_key, action, result) values ($1,'handbook','hb-1','x','download','ok')",
  [run.id],
  "an unknown audit action is refused",
);

// ---- decisions ----
await db.query("insert into public.knowledge_sync_audience_decisions (source, audience_key, decision, decided_by) values ('woven','all teams','company_wide','admin:a')");
await rejects(
  "insert into public.knowledge_sync_audience_decisions (source, audience_key, decision, decided_by) values ('woven','all teams','excluded','admin:b')",
  [],
  "one decision per audience",
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
