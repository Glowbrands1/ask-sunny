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
| Procedures | `POST _Search_Procedures` cards, each employee detail page, and each `/Management` page | No dependable date exists. **Step text:** a digest of each step's id, order, title and normalised body plus the attachment set. **Attachments:** procedure + step + stored file name, and the SHA-256 of the bytes, re-downloaded every full sync (`recheckBytes`) and re-indexed only when the hash moves | **Step text: yes**, read from the verified markup: each `div.procedure-step-container` with `id="procedure-step-<step id>"`, `#display-order` ("Step 1"), its `h3` title and `#procedure-step-content`. Every step is rendered twice (carousel and scroll view) and is read once, by step id. Woven's "Not Provided" placeholder is no text. A page without that structure keeps the text blocked (`procedure_content`) and is counted in the run report as `byType.procedure.shape.stepStructureMissing`. **Attachments: yes**, from each step's `DownloadProcedureStepAttachment('<stored file name>')` call, downloaded with the session from `GET /KnowledgeCenter/Download_ProcedureStep_Attachment?pAzureFileName=<stored file name>`. The stored name is the download key only, never a document id and never shown; the display name is what people see. An attachment only the management view names (no stored name) stays blocked (`procedure_attachment_unlocated`) |
| File Library | `POST _FileLibrary_Management_List_ForDataTable` (the whole collection) | FileLibraryID, UpdatedOn, then the SHA-256 of the downloaded bytes (same bytes: metadata only) | **Published PDFs and Word files: yes**, downloaded by the stable FileLibraryID from `GET /Dashboard/_FileLibrary_Download?pFileLibraryID=<id>&pDownloadedFromEntityType=FileLibrary` with the session. A redirect to storage is followed once, without the cookie, to `*.blob.core.windows.net` only, and never stored. The response must be the file (a PDF must start `%PDF`, a Word file must be a zip); a sign-in page is a lost session and any other page is `woven_not_a_file`, a per-item retryable failure. `AzureStorageName` is never used. The type cell is read like the status cell (a hidden sort key before the label is dropped), then its icon class and the title's extension; the raw labels are counted in the run report (`byType.file_library.shape["typeLabels:…"]`). Video and other non-document types are excluded as unsupported |
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
- **Idempotent.** A new item's Ask Sunny document id is derived from its identity (`knowledgeDocumentIdFor`), so every attempt, including a retry after a crash, addresses the same document. It is recorded in the manifest once the document exists. The database allows one manifest row per `(source, type, entity, part)` and one owner per knowledge document.
- **Per-item isolation.** A failed download or ingest is recorded against that item and retried daily, at most 5 times automatically. Items that succeed are never re-ingested by a retry.
- **Nothing secret is stored or logged.**
  - The session cookie lives in memory for one run.
  - Signed storage URLs are obtained fresh, used once, fetched **without** the Woven cookie from `*.blob.core.windows.net` only, and never stored.
  - The database refuses a `locator` containing a URL or SAS signature.
  - Error messages carry paths, never query strings.
- **Read-only.** Every POST is a list or search read, or the download-link request the web app itself makes.

## 4a. Current, superseded, retired

Every knowledge document is in exactly one of three states, and only CURRENT
reaches an answer:

| State | Stored as | Retrieved, cited, used by forms |
|---|---|---|
| **Current** | `status = 'indexed'`, `indexed = true`, chunks at `version` | Yes |
| **Superseded** (stale) | an older version's chunks (deleted on re-index), or a hand upload replaced by its Woven copy: `status = 'superseded'`, `superseded_by` = the current document | No — not a lower score, not a candidate |
| **Retired** | `status = 'retired'` (unpublished or removed in Woven) | No; re-publishing restores the same document id |

Every retrieval path — `match_knowledge_chunks` (chat and `groundPolicy`),
the official-manual lookup and the role-document reads — requires
`indexed = true and status = 'indexed'`, so this is enforced by the query,
not by ranking.

