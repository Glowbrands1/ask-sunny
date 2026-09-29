# Woven Knowledge Sync — QA plan

**What is being tested:** the automatic Woven → Ask Sunny knowledge sync
(`docs/woven-knowledge-sync.md`): it reads Woven Team content, compares it
with the last successful sync, and adds, updates or retires Ask Sunny
knowledge documents. It checks Woven every 30 days without anyone having to
do anything.

**Status:** built and covered by automated tests. **Not deployed.** The
migration is not applied, no credentials are set, and the schedule is not in
`vercel.json`. Part A can run today. Parts B to D need the go-live steps in
`docs/woven-knowledge-sync.md` §9, each approved separately.

**Where to record results:** tick each box and add the date and initials in
the sign-off table at the end. If a step fails, note what you saw, the time,
and the run's error code from **Advanced → Recent runs**. Never paste a
password, a cookie, or a download link into a note.

---

## Part A — automated checks (no Woven account needed)

Run these from a checkout of the branch.

| # | Command | Expected | Result |
|---|---|---|---|
| A1 | `npm test` | Every test file passes. The sync's own suites: `src/lib/knowledge-sync/woven/*.test.ts` and `src/features/admin/woven-knowledge/*.test.tsx` | ☐ |
| A2 | `npx tsc --noEmit` | No errors | ☐ |
| A3 | `npm run lint` | No errors | ☐ |
| A4 | `npm install --no-save @electric-sql/pglite && npm run verify:woven-knowledge-migration` | `All checks passed.` (41 checks on real Postgres) | ☐ |
| A5 | `npm run build` | Build succeeds | ☐ |

### What the automated tests cover

Each scenario from the build brief, and where it is proved. **Unit** means
Vitest against a fake Woven Team built from the handoff's redacted response
shapes, with an in-memory manifest and knowledge base. **PG** means the
PGlite migration check.

| Scenario | Covered by | Live check still needed |
|---|---|---|
| Initial discovery | Unit: `initial discovery ingests only published, company-wide, downloadable content` | B3–B5 |
| New file | Unit: `new file: a policy attachment added in Woven…` | Optional (C1) |
| Updated version | Unit: `updated version: a new handbook version replaces the same Ask Sunny document` | Optional (C2) |
| Changed file contents | Unit: `changed file contents under the same name are re-indexed` | — |
| Filename-only change | Unit: `filename-only change: same bytes, so metadata is updated…` | — |
| Permissions change | Unit: `permission change: an item narrowed to some teams leaves Ask Sunny…` | Optional (C3) |
| Unpublished document | Unit: `unpublished: a document switched to draft is retired, not deleted` | Optional (C4) |
| Removed document | Unit: `removed: a document gone from a complete listing is retired` | — |
| Duplicate prevention | Unit: `retry is idempotent…`, `re-publishing a removed document restores the same Ask Sunny document`. PG: one row per item, one owner per document | B6 |
| Failed download | Unit: `one failed download does not stop the rest…` | — |
| Temporary URL expiry | Unit: `policy attachment: … an expired link is replaced once`, `two expired links in a row…` | — |
| Session expiry | Unit: `re-authenticates once when the session expires mid-listing`, `an expired session during a download signs in again` | — |
| Incorrect login response | Unit: `reports a refused sign-in as login_failed`, `refuses to read anything when the landing page is not JB & Associates` | D1 |
| Woven markup or schema change | Unit: `a changed response shape (no list)…`, `a policy page that drops its table…`, `rows that mostly lack an id…`, `a login page without the documented form…` | — |
| One adapter failing while others succeed | Unit: `a failed listing leaves that type untouched while the others sync` | — |
| Retry | Unit: `…retried by the next continue run`, `stops retrying automatically after repeated failures` | — |
| Dry run | Unit: `dry run: counts everything, writes nothing…` | B3 |
| Scheduled run | Unit: `the daily tick does a full sync only when 30 days have passed` | B9 |
| Manual Sync Now | Unit: `manual Sync Now runs the same engine as the schedule`; DOM: `Sync Now calls the one sync engine` | B6 |
| Empty list treated as suspicious | Unit: `an EMPTY policy list is not believed: nothing is removed` | — |
| Mass removal held for confirmation | Unit: `holds a mass removal until an administrator confirms it` | — |
| `retired` persisted and enforced | PG: persisted, never indexed, unreadable by `authenticated` (documents and chunks), readable again once re-published | C4 |
| Policy body, status, version, attachments (verified structure) | Unit: `Policies: verified table headers, the Public/Targeted audience, body…`, `…merged, not doubled`, `…blocks the body only; attachments still sync` | B6 |
| Targeted policy never read as Public | Unit: `a Targeted policy is held for review even though its display text says All Teams` | B4–B5 |
| Procedure steps; step → attachment → file | Unit: `Procedures: steps from the verified structure…`, `…a page without the verified step structure keeps its text blocked` | B5–B6 |
| Knowledge Element content; unsupported types blocked; external links not fetched | Unit: `Knowledge Elements: content pages read from the verified structure…`, `…an unsupported content type keeps the element blocked` | B5–B6 |
| Active company from the account dropdown | Unit: `confirms the company from the account dropdown (a.dropdown-toggle)…`, `refuses to read anything when the landing page is not JB & Associates` | B2 |
| Nothing secret stored | Unit: `no signed URL, cookie, token or password reaches the manifest, runs or audit log`. PG: locator refuses URLs and SAS signatures | B10 |
| Storage links never get the Woven cookie | Unit: `handbook: … downloads it WITHOUT the Woven cookie` | — |

