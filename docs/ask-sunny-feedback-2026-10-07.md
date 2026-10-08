# Ask Sunny feedback, 6–8 October 2026

Four feedback items from the admin Feedback screen, investigated against the
conversations, the form records and the knowledge base (read-only), and fixed
in PR #90. No production data was changed.

**This repository is public.** This document names no person, quotes no
record identifier and repeats no credential. The affected records are listed
in the review report, not here.

## Root causes

| Feedback | What happened | Cause | Fix |
|---|---|---|---|
| Corrective Action, 2★ | Finalize demanded a policy acknowledgement for a quote Sunny had sourced | The form card saves every field; `saveInstanceValues` rewrote all of them as the manager's with empty provenance, stripping `verified` from the untouched quote | Only changed fields are rewritten; a checkbox selection is compared as a set |
| Same conversation | "Which of them is this for — <employee> or Omaha Center?" | "Omaha Center" (NE Omaha 144th and Center) was not recognised as a salon, so it read as a capitalised name | A roster salon's shortened name is a place |
| Coaching Forms, 4★ | A Coaching Form was created for an employee called "based" | "based" was read as a typed name after the form request | Topic connectors ("based on", "due to") are never names |
| Same conversation | "The knowledge base doesn't contain any policy on checking accounts" | False: approved training books and the promotion guide cover it. Vector-only retrieval read the question as a coaching request | Keyword retrieval beside vector retrieval, for chat answers |
| Training, 4★ | "was just seeing if it could make training sheets" | The facsimile-form rule banned anything with fill-in blanks | Training checklists and worksheets allowed from sources; HR forms still refused |
| General, 1★ | "How can I change the password on this platform" → "not documented" | The app guide covers it but shares none of the question's words; the guide was also wrong about the app | Explicit questions about Ask Sunny pin its app guide; guide rewritten from the code |
| Same conversation | An answer repeated new-hire default passwords | Copied from a manual section for an unrelated question | Default passwords withheld from grounding and source cards unless the question is about setting up a new hire |

## What changed

- **Form saves** (`lib/forms/instances.ts`).
- **Who a form is for** (`lib/forms/proposal.ts`, `name-words.ts`).
- **Keyword retrieval** (migration `20261008001000`, `lib/knowledge/hybrid.ts`): vector results keep their order; at most four keyword-only rows are added, and only when the vector leg found the question on-topic. Chat only; form policy grounding stays vector-only.
- **App questions** (`lib/ai/app-knowledge.ts`): "Ask Sunny", "this app/platform/site", "on here" pin the app guide by identity.
- **App guide** (`docs/knowledge/ask-sunny-app-knowledge.txt`): rewritten from verified facts; tests check it against the permission matrix, video policy and categories.
- **Default passwords** (`lib/knowledge/credential-redaction.ts`).
- **Training material** (`lib/ai/prompts.ts`).

## The migration: locking and disruption

`20261008001000_knowledge_keyword_retrieval.sql` adds a **stored generated
column** to `knowledge_chunks`, a GIN index and one function.

| Statement | Lock | Effect while it runs |
|---|---|---|
| `add column … generated … stored` | ACCESS EXCLUSIVE; table rewrite; every index rebuilt (HNSW included) | Chat retrieval and the Woven knowledge sync **wait** (they are delayed, not failed) |
| `create index … using gin` | SHARE | Reads continue; writes wait |
| `create function`, grants | none on the table | none |

- **Lock timeout 5 s.** Verified on Postgres 16: behind a long open reader, the
  migration gives up after 5.03 s and leaves nothing behind (no column, no
  function). Retry in a quieter minute.
- **Statement timeout 10 min** (production role default is 2 min).
- **Measured:** 3.6 s on 13,455 rows without the vector index (native
  Postgres 16); about 17 s with the HNSW rebuild (PGlite). **Expect 5–20 s of
  paused retrieval in production.**
- **Apply it as one transaction** (Supabase `apply_migration`). If a tool runs
  it statement by statement, wrap it in `begin; … commit;`.

