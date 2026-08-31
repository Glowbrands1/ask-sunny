# Supabase — migrations, Edge Functions and setup

## Migration order

| File | What it does |
| --- | --- |
| `20260829000100_extensions.sql` | Enables `vector` (pgvector) and `pgcrypto`. |
| `20260829000200_knowledge_schema.sql` | `knowledge_documents`, `knowledge_chunks`, enums, indexes, HNSW vector index. |
| `20260829000300_match_knowledge_chunks.sql` | `match_knowledge_chunks()` — the cosine similarity RPC used for retrieval. |
| `20260829000400_rls.sql` | Row level security. Deny by default; `anon` gets nothing. |
| `20260829000500_storage_bucket.sql` | The **private** `knowledge-documents` bucket. |
| `20260831000600_rls_privilege_hardening.sql` | Corrective. Removes default privileges the browser roles inherited, and the retrieval function's PUBLIC execute grant. |
| `20260831000700_pin_function_search_path.sql` | Corrective. Pins `touch_updated_at`'s `search_path`. |
| `20260831000800_embedding_dimensions_384.sql` | Corrective. Narrows the embedding column, the RPC and the HNSW index from 1024 to 384 for the new embedding model. |
| `20260831000900_reporting_enums.sql` | Reporting: controlled vocabularies (source kind, period grain, ingestion status, metric unit). |
| `20260831001000_reporting_sources_and_files.sql` | Reporting lineage: `report_sources`, `report_files`. |
| `20260831001100_reporting_periods_and_ingestions.sql` | Reporting lineage: `report_periods`, `report_ingestions`. |
| `20260831001200_reporting_dimensions.sql` | Shared dimensions: `report_metrics`, `salons`, `salon_period_attributes`. |
| `20260831001300_comp_sales_facts.sql` | The Comp Sales fact model and the `comp_sales_current_facts` read view. |
| `20260831001400_reporting_rls.sql` | Row level security for the reporting domain. |
| `20260831001500_reporting_storage_bucket.sql` | The **private** `reporting-sources` bucket. |
| `20260831001600_reporting_seed_comp_sales.sql` | Reference data: the Comp Sales source and its metric vocabulary. |

Applied migrations are never rewritten. A defect in one already run against a
live project is fixed by a **new** migration that converges on the same end
state; the older file keeps saying what it did. That is why files above
disagree about the vector width — 000200 through 000600 describe the schema as
it was, and 000800 describes it as it is.

## Reporting (Salon Performance / Comp Sales)

**"Comp Report" here means COMPARABLE-STORE (same-store) salon performance.**
Not compensation, not payroll, not bonuses. The source workbook has no employee
dimension; its grain is one row per salon per reporting period. A real
compensation report, if one arrives, is a separate report family with its own
parser and its own fact table.

The reporting tables live in `public` alongside the knowledge tables but form a
separate bounded domain: nothing in reporting references `knowledge_documents`
or `knowledge_chunks`, and nothing in the knowledge migrations references a
reporting table. A test enforces both directions.

They are in `public` rather than a `reporting` schema because PostgREST only
serves schemas named in a project-level API setting, and the app reaches
Supabase exclusively through supabase-js. A `reporting` schema would be
unreachable until someone changed a dashboard setting by hand.

### Shape

```
report_sources --< report_files --< report_ingestions >-- report_periods
                                          |
                     salons --< salon_period_attributes
                        \--------< comp_sales_facts >-- report_metrics
```

* **Lineage** — every fact carries `ingestion_id`, so `dashboard value -> fact
  -> ingestion -> file -> the original workbook` is a foreign-key walk. Facts
  also record the sheet and spreadsheet column they were read from.
* **History** — corrections **supersede, never overwrite**. A restated report
  stamps `superseded_by_ingestion_id` on the old rows and inserts new ones
  beside them. Reads filter on that being null; audit can still see what a
  report said when it first arrived.
* **Idempotency** — three layers: `file_sha256` unique (same bytes),
  `(source_id, external_message_id)` unique where present (same delivery), and
  a partial unique index on `(salon_id, period_id, metric_id, basis_year)` over
  live rows only (same business key).
* **Metric vocabulary** — `report_metrics` is a controlled list. A parser
  resolves a column to a code that already exists; it cannot invent one. The
  composite foreign key `(metric_id, basis_year_required)` means the database
  refuses a fact whose baseline year is missing when the metric needs one.
* **`salon_number` is text.** Source values are zero-padded (`0468`). Numeric
  coercion drops the zero and splits a salon's history in two.
* **Percentages are fractions.** `-0.0299` means -2.99%, matching the source.

### Adding a report family (KPI, Personal Bonus, Salon Bonus)

Add a row to `report_sources` with a new `report_family`, add any new metric
codes to `report_metrics`, and add **one new fact table** for that family. Every
dimension and every lineage table above is reused unchanged. There is
deliberately no single generic facts table shared across families.

### Verifying before applying

`supabase/tests/` applies the whole migration sequence to a throwaway local
PostgreSQL cluster and then tries to break it. See the README there.

## Embeddings

Documents and questions are embedded by **`gte-small`, running inside this
project's own Edge Function** — `supabase/functions/embed`. There is no
embedding vendor, no separate account and no embedding API key. The Supabase URL
and secret key the app already needs are the whole credential set.

```
supabase functions deploy embed
```

The function accepts `POST {"inputs": ["…"]}` and returns
`{"model": "gte-small", "dimensions": 384, "embeddings": [[…]]}`. It runs with
JWT verification on, so a caller must present a project key.

## Embedding dimension

`knowledge_chunks.embedding` is `vector(384)`.

That number is not arbitrary and is not guessed. It is the fixed output width of
the model selected in `src/lib/config/models.ts`:

```
EMBEDDING_MODEL = "gte-small"   // 384 dimensions, fixed
```

`MIGRATED_EMBEDDING_DIMENSIONS` in that same file records what these migrations
declare. If the two ever disagree, `/api/health` reports
`embeddingDimensionMismatch` and the ingestion and chat routes refuse to run
rather than writing vectors the index cannot search.
`src/lib/config/embedding-dimensions.test.ts` parses the SQL and the Edge
Function source and fails the build before that can happen.

**Changing the embedding model** therefore means:

1. Update `EMBEDDING_MODEL` (and its entry in `EMBEDDING_MODELS` if the model is new).
2. Add a migration altering the column, the HNSW index and the RPC's argument
   type. The old RPC signature must be **dropped**, not replaced: the argument
   type is part of a function's identity, so `create or replace` with a
   different width adds an overload instead of replacing it.
3. Re-embed every chunk — old vectors are not comparable across models, and the
   column alter refuses to run while rows of the old width exist.
4. Update `MIGRATED_EMBEDDING_DIMENSIONS`.

`gte-small` truncates its input at **512 tokens** and does not report doing so,
so `CHUNKING` is sized to stay under that ceiling. A chunk larger than the limit
would be stored with an embedding computed from its opening only.

## Applying these

```bash
supabase link --project-ref <ref>
supabase db push
supabase functions deploy embed
```

Then confirm:

```sql
select extname from pg_extension where extname = 'vector';
select id, public from storage.buckets where id = 'knowledge-documents';  -- public must be false

-- The embedding column and the RPC must agree on 384.
select atttypmod from pg_attribute
 where attrelid = 'public.knowledge_chunks'::regclass and attname = 'embedding';
select pg_get_function_identity_arguments(oid) from pg_proc
 where proname = 'match_knowledge_chunks';
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