---

## Part B — live QA on a Preview deployment

### Before you start

- [ ] Migration `20260929001000_woven_knowledge_sync.sql` applied (approved; note that it also changes the Production database, because Preview and Production share one Supabase project).
- [ ] Branch-scoped **Preview** variables, marked Sensitive: `WOVEN_KNOWLEDGE_SYNC_ENABLED=true`, `WOVEN_TEAM_USERNAME`, `WOVEN_TEAM_PASSWORD`, for the dedicated **integration account**, not a person's own login.
- [ ] Preview redeployed after the variables were added.
- [ ] Signed in to the Preview as an administrator (someone with **Manage integrations**).
- [ ] `WOVEN_TEAM_COMPANY_ID` is set to JB & Associates' Woven company id (Preview, Sensitive). `WOVEN_TEAM_ANTIFORGERY_HEADER` stays **unset** unless B2a shows it is needed.
- [ ] Company selection is **source-observed**, not wire-verified (main doc §6a). B2a below is the check that proves or disproves it.

Open **Admin → Integrations → Woven Knowledge Sync**.

| # | Step | Expected | Result |
|---|---|---|---|
| B1 | Look at the page before doing anything | Headline **Connected**, and Company **JB & Associates**. "First-time setup" is shown with step 2 current. **Sync Now** is disabled. **Advanced** is closed. | ☐ |
| B2 | Click **Test Connection** | "Connected to JB & Associates. Woven answered normally." Nothing appears in the Knowledge Base. | ☐ |
| B2a | Company selection, live. In Woven, switch the integration account to a company other than JB & Associates (or leave it where sign-in shows **Select Company**), then click **Test Connection** again | Passes: "Connected to JB & Associates". In Woven, the account is on JB & Associates afterwards. If it fails, note the code. `woven_antiforgery_rejected`: capture the switch POST's request headers, set `WOVEN_TEAM_ANTIFORGERY_HEADER` to the header name, redeploy, and repeat. `woven_company_selection_failed`, `woven_company_not_verified` or `woven_session_expired`: capture a HAR of the login-time Select Company step and stop; the selector needs the real request. In every failing case, nothing appears in the Knowledge Base | ☐ |
| B3 | Click **Run Initial Scan** | Finishes in under ~2 minutes. Step 3 shows a table with a row per content type: Policies, Handbooks, Procedures, File Library, Knowledge Elements, Courses. The Knowledge Base screen is unchanged. | ☐ |
| B4 | Check B3's numbers against Woven | Handbooks "Found" matches the Woven handbook list. File Library "Found" is about 647. Policies "Found" is about 22. Drafts are counted under "Drafts / unpublished", not "Will sync". File Library PDFs, procedure attachment files and Courses appear under "Not yet supported" (expected until §10 is resolved). Policies with a Targeted audience, Procedures and Knowledge Elements appear under "Audience choice". | ☐ |
| B5 | If "Needs attention" lists audiences, decide each one: **Share with everyone** or **Keep out of Ask Sunny** | The choice saves and moves under "Audience choices already made". Re-open the page: the choice is still there. | ☐ |
| B6 | Click **Start Initial Sync** | Finishes. "Documents in sync" equals B3's "Will sync" total plus anything shared in B5. The Knowledge Base screen shows the new documents, tagged `woven`. Click **Sync Now** straight away: New 0, Updated 0. No new documents and no duplicates. | ☐ |
| B7 | Ask Sunny a question answered by a synced handbook or policy attachment | The answer cites that document. The citation opens it. | ☐ |
| B8 | Click **Enable Automatic Sync** | Setup disappears. "Next automatic sync" is 30 days after the last check. The headline reads **Up to date**, unless something needs attention. | ☐ |
| B9 | Scheduled tick. Only once the schedule is approved and deployed; otherwise call `GET /api/knowledge-sync/woven/cron` with `Authorization: Bearer $CRON_SECRET` | Before 30 days: `{"status":"skipped","reason":"not_due"}`. Nothing reaches Woven. | ☐ |
| B10 | Security spot-check in the Supabase SQL editor (queries below) | Every query returns **0**. | ☐ |
| B11 | Sign in as a District Manager or Salon Director and open `/admin/integrations/woven-knowledge` | Access refused, the same as other integration screens. | ☐ |
| B12 | Open the screen on a phone-width window | No horizontal scrolling of the page (tables scroll inside their box). Every button can be reached. | ☐ |