**Window:** 23:05–23:25 US Central. Over the 14 days to 8 October there were no
chat messages between 23:00 and 04:59 Central, and the Woven knowledge sync
runs at :40 past the hour (finishing within 40 s). Never start it between :35
and :45. The other scheduled jobs run at 11:00–12:17 UTC.

## Deployment — Ask Sunny

Supabase project `rbkylaavthsjepsczccv`; Vercel project `ask-sunny`. Every
migration already on `main` is present in this database; `20261008001000` is
the only new one. **No environment variables change.**

1. **Approve and squash-merge PR #90** (squash keeps the branch's intermediate
   history out of `main`; see the privacy note in the review report).
2. **Migration, in the window above**, with Supabase `apply_migration` (never
   `supabase db push` here; see `docs/woven-access-sync.md`). Then verify:
   - `content_tsv` exists and is populated on every chunk;
   - `knowledge_chunks_content_tsv_idx` exists;
   - `has_function_privilege('anon', 'public.match_knowledge_chunks_keyword(text[], text[], text, integer, text[])', 'execute')` is false;
   - add the row to "Migration history in Production" in `docs/woven-access-sync.md`.
   The application tolerates either order; the migration first keeps the
   disruption inside the window.
3. **Deploy**: merging to `main` triggers the Vercel Production build. Confirm
   it builds from the squash commit and that `NEXT_PUBLIC_DEMO_MODE` is still
   `false` for Production.
4. **Smoke test** as a Salon Director (it writes only that tester's own chat history): a checking-account question
   cites the TC Mastery material; "how do I change my password on this
   platform" describes "Forgot your password?"; "how do I change my password"
   does not quote a default password.
5. **Re-upload the app guide, after it is approved.** Knowledge Base → Upload,
   as an administrator: file `ask-sunny-app-knowledge.txt`, title exactly
   `ask sunny app knowledge` (same title = a new version of the existing
   document, not a duplicate; a different title would create a second document
   and the guide would no longer be pinned). Confirm version 2 is indexed.

**Rollback:** redeploy the previous Production build (the migration can stay;
nothing else calls it). To remove the migration:
`drop function public.match_knowledge_chunks_keyword(text[], text[], text, integer, text[]); drop index public.knowledge_chunks_content_tsv_idx; alter table public.knowledge_chunks drop column content_tsv;`
(2 ms measured; the column drop is metadata-only). Restore the guide from its
version history.

## Deployment — Ask Bubbles

Ask Bubbles is a **separate codebase** (`Glowbrands1/Ask-bubbles`), its own
Vercel project and its own Supabase project (corpus
`bcs-core`). It does not build from this repository.

- **Nothing in PR #90 deploys to Ask Bubbles. No migration, environment
  variable or knowledge document is required there for this release.**
- **Do not apply `20261008001000` to Ask Bubbles** until its code calls the
  keyword function; its migration history is its own.
- **Never copy** `docs/knowledge/ask-sunny-app-knowledge.txt` (it describes Sun
  Tan City's app and roles), this document, or tests naming Sun Tan City
  salons into Ask Bubbles.
- **Worth porting later, adapted:** the form-save fix (Ask Bubbles'
  `saveInstanceValues` has the same rewrite-every-field behaviour, latent while
  it has no policy-grounded forms), keyword retrieval with its migration, the
  default-password redaction (with Buff City Soap's own systems) and the
  training-material prompt rule.

**Isolation checked on 8 October:** the Ask Bubbles database holds 0 documents
or chunks outside `bcs-core`, and none mentioning Sun Tan City, SunLync, MyGlow
or a default password; it has no forms, no location mappings and no Sun Tan
City users. Its Woven sync already excludes Sun Tan City / JB & Associates
titles (its own tenant-isolation tests). In this repository, chat binds the
corpus on the server (`activeKnowledgeCorpus()`), and the keyword function is
tested to return nothing across brands in either direction.
