# Woven → Ask Sunny knowledge sync

**Status: built and tested. Not deployed.** The migration is not applied, no
credentials are set, and the schedule is not in `vercel.json`. QA:
`docs/woven-knowledge-sync-qa.md`.

**The goal:** configure Woven once. After that, Ask Sunny checks Woven every 30
days and keeps its knowledge base current. Managers only get involved when
something genuinely needs them.

**The decision this records.** `docs/woven-knowledge-sync-design.md` said
"supported API or nothing". The business has since decided to build the sync
on the authenticated Woven Team web application's own internal routes, as
documented in the Woven Team connector handoff. That note is kept for history
and marked superseded.

---

## 1. How a sync runs

```
daily tick (not yet scheduled) ─┐      Sync Now / Initial Scan ─┐
                                ▼                               ▼
          runWovenKnowledgeSync  →  runKnowledgeSync  (one engine for every trigger)
                                │
      ┌─────────────────────────┼──────────────────────────────┐
      ▼                         ▼                              ▼
 Woven connector          reconcile (pure)               Ask Sunny sink
 sign in, confirm         listing vs manifest:           existing pipeline:
 company, 6 adapters,     NEW / UPDATED / UNCHANGED /    ingestDocument (explicit id),
 fresh downloads          PERMISSION_CHANGED /           updateDocumentMetadata,
                          UNPUBLISHED / REMOVED /        retireDocument
                          BLOCKED / ERROR /
                          NEEDS_REVIEW / EXCLUDED
                                │
                                ▼
          knowledge_sync_items (manifest) · _runs · _events · _settings · _audience_decisions
```

**Modes**

| Mode | What it does |
|---|---|
| `preview` | The initial scan, and any dry run. Reads and classifies everything, and writes nothing except the run's own report. |
| `sync` | Sync Now, and the monthly run. Scans, saves the scan, then applies it: downloads only what is new or changed, ingests or updates, and retires what left. |
| `continue` | Makes no list requests. Finishes work a sync did not reach in its time budget, and retries failed items. This is how a large first sync finishes unattended. |

**Every 30 days, without cron syntax.** Vercel cron cannot say "every 30 days",
so the daily tick decides what to do (`decideScheduledWork`):

- A full sync when 30 days have passed since the last **complete** scan. A scan in which a content type could not be read does not count as complete, so the next day tries again.
- Otherwise, a `continue` run if work is waiting or due a retry.
- Otherwise nothing. It does not even sign in to Woven.

An administrator turns automatic sync on from the screen, once the initial
sync is done. The schedule can never perform the first bulk ingestion.

## 2. What is synced, per content type

| Type | Listing (verified route) | Change evidence | Content into Ask Sunny |
|---|---|---|---|
| Policies | `GET /Policy` table (`data-policy-id`, `data-status`, `data-disabled`) plus `GET /Policy/Details/{id}`, which carries `mPolicyAttachments` | Updated date, attachment `DocumentID`s, name, size and type, and SHA-256 of the bytes | **Attachments: yes**, via a fresh `AzureFileURL` from the detail page. Page text: blocked |
| Handbooks | `POST _Handbooks_List_ForDataTable` plus the manage page's `mCurrentVersionID` and `mUpdatedOn` | Version id, updated date, SHA-256 | **Yes**, via `POST _Handbook_DownloadVersion` and then the signed URL |
| Procedures | `POST _Search_Procedures` cards plus each detail page | A deterministic fingerprint of the detail content (no dependable date exists) | Blocked (step markup and attachment download not captured) |
| File Library | `POST _FileLibrary_Management_List_ForDataTable` (the whole collection) | Type, title, status, audience, size and updated date | Blocked (`DownloadFileLibraryDocument` not captured). Video and other non-document types are excluded as unsupported |
| Knowledge Elements | `POST _KnowledgeElement_List_ForDataTable` (`LearningElementStatus: "null"`) | Status, version, updated date | Blocked (content selectors not captured) |
| Courses | `POST _Course_List_ForDataTable` (`IsArchived: false`) | Status, version, updated date | Blocked (`_Course_Items` fields not captured) |

**Blocked** items are tracked, compared every month, and listed under
Advanced. They are never guessed at. When the evidence in §10 arrives, the
blocked retrieval for that part is replaced with a real one in `adapters.ts`
and `connector.ts`. Nothing else changes.

Every assumed Woven name — routes, fields, variables, status labels — is in
`src/lib/knowledge-sync/woven/contract.ts`, marked VERIFIED or UNVERIFIED.

## 3. Publication and audience