**Hand uploads that duplicate Woven content.** After a full sync whose every
listing was read, with no deferred work and no lost session, each hand upload
is compared with the documents the sync holds as CURRENT
(`src/lib/knowledge-sync/supersession.ts`). It is superseded only on exact
identity: the same extracted content (`content_hash`), the same original file
name (never a name the sync made up for a text part), or the same title and
file type. A title alone across file types, or an upload two different Woven
documents claim, is **held for review** (`duplicates_held` in the run's
notes) and left exactly as it was. Nothing fuzzy is used. Superseding is a
status change: the row, chunks and file stay for audit, and one SQL update
restores it (see the migration header). A tag on the superseded upload
(`official-policy-manual`, a framework tag) still identifies its successor
for the manual and role lookups. A new hand upload never becomes a version of
a Woven document of the same title, or the reverse. If Woven later retires
the replacement, the old upload is **not** brought back.

## 5. Files

| Path | Role |
|---|---|
| `src/lib/knowledge-sync/types.ts`, `ports.ts` | The source-independent vocabulary and interfaces |
| `src/lib/knowledge-sync/reconcile.ts` | Pure classification and the removal guards |
| `src/lib/knowledge-sync/engine.ts` | The one engine: preview, sync, continue; retries; time budget |
| `src/lib/knowledge-sync/access.ts` | Audience keys and access decisions |
| `src/lib/knowledge-sync/store.ts`, `memory-store.ts` | Supabase and in-memory persistence |
| `src/lib/knowledge-sync/sink.ts` | Ask Sunny's existing pipeline as the sink, including `supersedeDuplicates` |
| `src/lib/knowledge-sync/supersession.ts` | Which hand uploads a current Woven copy replaces (pure) |
| `src/lib/knowledge/locator.ts` | `displayLocator`: extractor labels ("Text", "Document body") are never shown |
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
| `src/app/api/knowledge-sync/woven/cron/route.ts` | The hourly tick (`CRON_SECRET`), `40 * * * *` in `vercel.json`: a full sync in the 09:40 UTC run once 30 days have passed; otherwise it continues or retries unfinished work. Inert while automatic sync is off. |
| `src/features/admin/woven-knowledge/`, `src/app/(app)/admin/integrations/woven-knowledge/` | The admin screen |
| `src/lib/ingestion/pipeline.ts` | Now accepts an explicit `documentId` and `source`; uploads are unchanged |
| `src/lib/ingestion/lifecycle.ts` | Adds `retireDocument` (refuses uploaded documents) and `updateDocumentMetadata` |
| `src/lib/knowledge/mappers.ts`, `providers/supabase.ts`, `original-file.ts` | Recognise `retired` and keep it out of the list, lookup and download |
| `supabase/migrations/20260929001000_woven_knowledge_sync.sql` | The schema |
| `supabase/migrations/20260930002000_knowledge_document_superseded.sql` | `superseded` status, `superseded_by`, `superseded_at` |
| `scripts/verify-woven-knowledge-migration.mjs` | 41 checks on real Postgres (PGlite) |

## 6. Database

The first migration creates five tables; `20260930001000_woven_knowledge_inventory` adds a sixth and one column:

| Table | Holds |
|---|---|
| `knowledge_sync_settings` | Auto-sync switch, off by default; interval 30 days |
| `knowledge_sync_runs` | One row per run; the partial unique index is the run lock |
| `knowledge_sync_items` | The manifest |
| `knowledge_sync_events` | Per-item audit log |
| `knowledge_sync_audience_decisions` | One decision per audience label |
| `knowledge_sync_preview_items` | The latest dry run's inventory: display metadata only (no locator, fingerprint, URL or text), replaced by each dry run |
| `knowledge_sync_items.record_title` | The Woven record's title, shared by its parts, so the Content view shows one row per item |

Every new table has RLS enabled and forced with no policies, and all
privileges are revoked from `anon` and `authenticated`.

**`retired` is a persisted lifecycle state, enforced by the database:**

- It is a new value of `knowledge_document_status`, written by `retireDocument`.
- Retrieval (`match_knowledge_chunks` and the role-document reads) requires `status = 'indexed'`, so retired documents are never matched.
- The existing `knowledge_documents_indexed_requires_status` check means a retired row can never be `indexed = true`.
- The migration replaces the two `authenticated` read policies on `knowledge_documents` and `knowledge_chunks`. Retired documents and their chunks are not readable by a signed-in user.
- Server code also keeps retired documents out of the library list, citation lookup, original-file download and re-index.

**`superseded`** (`20260930002000_knowledge_document_superseded`) is a second
value of the same type, with `superseded_by` (the current document; set only
while superseded, checked) and `superseded_at`. It changes no retrieval
function or policy: the `status = 'indexed'` requirement already excludes it.
The library lists a superseded upload with a "Superseded" badge; it is not
re-indexed.

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

