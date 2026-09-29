# Woven → Ask Sunny knowledge sync

**Status (29 September 2026): migration applied to Ask Sunny Dev
(`rbkylaavthsjepsczccv`, which Production reads); code merged to `main`.** No
Production credentials are set, no scan or sync has run, automatic sync is off,
and the schedule is not in `vercel.json`. The rollout steps are in §9. QA:
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
| Policies | `GET /Policy` table (`data-policy-id`, `data-status`, `data-disabled`; headers Policy, Status, Audience, Last Updated, Acknowledgement) plus `GET /Policy/Details/{id}` | Updated date, version (`.dropdown-toggle`), attachment document ids, name, size and type, a digest of the body text, and SHA-256 of the bytes | **Body text: yes**, from `#policy-editor-column` → `label[for="ContentHTML"]` → `.read-only-label`, as a text document. **Attachments: yes**, from `#policy-attachments [data-document-id]` (and `mPolicyAttachments` where present), downloaded via the fresh temporary URL passed to `DownloadDocumentFromDashboard(...)` |
| Handbooks | `POST _Handbooks_List_ForDataTable` plus the manage page's `mCurrentVersionID` and `mUpdatedOn` | Version id, updated date, SHA-256 | **Yes**, via `POST _Handbook_DownloadVersion` and then the signed URL |
| Procedures | `POST _Search_Procedures` cards, each employee detail page, and each `/Management` page | A digest of the steps (`.procedure-step-container[data-procedure-step-id]` → `#procedure-step-content`) and the attachment ids (`data-attachment-id`); no dependable date exists | **Step text: yes**, as a text document. Attachment files: blocked (`DownloadProcedureStepAttachment` not captured); procedure → step → document id → file name is recorded |
| File Library | `POST _FileLibrary_Management_List_ForDataTable` (the whole collection) | Type, title, status, audience, size and updated date | Blocked (`DownloadFileLibraryDocument` not captured). Video and other non-document types are excluded as unsupported |
| Knowledge Elements | `POST _KnowledgeElement_List_ForDataTable` (`LearningElementStatus: "null"`), then for published elements the details page and each linked `/Content/{pageId}` page | Status, version, updated date, a digest of the content text | **Yes** for the verified content type: title `#Name`, blocks `.content[content-id]`, with links kept as references (an external SharePoint video is text, never downloaded). Any other content type keeps the element blocked |
| Courses | `POST _Course_List_ForDataTable` (`IsArchived: false`) | Status, version, updated date | Blocked. `_Course_Items` and its headers are known, but no populated row exists in this account, so its row schema is not assumed |

**Blocked** items are tracked, compared every month, and listed under
Advanced. They are never guessed at. When the evidence in §10 arrives, the
blocked retrieval for that part is replaced with a real one in `adapters.ts`
and `connector.ts`. Nothing else changes.

Every assumed Woven name — routes, fields, variables, status labels — is in
`src/lib/knowledge-sync/woven/contract.ts`, marked VERIFIED or UNVERIFIED.

## 3. Publication and audience

- **Only content the contract recognises as published is synced:** Policies `current` or `published` and not disabled; Handbooks `Published` with a current version; File Library `Published`; learning content `Current`. An unrecognised status is `unknown`, and unknown is never synced.
- **Ask Sunny has one knowledge audience today: every signed-in user.** RLS on `knowledge_documents` is `using (true)`, and retrieval does not filter by role. So a Woven audience maps to "in Ask Sunny" or "not in Ask Sunny":
  - **Public** (verified as Woven's company-wide audience for Handbooks, the File Library and Policies) is synced. Woven policies are `Public` or `Targeted`. The Audience column's display summary, such as "All Teams 8 Positions", is never read as Public.
  - Anything narrower (`Targeted`), or no audience stated (Procedures and Knowledge Elements state none), is **held for review**. An administrator decides once per audience label: "Share with everyone" or "Keep out". New items with the same audience follow that decision. If an item's audience changes, it is re-evaluated. If an item already in Ask Sunny becomes narrower, it is retired (`PERMISSION_CHANGED`) until someone decides.
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

## 8a. Preview test mode (live Woven check before the migration)

**On a Vercel Preview (or local development) deployment whose database does not have the sync tables,** the screen offers Test Connection and Run Initial Scan under a banner: "Preview test mode — results are not saved".

- **Test Connection:** signs in, confirms the company and reads one list. It needs no tables.
- **Run Initial Scan:** runs the real dry run against Woven with an in-memory store that lasts only for that request. The report is shown on screen and saved nowhere.
- **Ask Sunny is never written.** The sink used in this mode refuses every write. The only database access is a read of hand-uploaded document titles, for the duplicate count.
- **Never in Production.** The mode is gated on `VERCEL_ENV` (`preview` or `development`; outside Vercel, a non-production Node build). It applies only to a preview run: a real sync with missing tables fails as before.

## 9. Production rollout

Done:

- ✅ Migration `20260929001000_woven_knowledge_sync` applied verbatim, and verified: the five tables are forced-RLS with no browser access; `retired` has been added; both read policies exclude retired documents; the 59 existing documents are still visible to signed-in users; the security advisors show no new warnings.
- ✅ Code merged to `main`, so the admin screen ships with the Production deployment.

Remaining, in order. Each step is separately approved.

1. **Production variables** (Vercel → Production, Sensitive): `WOVEN_KNOWLEDGE_SYNC_ENABLED=true`, `WOVEN_TEAM_USERNAME` and `WOVEN_TEAM_PASSWORD`, for the dedicated integration account. Then redeploy Production.
2. **Test Connection** from Admin → Integrations → Woven Knowledge Sync. It writes nothing. `woven_company_selection_unverified` means the Select Company step appeared, and the rollout stops there until that request is captured.
3. **Run Initial Scan.** This is the dry run. It writes only its own run report and adds nothing to Ask Sunny. Review the per-type counts, the audience groups and any error codes.
4. **Audience choices,** only for groups you want shared ("Share with everyone" / "Keep out").
5. **Start Initial Sync.** This is the first ingestion. Anything not reached within one run's time limit is finished by a later run.
6. **Schedule:** add `{ "path": "/api/knowledge-sync/woven/cron", "schedule": "40 9 * * *" }` to `vercel.json`, deploy, then click **Enable Automatic Sync**. The daily check runs a full sync every 30 days, and on other days only finishes or retries work.

## 10. Browser evidence still needed

The second browser pass (September 2026) verified:

- the active-company marker;
- the policy table headers and the Public/Targeted audience setting;
- the policy body and attachment structure;
- the Knowledge Element content page;
- the procedure step and attachment structure;
- the Course Items headers.

All of these are implemented. What remains, captured from a signed-in JB & Associates session (redact cookies, tokens and SAS signatures):

1. **Company selection:** the request sent when "JB & Associates" is chosen on the Select Company step (method, path, fields, response or redirect). If the integration account never sees that step, say so; that alone resolves this item. Until then, a sign-in that shows the step stops safely with `company_selection_unverified`.
2. **File Library download:** the network request made by `DownloadFileLibraryDocument(id, 'FileLibrary')`, and its response.
3. **Procedure attachment download:** the network request made by `DownloadProcedureStepAttachment(name)`, and its response.
4. **Course items:** one POPULATED `/Course/_Course_Items?pCourseID={id}` response, meaning an `.entity-row[data-pk]` with its cells. This needs an account or course that has items.

**Anti-forgery on list POSTs** was not settled by the browser pass. It is left to the first live check: if Woven requires a header, list reads fail closed with `woven_antiforgery_rejected`, and the header name then goes in `ANTIFORGERY_HEADER` in `contract.ts`.