- **Only content the contract recognises as published is synced:** Policies `current` or `published` and not disabled; Handbooks `Published` with a current version; File Library `Published`; learning content `Current`. An unrecognised status is `unknown`, and unknown is never synced.
- **Ask Sunny has one knowledge audience today: every signed-in user.** RLS on `knowledge_documents` is `using (true)`, and retrieval does not filter by role. So a Woven audience maps to "in Ask Sunny" or "not in Ask Sunny":
  - **Public** (verified as Woven's company-wide audience) is synced.
  - Anything narrower, or no audience stated, is **held for review**. An administrator decides once per audience label: "Share with everyone" or "Keep out". New items with the same audience follow that decision. If an item's audience changes, it is re-evaluated. If an item already in Ask Sunny becomes narrower, it is retired (`PERMISSION_CHANGED`) until someone decides.
- **Blocked items are not put up for an audience decision.** A decision could not change anything for them yet.

## 4. Safety

- **Fails closed.** Each of the following is a failure, never "no content": a redirect to `/Login`, a login form, 401 or 403, an anti-forgery refusal, HTML where JSON was expected, a missing `list`, `Success` or `HTML`, or rows that mostly lack an id.
- **Removal needs proof.** Nothing is retired unless all of these hold:
  - sign-in succeeded;
  - the company was confirmed as JB & Associates;
  - that content type's listing succeeded and parsed;
  - the listing is not empty when there was content before, and not less than half of the previous size.

  Across the whole run, removing more than 10 items **and** more than 25% of the documents in Ask Sunny at once is held until an administrator confirms it.
- **Retire, never delete.** Retired documents get the new `retired` status. They drop out of search (every retrieval path requires `status = 'indexed'`), the library list, citation lookup and download, but the row, chunks and file are kept. Re-publishing restores the **same** document id.
- **Idempotent.** A new item's Ask Sunny document id is saved to the manifest before ingestion, so a retry reuses it. The database allows one manifest row per `(source, type, entity, part)` and one owner per knowledge document.
- **Per-item isolation.** A failed download or ingest is recorded against that item and retried daily, at most 5 times automatically. Items that succeed are never re-ingested by a retry.
- **Nothing secret is stored or logged.**
  - The session cookie lives in memory for one run.
  - Signed storage URLs are obtained fresh, used once, fetched **without** the Woven cookie from `*.blob.core.windows.net` only, and never stored.
  - The database refuses a `locator` containing a URL or SAS signature.
  - Error messages carry paths, never query strings.
- **Read-only.** Every POST is a list or search read, or the download-link request the web app itself makes.

## 5. Files

| Path | Role |
|---|---|
| `src/lib/knowledge-sync/types.ts`, `ports.ts` | The source-independent vocabulary and interfaces |
| `src/lib/knowledge-sync/reconcile.ts` | Pure classification and the removal guards |
| `src/lib/knowledge-sync/engine.ts` | The one engine: preview, sync, continue; retries; time budget |
| `src/lib/knowledge-sync/access.ts` | Audience keys and access decisions |
| `src/lib/knowledge-sync/store.ts`, `memory-store.ts` | Supabase and in-memory persistence |
| `src/lib/knowledge-sync/sink.ts` | Ask Sunny's existing pipeline as the sink |
| `src/lib/knowledge-sync/woven/contract.ts` | **Every Woven name.** The one file to correct |
| `src/lib/knowledge-sync/woven/config.ts` | Environment variables |
| `src/lib/knowledge-sync/woven/http.ts` | Same-origin cookie client, redirects, retries, fail-closed checks, signed downloads |
| `src/lib/knowledge-sync/woven/session.ts` | Login, plus the replaceable `CompanySelector` and `CompanyVerifier` |
| `src/lib/knowledge-sync/woven/html.ts` | parse5-based reading of pages and inline variables (never executed) |
| `src/lib/knowledge-sync/woven/adapters.ts` | The six adapters as pure parsers |
| `src/lib/knowledge-sync/woven/connector.ts` | Wires the session, adapters and downloads to the engine |
| `src/lib/knowledge-sync/woven/sync.ts` | Service entry points, Test Connection, the schedule decision |
| `src/lib/knowledge-sync/woven/status.ts` | What the admin screen shows |
| `src/app/api/admin/knowledge-sync/woven/**` | Status and settings, run, test, audiences (`manage_integrations`) |
| `src/app/api/knowledge-sync/woven/cron/route.ts` | The daily tick (`CRON_SECRET`). **Not in `vercel.json`.** |
| `src/features/admin/woven-knowledge/`, `src/app/(app)/admin/integrations/woven-knowledge/` | The admin screen |
| `src/lib/ingestion/pipeline.ts` | Now accepts an explicit `documentId` and `source`; uploads are unchanged |
| `src/lib/ingestion/lifecycle.ts` | Adds `retireDocument` (refuses uploaded documents) and `updateDocumentMetadata` |
| `src/lib/knowledge/mappers.ts`, `providers/supabase.ts`, `original-file.ts` | Recognise `retired` and keep it out of the list, lookup and download |
| `supabase/migrations/20260929001000_woven_knowledge_sync.sql` | The schema. **Not applied.** |
| `scripts/verify-woven-knowledge-migration.mjs` | 41 checks on real Postgres (PGlite) |

## 6. Database

The migration creates five tables:

| Table | Holds |
|---|---|
| `knowledge_sync_settings` | Auto-sync switch, off by default; interval 30 days |
| `knowledge_sync_runs` | One row per run; the partial unique index is the run lock |
| `knowledge_sync_items` | The manifest |
| `knowledge_sync_events` | Per-item audit log |
| `knowledge_sync_audience_decisions` | One decision per audience label |

Every new table has RLS enabled and forced with no policies, and all
privileges are revoked from `anon` and `authenticated`.

**`retired` is a persisted lifecycle state, enforced by the database:**

- It is a new value of `knowledge_document_status`, written by `retireDocument`.
- Retrieval (`match_knowledge_chunks` and the role-document reads) requires `status = 'indexed'`, so retired documents are never matched.
- The existing `knowledge_documents_indexed_requires_status` check means a retired row can never be `indexed = true`.
- The migration replaces the two `authenticated` read policies on `knowledge_documents` and `knowledge_chunks`. Retired documents and their chunks are not readable by a signed-in user.
- Server code also keeps retired documents out of the library list, citation lookup, original-file download and re-index.

The manifest records, per item:

- Woven entity id, document id and version id; content type; title; status; audience; source updated date; attachment ids;
- observed and synced fingerprints, and the SHA-256 of the content;
- the Ask Sunny document id, and whether it is in Ask Sunny;
- first seen, last seen and last synced;
- previous and current state, the pending action and a reason code;
- last error, error category, retry count and next retry time.

## 7. Configuration

All values are server-only and entered in Vercel as **Sensitive**.

| Variable | Value |
|---|---|
| `WOVEN_KNOWLEDGE_SYNC_ENABLED` | `true` to allow anything to reach Woven. Off by default |
| `WOVEN_TEAM_USERNAME`, `WOVEN_TEAM_PASSWORD` | The Woven Team sign-in of a **dedicated integration account** (not a person's own) with read access to the knowledge content, affiliated with JB & Associates |
| `WOVEN_TEAM_COMPANY` | Optional. Default `JB & Associates` |
| `WOVEN_TEAM_BASE_URL` | Optional. Default `https://app.woven.team`, HTTPS only |

These are separate from the employee sync's Operations API variables.

## 8. Admin experience

**Admin → Integrations → Woven Knowledge Sync.**

- **Headline:** Not set up, Connected, Syncing, Up to date, or Needs attention.
- **Company:** the Woven company the sync confirmed.
- **Counts:** last successful sync, next automatic sync, documents in sync, new, updated and removed last sync, and needs attention.
- **Buttons:** Sync Now, and View Sync Details.
- **Setup,** shown until finished: Test Connection, then Run Initial Scan (preview counts), then Start Initial Sync, then Enable Automatic Sync.
- **Needs attention** lists only what a person must do: audience choices, a held mass removal, repeatedly failing documents, or a failed sync with a plain reason.
- **Advanced,** closed by default: blocked capabilities, schedule deployment, configuration problems and run history.

## 9. Go-live steps (each separately approved)

1. Create the dedicated Woven integration account.
2. Obtain the browser evidence in §10 — at minimum item 1.
3. Implement that evidence. For item 1, that means a real `CompanySelector` and `CompanyVerifier` in `session.ts`.
4. Apply the migration verbatim, in one transaction, to Ask Sunny Dev. That is also Production's database. Run `npm run verify:woven-knowledge-migration` first and the Supabase advisors after.
5. Add the Preview variables and run the QA plan's Part B.
6. Add the Production variables. Run the initial scan, review it, then run the initial sync.
7. Add `{ "path": "/api/knowledge-sync/woven/cron", "schedule": "40 9 * * *" }` to `vercel.json` and deploy. Then click **Enable Automatic Sync**.

## 10. Browser evidence still needed

Capture each item from a signed-in JB & Associates browser session, as a HAR
entry or copied request and response. Redact cookies, tokens and SAS
signatures.

1. **Company selection:** the request sent when "JB & Associates" is chosen on the Select Company step (method, path, form fields, response or redirect). Also: the element on the dashboard that shows the **active** company.
2. **File Library download:** the network request made by `DownloadFileLibraryDocument(id, 'FileLibrary')`, and its response.
3. **Procedure attachment download:** the request made by `DownloadProcedureStepAttachment('<file>.pdf')`, plus the markup around one step and its attachment (where the step id and `DocumentID` sit).
4. **Content pages:** the raw HTML of one `/Policy/Details/{id}` body, one Knowledge Element content page, and one `/Course/_Course_Items?pCourseID={id}` response.
5. **Anti-forgery on list POSTs:** the request headers of one DataTables list POST, to show whether a `RequestVerificationToken` header is sent.
6. **Policy audience:** the `/Policy` table header row, and one `/Policy/_Details_Audience?pPolicyID=…` response. This shows how a company-wide policy's audience is labelled.