## 7a. How Ask Sunny uses synced content

A synced document goes through `ingestDocument`, the same path an upload takes, and is an ordinary `knowledge_documents` row with `source = 'woven'`. Nothing else in Ask Sunny needs to know where it came from.

- **Chat.** `answerQuestion` retrieves through `SupabaseKnowledgeProvider.match` → `match_knowledge_chunks`, which returns only `indexed` documents at their current version. Citations carry the document title (the Woven policy or manual name — the business title, never "Woven document", an id or a storage name), the chunk's real page or section and the excerpt, never a URL. Extractor labels such as "Text" are dropped from source cards and from the model's grounding (`displayLocator`).
- **Forms.** The Corrective Action Form and the Policy Review find approved policy with `groundPolicy`, which searches the same server-side index (the approved categories include `policies_compliance`, where synced policies and handbooks are filed). Forms never call Woven. Before this change `groundPolicy` used the browser knowledge client, whose relative `fetch("/api/knowledge/search")` cannot run on the server, so the search always failed and the policy fields were left blank.
- **Which document is "the official manual".** The Corrective Action Form pins the JBA Policy Manual by identity: a tag, else the file name (`JBA-Policy-Manual…`), else the title. Within one of those tiers a Woven-synced copy wins over a hand-uploaded copy of the same manual (Woven is the source of truth); two copies of the same kind are still refused as ambiguous, and then the field is left for the manager rather than filled from an unrelated retrieval hit. (Live bug, 29 September 2026: after the initial sync the manual copies made the lookup ambiguous and a dress-code form read "Shift Replacement — Text".)
- **What the policy field shows.** "Direct policy from official manual" (Corrective Action and Policy Review) is the verbatim wording of the cited section, then `Source: <title> — <section>, p. <page>`, each part copied from the knowledge base: the manual's printed heading and page, or the retrieved chunk's locator. A part that is not known is omitted, never invented, and extractor labels such as "Text" are never shown as a section. The structured citation (`policyText`, `documentTitle`, `sectionTitle`, `pageLabel`, `documentId`, `source`) is kept on the value's provenance.
- **Lifecycle.** An update re-indexes the same document and deletes the previous version's chunks. Unpublishing or removing retires it: it is no longer retrieved, cited or readable by a signed-in browser. Republishing restores the same document.

Proven end to end, on the repository's own knowledge migrations running on PGlite with pgvector, by `src/lib/knowledge-sync/woven/knowledge-consumption.test.ts` (chat and `groundPolicy`) and `src/app/api/forms/woven-policy-draft.test.ts` (the Corrective Action and Policy Review draft route).

## 8. Admin experience

**Admin → Integrations → Woven Knowledge Sync**, in three tabs.

**Overview**

- **Headline:** Not set up, Connected, Syncing, Up to date, or Needs attention.
- **Company:** the Woven company the sync confirmed.
- **Counts:** last successful sync, next automatic sync, documents in sync, new, updated and removed last sync, and needs attention.
- **Buttons:** Sync Now, and View Sync Details.
- **Setup,** shown until finished: Test Connection, then Run Initial Scan (preview counts), then Start Initial Sync, then Enable Automatic Sync.
- **Needs attention** lists only what a person must do: audience choices, a held mass removal, repeatedly failing documents, or a failed sync with a plain reason.
- **Audience choices** ("Share with everyone" / "Keep out of Ask Sunny"), one per Woven audience, with its item count. They are available straight after the Initial Scan: the dry run saves an inventory of what it found (`knowledge_sync_preview_items`: titles, status and audience labels, version, dates and the classification, never a locator, URL or document text), and the choices are built from it. A choice takes effect in the counts at once and in Ask Sunny on the next sync. Parts still waiting for a choice are held out of the Initial Sync.
- **Advanced,** closed by default: blocked capabilities, schedule deployment, configuration problems, and run history with codes.

