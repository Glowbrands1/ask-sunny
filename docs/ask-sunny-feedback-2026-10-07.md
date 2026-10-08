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
  function). **A failed migration is never retried automatically:** stop,
  investigate and request approval (Deployment, step 2).
- **Statement timeout 10 min** (production role default is 2 min).
- **Measured:** 3.6 s on 13,455 rows without the vector index (native
  Postgres 16); about 17 s with the HNSW rebuild (PGlite). **Expect 5–20 s of
  paused retrieval in production.**
- **Apply it as one transaction** (Supabase `apply_migration`). If a tool runs
  it statement by statement, wrap it in `begin; … commit;`.
- **Keyword search cost.** Rollout preparation found the first version of the
  function quadratic in the number of matching chunks: Postgres guesses that a
  run-time tsquery matches one row and recomputed the word weights, corpus count
  included, once per candidate. In production a question with ten common words
  ("client", "tanning", "salon"…) reaches about 5,000 of the 13,455 chunks and
  would have hit the 8 s statement timeout on every such chat. Each step is now
  computed once (`MATERIALIZED`). 1,500 matching chunks on PGlite: 25 s before,
  0.46 s after; the integration suite now fails above 10 s.

**Window:** 23:05–23:25 US Central. While daylight saving time lasts (until
1 November 2026) that is CDT, UTC−5: 04:05–04:25 UTC and 12:05–12:25 Philippine
time the next day. After 1 November (CST, UTC−6) it is 05:05–05:25 UTC and
13:05–13:25 Philippine time. Over the 30 days to 8 October there were no chat
messages and no activity events between 23:00 and 23:59 Central. The Woven
knowledge sync runs at :40 past the hour (finishing within 40 s); never start
between :35 and :45. The other scheduled jobs run at 11:00–12:17 UTC.

## Deployment — Ask Sunny

Supabase project `rbkylaavthsjepsczccv` (Preview and Production share it);
Vercel project `ask-sunny`. Every earlier migration on `main` is present in this
database (some without a history row, see `docs/woven-access-sync.md`);
`20261008001000` is the only new one. **No environment variables change.**

1. **Before the window.** Run the Supabase security and performance advisors
   for a baseline. Note the current Production deployment in Vercel (the
   rollback target). An administrator downloads the current app guide from the
   Knowledge Base (document → Download): only the current version can be
   downloaded through the app, and it is the only rollback copy.
2. **Migration, in the window**, with Supabase `apply_migration` (never
   `supabase db push` here). Not between :35 and :45 past the hour. Then verify:
   - every chunk has `content_tsv`, none null;
   - `knowledge_chunks_content_tsv_idx` is a valid, ready GIN index;
   - the function is security invoker, stable, `search_path = public, extensions`;
   - execute: `anon` no, `authenticated` yes, `service_role` yes (the app calls
     it as the service role), matching `match_knowledge_chunks`;
   - no lock is still waiting on `knowledge_chunks`; a history row exists;
   - a ten-common-word call returns in well under a second, and the
     checking-account call returns the TC Mastery chunk;
   - the advisors show nothing new.

   **If the migration fails** (lock timeout, statement timeout or any other
   error): **stop. Do not retry it.** Record the error; check which of the
   column, index and function exist, whether anything is still waiting on
   `knowledge_chunks`, and whether a history row was written; report all of
   it and request approval before running it again. Do not merge.

   **If it succeeds but a check fails:** stop and report before anything else.
   The prepared remedy, run only with approval, is
   `drop function public.match_knowledge_chunks_keyword(text[], text[], text, integer, text[]);`
   chat then falls back to vector search at once, with no redeploy.
3. **Merge**: squash-merge PR #90; Vercel builds Production from the squash
   commit. Confirm it is Ready and `NEXT_PUBLIC_DEMO_MODE` is still `false`.
   (The code also tolerates the opposite order: without the function, chat is
   vector-only.)
4. **Smoke test with a dedicated test account**, never a manager's: a Salon
   Director scoped to one salon, invited by an administrator to a mailbox the
   team controls. Chat only: no form proposals, no form picker, no ratings.
   It writes that account's own chat history and analytics events, nothing
   else. A checking-account question cites the TC Mastery material; "how do I
   change my password on this platform" describes "Forgot your password?";
   "how do I change my password" does not quote a default password. Disable
   the account afterwards (nothing is deleted).
5. **Re-upload the app guide, after it is approved.** Knowledge Base → Upload,
   as an administrator: file `ask-sunny-app-knowledge.txt`; the title field
   fills in `ask sunny app knowledge` from the file name; keep it exactly;
   category **Other**; tags empty, as now. The same title in the same corpus
   becomes version 2 of the existing document (same id, version 1 recorded
   under previous versions), never a second document. The document is not
   retrievable for the few seconds it is re-indexed. Confirm version 2 is
   indexed, then ask the password question again.

**Rollback:** in Vercel, promote the previous Production deployment (Instant
Rollback); the migration can stay, nothing else calls it. To remove the
migration:
`drop function public.match_knowledge_chunks_keyword(text[], text[], text, integer, text[]); drop index public.knowledge_chunks_content_tsv_idx; alter table public.knowledge_chunks drop column content_tsv;`
(2 ms measured; the column drop is metadata-only). The app has no "restore
version": to undo the guide, re-upload the copy downloaded in step 1 under the
same title (it becomes version 3).

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