B10 queries:

```sql
-- signed links, SAS signatures or storage hosts anywhere in the manifest
select count(*) from knowledge_sync_items
 where coalesce(locator::text,'') ~* '(https?:|sig=|blob\.core)';

-- ...or in run reports
select count(*) from knowledge_sync_runs
 where coalesce(report::text,'') ~* '(sig=|blob\.core|RequestVerificationToken|WovenSession)';

-- two manifest items owning one Ask Sunny document (duplicates)
select count(*) from (
  select knowledge_document_id from knowledge_sync_items
   where knowledge_document_id is not null
   group by 1 having count(*) > 1) d;

-- Woven documents with no manifest owner (orphans)
select count(*) from knowledge_documents d
 where d.source = 'woven'
   and not exists (select 1 from knowledge_sync_items i where i.knowledge_document_id = d.id);
```

---

## Part C — change scenarios in Woven (optional)

Only run these if someone can safely edit a **test item** in Woven, one that
nobody relies on. Every one of them changes real Woven content. If nobody can,
skip Part C: the automated tests cover every scenario.

| # | Change in Woven, then click Sync Now | Expected | Result |
|---|---|---|---|
| C1 | Add a PDF attachment to a test policy with a **Public** audience | "New last sync" 1. The attachment is searchable in Ask Sunny. | ☐ |
| C2 | Publish a new version of a test handbook | "Updated last sync" 1. It is the **same** Knowledge Base document (same link) with a higher version number. | ☐ |
| C3 | Narrow the test item's audience to one team | It leaves Ask Sunny search, and that audience appears under "Needs attention". | ☐ |
| C4 | Unpublish or draft the test item | It leaves Ask Sunny search and the Knowledge Base list. It is not deleted; re-publishing brings back the same document. | ☐ |

---

## Part D — failure handling (live)

| # | Do | Expected | Result |
|---|---|---|---|
| D1 | Set a wrong `WOVEN_TEAM_PASSWORD` on the Preview, redeploy, then click **Sync Now** | Headline **Needs attention**, with "Woven did not accept the integration account's sign-in…". Ask Sunny's documents are unchanged. Restore the password afterwards. | ☐ |
| D2 | Set `WOVEN_KNOWLEDGE_SYNC_ENABLED=false`, redeploy, then click **Test Connection** | Refused as switched off. Nothing reaches Woven. | ☐ |
| D3 | Click **Sync Now** twice quickly | The second shows "A sync is already running." | ☐ |

---

## Known limits during QA (not failures)

- **Blocked until browser evidence arrives:** File Library files, Procedure attachment files, and Course items. They are tracked and compared every month, and are listed under Advanced → "Tracked, but not yet brought into Ask Sunny". Policy text, procedure steps and Knowledge Element pages do sync.
- **Audience choices on the first scan:** Targeted policies are listed by their Woven display summary, for example "All Teams 8 Positions". Procedures and Knowledge Elements show under "No audience stated", because Woven's lists carry no audience for them. Each needs one choice.
- **Text documents:** policy text, procedure steps and Knowledge Element pages become plain-text knowledge documents. They are searchable and citable for everyone. As with every plain-text source in Ask Sunny, only an administrator can download the original file.
- **Audience:** Ask Sunny has one knowledge audience, which is everyone who signs in. Anything Woven limits to some teams is held until an administrator chooses, and "Share with everyone" means everyone.
- **Update window:** while an updated document is re-indexed, it is briefly not searchable. This is the existing pipeline's behaviour for every document.

## Sign-off

| Part | Tester | Date | Result / notes |
|---|---|---|---|
| A — automated | | | |
| B — live Preview | | | |
| C — change scenarios (optional) | | | |
| D — failure handling | | | |
| Approved for production | | | |