**Content:** every Woven item the latest scan or sync found, one row per item with its parts expandable (a policy's text and each attachment), showing:

- title, type, Woven status, audience (and the choice made), version;
- Woven's last-updated date, or "Updated date unavailable" when Woven gives none;
- first seen, last seen, last synced;
- a sync state: Up to date, New in Woven, Updated in Woven, Waiting for audience decision, Kept out of Ask Sunny, Not yet supported, Draft / unpublished, Retired, or Error;
- a link to each Ask Sunny document it owns.

It can be filtered by title, type, sync state, published or draft, and audience decision. Before the initial sync it lists what the latest dry run found.

**Sync History:** each run with its outcome, counts and plain-sentence notes.

## 8b. Scanning, previewing and unfinished work (30 September 2026)

- **Scan Woven** is on the Overview for good, next to Sync Now. It signs in, lists everything, classifies it (new, updated, unchanged, removed or unpublished, unsupported, waiting for an audience) and saves the scan's inventory for the Content tab. It never ingests, retires, supersedes or changes a document, the manifest, or the next automatic sync date. While a scan is newer than the last sync, the Overview shows **what Sync Now would do** (counts, plus plain sentences for anything the scan could not read), and the Content tab shows each item under that scan. **Sync Now** applies it.
- **Audience groups name their items.** Each undecided group has **View items**: every affected Woven item by title, with its type, Woven status and sync state, and a **Preview** for each readable part. **Show in Content** opens the Content tab filtered to exactly that group (the new "Audience group" filter). Only items the choice actually decides are listed.
- **Preview** (`POST /api/admin/knowledge-sync/woven/preview-part`, `manage_integrations`) shows what Ask Sunny would read in one item. An item already in Ask Sunny opens its existing document page. Otherwise the part is fetched from Woven the way a sync fetches it and run through the same extractor **in memory only** — nothing is stored, indexed or recorded — and the page gets the title, type, source name, file name and the text with its page and section labels. The request names the part by an opaque hash (`partRef`), and the locator comes from the manifest or a fresh listing, never from the browser. No Woven or storage URL, no stored file name.
- **Cadence.** The cron runs **hourly** (`40 * * * *`). A full scan and sync starts only once 30 days have passed since the last complete scan, and only in the 09:40 UTC run (a failed scan is retried the next day). Every other hour it continues deferred work and retries failed items that are due, without rescanning Woven, and it signs in to Woven only when there is such work. A run finishes about 50 files in its four-minute budget, so a backlog of 350 clears in roughly seven hours rather than a week. Documents are addressed by their derived id, so nothing is ingested twice.
- **Needs attention is specific.** "N items are still being processed" is counted from the manifest at that moment and says when they continue (the next hourly check, or Sync Now if automatic sync is off). A document that keeps failing is listed by title, with its type, a plain reason (for example, a scanned PDF with no readable text), its retry status and a link into the Content tab. Codes stay under Advanced.
- **Procedure attachments listed twice.** The management view lists each attachment again without a file name. An entry is now matched to the page's downloadable attachments by name, or failing that by count within its step; only a surplus is reported as blocked (`procedure_attachment_unlocated`).

## 8a. Preview test mode (live Woven check before the migration)

**On a Vercel Preview (or local development) deployment whose database does not have the sync tables,** the screen offers Test Connection and Run Initial Scan under a banner: "Preview test mode — results are not saved".

- **Test Connection:** signs in, confirms the company and reads one list. It needs no tables.
- **Run Initial Scan:** runs the real dry run against Woven with an in-memory store that lasts only for that request. The report is shown on screen and saved nowhere.
- **Ask Sunny is never written.** The sink used in this mode refuses every write. The only database access is a read of hand-uploaded document titles, for the duplicate count.
- **Never in Production.** The mode is gated on `VERCEL_ENV` (`preview` or `development`; outside Vercel, a non-production Node build). It applies only to a preview run: a real sync with missing tables fails as before.

## 9. Production rollout

Done:

- ✅ Migration `20260929001000_woven_knowledge_sync` applied verbatim, and verified: the five tables are forced-RLS with no browser access; `retired` has been added; both read policies exclude retired documents; the 59 existing documents are still visible to signed-in users; the security advisors show no new warnings.
- ✅ Migration `20260930001000_woven_knowledge_inventory` (the dry run's inventory and `record_title`): additive, forced-RLS, no browser access.
- ✅ Production variables set; Test Connection and the Initial Scan succeed against the live Woven (29 September 2026).
- ✅ The hourly check is in `vercel.json` (`/api/knowledge-sync/woven/cron`, at :40; full scans only in the 09:40 UTC run). It is inert until the initial sync has run and an administrator presses **Enable Automatic Sync**, and it does not sign in to Woven in an hour when nothing is due.

Remaining, in order:

1. **Run Initial Scan again** so the inventory is saved (scans before this release saved counts only).
2. **Audience choices** on the Overview tab, one per Woven audience ("Share with everyone" / "Keep out of Ask Sunny"). Items whose audience has no choice are simply held.
3. **Start Initial Sync.** This is the first ingestion. Anything not reached within one run's time limit is finished by a later run.
4. **Enable Automatic Sync.** From then on the daily check runs a full sync every 30 days, and on other days only finishes or retries work.

**Fixed before the first ingestion (found by the database-backed tests):** a new item's Ask Sunny document id used to be random and saved to the manifest before ingestion. `knowledge_document_id` is a foreign key to `knowledge_documents`, which did not have the row yet, so the first save of the initial sync would have failed the whole run. The id is now derived from the item's identity (`knowledgeDocumentIdFor`) and recorded only once the document exists; a retry addresses the same document, so nothing is duplicated.

## 10. Browser evidence still needed

The second browser pass (September 2026) verified:

- the active-company marker;
- the policy table headers and the Public/Targeted audience setting;
- the policy body and attachment structure;
- the Knowledge Element content page;
- the procedure step and attachment structure;
- the Course Items headers.

All of these are implemented. What remains, captured from a signed-in JB & Associates session (redact cookies, tokens and SAS signatures):

1. **Company selection:** implemented from browser evidence captured on 29 September 2026. Correct credentials get the account chooser ("Select account for login": JB & Associates, Midwest Soap Makers) at `/Login/Authenticate?ReturnUrl=%2F`, and that page is never reported as `login_failed`. The connector finds the `a.select-company` entry whose text is exactly JB & Associates. It reads `data-company-id` and `data-company-name` from the page on every sign-in; the id is not a constant. It then re-posts `#continue-login-form` to `/Login/Authenticate` exactly as Woven rendered it (credentials, `ReturnUrl`, anti-forgery token and any other fields), setting only `CompanyID` and `CompanyName`. It does not use `/Account/_Change_EmployeeCompany`. After that it handles the Add Profile Photo prompt with "Ask me later". It continues only when the page is `/`, the title is Dashboard and `a.dropdown-toggle` shows JB & Associates. Failures: `woven_company_not_listed` (JB & Associates is not offered), `woven_account_chooser_changed` (the entry or form no longer has the verified structure; nothing is submitted), `woven_dashboard_not_reached`, and `woven_company_not_verified`. Any other chooser shape still stops with `woven_company_selection_unverified`. No field value is logged or included in a message.
   - **Add Profile Photo** (verified live, implemented). After sign-in, or after choosing the account, Woven may show this page at `/Login/Authenticate`. The connector recognises it and does exactly what "Ask me later" does: it submits `#add-profile-image-form` with the values the page rendered and `SkipAddEmployeeProfileImage=true`. It never uses "Don't ask me again", and never logs a field value. It then continues only if the account dropdown shows JB & Associates.
2. **File Library download:** verified by browser evidence (30 September 2026) and implemented (§2).
3. **Procedure attachment download:** verified and implemented (§2).
4. **Procedure step text:** the markup was verified in the RENDERED page (30 September 2026) and is implemented. Whether the page as served over HTTP carries it is shown by the next scan: `byType.procedure.shape.stepStructureMissing` in the run report counts the procedure pages without it (those keep their text blocked, never guessed). If that count is not 0, what is needed is the page's raw HTML (View Page Source, not the Elements panel) and, if the steps are not in it, the Fetch/XHR request that loads them, with its response.
5. **Course items — the one remaining request.** In a signed-in JB & Associates session, open a shared course that HAS items, Network (Preserve log) → Fetch/XHR, and capture the `GET /Course/_Course_Items?pCourseID=<id>` response with at least one populated `.entity-row[data-pk]`, together with: the course's list row (`_Course_List_ForDataTable`, its `EntityID`), so the `pCourseID` value can be tied to it; and for one item, the request its Open/Download action sends. Redact cookies, tokens and any `sig=` value. Until then Course content stays blocked; MasterCourseID, enrollment id, objective/material id and management item id are not treated as the same thing.

**Anti-forgery on list POSTs** was not settled by the browser pass. It is left to the first live check: if Woven requires a header, list reads fail closed with `woven_antiforgery_rejected`, and the header name then goes in `ANTIFORGERY_HEADER` in `contract.ts`.
