# Supabase — migrations and setup

Nothing in this directory has been applied to a remote project. There is no
Supabase project for Ask Sunny yet; these migrations are version-controlled and
ready for the first `supabase db push`.

## Migration order

| File | What it does |
| --- | --- |
| `20260829000100_extensions.sql` | Enables `vector` (pgvector) and `pgcrypto`. |
| `20260829000200_knowledge_schema.sql` | `knowledge_documents`, `knowledge_chunks`, enums, indexes, HNSW vector index. |
| `20260829000300_match_knowledge_chunks.sql` | `match_knowledge_chunks()` — the cosine similarity RPC used for retrieval. |
| `20260829000400_rls.sql` | Row level security. Deny by default; `anon` gets nothing. |
| `20260829000500_storage_bucket.sql` | The **private** `knowledge-documents` bucket. |

## Embedding dimension

`knowledge_chunks.embedding` is `vector(1024)`.

That number is not arbitrary and is not guessed. It is the output dimension of
the embedding model selected in `src/lib/config/models.ts`:

```
EMBEDDING_MODEL = "voyage-4-lite"   // output_dimension 1024
```

`MIGRATED_EMBEDDING_DIMENSIONS` in that same file records what these migrations
declare. If the two ever disagree, `/api/health` reports
`embeddingDimensionMismatch` and the ingestion and chat routes refuse to run
rather than writing vectors the index cannot search.

**Changing the embedding model** therefore means:

1. Update `EMBEDDING_MODEL` (and its entry in `EMBEDDING_MODELS` if the model is new).
2. Add a migration altering the column and both the RPC's argument type.
3. Re-embed every chunk — old vectors are not comparable across models.
4. Update `MIGRATED_EMBEDDING_DIMENSIONS`.

`voyage-4-lite` also supports 256, 512 and 2048 via Matryoshka truncation, so a
dimension change is a real option — it just is not a silent one.

## Applying these (manual step, not yet done)

```bash
supabase link --project-ref <ref>
supabase db push
```

Then confirm:

```sql
select extname from pg_extension where extname = 'vector';
select id, public from storage.buckets where id = 'knowledge-documents';  -- public must be false
```

## Row level security summary

- `anon` — no access to either table and no execute on the retrieval function.
- `authenticated` — `select` only. Meaningful once authentication ships.
- `service_role` — bypasses RLS. Reached with the project's **secret key**, and
  used **only** from server-side route handlers.

## API keys

Supabase's current keys are a publishable/secret pair; the older `anon` and
`service_role` JWTs are being retired. A newly created project is issued both
sets, so configure the new names:

| Variable | Key | Where it may go |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | project URL | public |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | browser (RLS applies) |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` | **server only** — bypasses RLS |

`SUPABASE_SERVICE_ROLE_KEY` is still accepted as a fallback if only the legacy
key is available; the two are drop-in equivalents for `createClient`.

The publishable key is **not required yet** — nothing reads it, because every
Supabase call currently runs server-side under the secret key. It becomes
required when authentication ships.

The app refuses to serve live requests if the two keys are swapped: a
`sb_secret_...` value under the `NEXT_PUBLIC_` name would be compiled into the
browser bundle and handed to every visitor, so `/api/health` reports it as a
configuration problem and the routes return 503.

The demo role switcher in the prototype is a presentation aid. It is not
authentication and grants no database access.
