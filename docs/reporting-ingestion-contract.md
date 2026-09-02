# The production report-ingestion contract

**Status: specification only. Nothing here is built, and nothing here should be
built before it is approved.** This document exists so that today's data model
and dashboard do not quietly acquire an assumption that makes automated recurring
intake harder later. Where an assumption already exists, it is named in
[§7](#7-what-would-block-automation-today).

The dashboard is intended to be permanent, with reports arriving continuously:

```
report arrives → source recognised → workbook validated → parser selected
              → period created or reused → normalized facts appended
              → the same dashboard, one more period in the Period control
```

---

## 1. How the route is authenticated

`POST /api/admin/reporting/ingest` requires a **machine credential** on every
call, in every environment: `REPORTING_INGEST_SECRET`, verified in
`src/lib/reporting/ingest-credential.ts`. There is no unauthenticated path, and
a deployment with no credential configured refuses everybody rather than
falling open.

This mechanism is **production-capable on its own**. It carries the properties
an external identity provider would otherwise have supplied:

| Property | How |
|---|---|
| Rotation without downtime | The variable holds a *list* of `id:secret` entries, so a new credential is added, the caller is moved over, then the old one is removed — three deploys, no broken window. Single-valued secrets force a simultaneous swap on both sides, which is why they never get rotated. |
| Revocation | Remove the entry, redeploy. Per-`id`, so one pipeline is revoked without disturbing the others. |
| Constant-time verification | Candidates are compared as fixed-length SHA-256 digests with a branchless XOR accumulator. Neither the secret's length nor the position of the first wrong byte is observable. `===` on the raw strings is a prefix oracle. |
| Rate limiting | Ten **failures** per ten minutes per caller; a success clears the record, so a retrying pipeline never throttles itself and pipelines sharing a NAT do not spend each other's budget. |
| No client exposure | `import "server-only"` makes a client import a build failure, and the variable has no `NEXT_PUBLIC_` prefix, so it cannot be inlined into a browser bundle. |
| Minimum strength | A configured entry shorter than 24 characters is *dropped*, and the operator is told which — a deployment fails closed rather than running on a guessable secret. |
| Auditability without disclosure | A success returns the credential's `id`, which is what goes in a log line and in the response. The secret is never returned, logged or echoed. |
| Generic refusal | A missing header, a wrong secret and a revoked credential are indistinguishable to the caller. |

The credential arrives as `Authorization: Bearer <secret>`, or in
`X-Reporting-Ingest-Secret` for automation platforms where a custom header is
easier to set. **Never in a query string** — a secret in a URL is written to
every access log, proxy log and history entry between the caller and here, and
survives rotation in all of them.

**No external identity provider is required, here or later.** In particular
nothing on this path assumes Microsoft Entra client credentials. `authorizeRequest`
is deliberately not called: it answers *"which person is this?"*, and a
scheduled pipeline is not a person and holds no profile. A machine credential is
the right primitive for machine-to-machine delivery whatever employee login
turns out to be — so this route neither waits on that decision nor changes when
it is made.

### The digest allowlist is now defence in depth

`src/lib/reporting/approved-sources.ts` still narrows *which* artifact an
already-authorized caller may file, and it is enforced only while it is
populated. The two gates fail differently, which is why both exist: a leaked
credential cannot file an arbitrary workbook while the list is populated, and a
leaked workbook cannot be filed at all without the credential.

A digest can only be committed for a file that already exists, so the list
cannot be the mechanism for recurring intake — next month's workbook is not
knowable today. For recurring ingestion the list is **emptied**;
`allowlistEnforced()` then returns false and the credential is the whole gate,
which is what it was built to be. That is a configuration decision, not a code
change.

---

## 1b. The automated intake endpoint

`POST /api/reporting/intake` — multipart/form-data, one workbook, every
compatible parser, once.

The sender does **not** name a parser. It forwards the attachment and what it
knows about the message; intake reads the workbook once, asks every registered
parser whether it recognises anything in it, and runs the ones that do. Adding
a fourth sheet later means registering a parser — the flow is not touched.

Why a separate route from `/api/admin/reporting/ingest`: that one exists for a
person doing a controlled ingestion of ONE named sheet, and its `parserKey` is
a decision somebody makes. This one exists for a machine with no view to
choose. Same credential, same pipeline, same idempotency; a different question,
so a different endpoint rather than a mode flag on the old one.

### Fields

| Field | Required | Stored as | Notes |
|---|---|---|---|
| `file` | yes | Storage object, private bucket | The `.xlsx` bytes. Uploaded once per delivery, and skipped entirely when the content-addressed object already exists. |
| `originalFilename` | recommended | `report_files.original_filename` | The attachment name as the sender wrote it. Preferred over the multipart part's filename, which for a flow-driven upload is whatever the transport called it. |
| `messageId` | recommended | `report_files.external_message_id` | Outlook message id. Lineage back to the mail, and the second idempotency layer. |
| `senderEmail` | recommended | `report_files.sender_email` | Lineage only — **never** used for authorization. A From address is trivially forged. |
| `receivedAt` | recommended | `report_files.received_at` | ISO 8601. When the MESSAGE arrived, not when we processed it. A value that is not a valid instant is refused rather than silently becoming `now()`. |
| `archiveUrl` | recommended | `report_files.external_archive_url` | Where the operational copy lives. Recorded; never fetched. |

All five metadata fields are read **only when the file row is created**. A
re-delivery matches the existing row by digest and must not rewrite the first
delivery's sender or arrival time.

### Responses

| Status | Meaning |
|---|---|
| `200` | Every attempted parser landed, or had already landed. |
| `207` | Some parsers landed and at least one failed. A partial load is not a success and not a failure — the per-parser outcomes say which is which. |
| `401` | Missing, wrong or revoked credential. One identical answer for all three. |
| `422` | `unreadable_workbook`, `unsupported_workbook` or `template_drift`. Nothing uploaded, nothing written. |
| `429` | Too many failed credential attempts from this caller. |
| `503` | No credential configured in this runtime, or Supabase not configured. |

The body carries counts, identifiers, periods, sheet names and warning codes.
**No financial values, no salon numbers, no salon names, no manager names.** It
also omits the storage bucket and object key: an automated caller has no use for
them and printing them is a step towards fetching a private object.

### Failure containment

Each parser's write is its own transaction. A parser that throws, fails
validation or rolls back leaves the others' rows exactly as they were — there
is no path that supersedes or deletes anything on behalf of a parser other than
the one being run, and a failed attempt never reaches supersession at all.
Structural validation runs across the whole file **before** anything is
uploaded, so a delivery in which every sheet fails leaves no object behind.

Idempotency is per parser. Re-delivering the same bytes returns
`already_ingested` for each parser that already succeeded on them, writing
nothing. A parser that failed last time is retried, which is what a retry
should do.

---

## 2. Intake contract

An automated intake — Power Automate reading the Comp Report mailbox is the
expected first client — submits one report with the following. The **Stored as**
column shows what already exists in the schema; nothing marked *(present)* needs
a migration.

| Field | Required | Stored as | Notes |
|---|---|---|---|
| Workbook bytes | yes | Storage object, private bucket | `reporting-sources/<family>/<grain>-<period end>/<digest prefix>/<name>` |
| Original attachment filename | yes | `report_files.original_filename` *(present)* | The name as the sender wrote it. See §7. |
| Source email / message id | yes | `report_files.external_message_id` *(present)* | Unique index already enforces one file per source message. |
| Received timestamp | yes | `report_files.received_at` *(present)* | When the message arrived, **not** when we processed it. See §7. |
| SharePoint archive location | yes | `report_files.external_archive_url` *(present)* | Where the operational copy lives, so provenance survives independently of our Storage. |
| Sender address | recommended | *no column yet* | For the source & quality panel and for spotting a report arriving from an unexpected mailbox. |
| Declared report family | optional | derived | An advisory hint only; detection decides. See §3. |

The response is a decision, not a status page: `ingested`, `already_ingested`,
or a refusal carrying a machine-readable code and a human-readable reason.

---

## 3. Recognition, validation, parser selection

Three separate questions, deliberately answered in this order, and any of them
may refuse.

**Which report is this?** Detection is structural, never by filename. Each parser
declares markers it looks for in the workbook, and `detectReport` asks each
registered parser in turn. A declared family from the caller may narrow the
search; it may never override the answer. A filename is a label somebody typed.

**Is this workbook the shape we know?** The parser resolves its columns by header
text and fails closed on drift — a duplicate mapping inside the live band, a
missing core measure, a duplicate salon number, an unreadable period marker.
Every one of these is an exception, not a warning, because a report that parses
into 22 of 24 measures produces a dashboard that looks complete and is not.

**Which parser reads it?** Named explicitly by key, validated against the
registry. An unknown key is a refusal, never a fall back to a different sheet —
one workbook holds three sheets that parse (`comp_sales_mtd_vs_2024`,
`comp_sales_mtd_rolling`, `comp_sales_ytd`), and filing one sheet's figures under
another's name is the failure mode this rule exists for. Automated intake must
therefore submit the same file once per sheet, naming the parser each time.

---

## 4. Idempotency

Four layers, all already implemented, all of which the automated path inherits
unchanged. The same report submitted twice must be a no-op, because a retrying
scheduler is normal and a duplicated month is not recoverable from a dashboard.

1. **Content digest.** `report_files.file_sha256` is unique. The same bytes are
   the same file however many times they arrive.
2. **Upstream message id.** `(source_id, external_message_id)` is unique where
   the id is present. The same email cannot be filed twice even if the
   attachment were re-saved and its bytes changed.
3. **One success per parser.** A partial unique index on
   `(file_id, parser_key, parser_version) where status = 'succeeded'`. Re-submitting
   returns `already_ingested` and writes nothing.
4. **One live fact per business key.** A partial unique index on
   `(salon_id, period_id, metric_id, coalesce(basis_year, -1)) where superseded_by_ingestion_id is null`.
   The database refuses two live values for the same question.

A **corrected** report — same period, new bytes — is a different file, so it
ingests and supersedes rather than being rejected. Supersession is scoped to the
period, the salons and the source sheets that report actually covered; nothing
outside that scope is touched. That scoping is what lets two sheets of one
workbook coexist as separate ingestions, and what stops a July backfill from
disturbing August.

---

## 5. Period creation and reuse

`complete_comp_sales_ingestion` inserts the period with
`on conflict (grain, period_end) do nothing` and then reads it back. A period is
therefore created on first sight and reused thereafter, and a new report can only
ever **append**:

- Facts are keyed by period. A new period's rows cannot collide with an existing
  period's.
- Supersession is filtered by `period_id = <this report's period>`, so no
  ingestion can supersede another period's facts.
- The dashboard reads the newest **period**, not the most recently ingested
  report, so a backfill lands in the Period control rather than becoming "the
  latest report".

Month-to-date and year-to-date are different grains and therefore different
periods. They are never mixed.

**A DATE DOES NOT IDENTIFY A PERIOD.** The key is `(grain, period_end)`, so two
periods can end on the same day — an MTD report run on 31 July and the
`YTD 07 2026` sheet both end on 2026-07-31. Anything that selects a period must
carry the grain with the date. The dashboard's period token does
(`ytd:2026-07-31`); a bare date is accepted from older links and qualified
during canonicalization.

---

## 6. Failing closed

Any of these refuses the whole submission and writes nothing:

| Condition | Response |
|---|---|
| No parser recognises the workbook | `unsupported_workbook` |
| A parser recognises it but the template has drifted | `template_drift`, naming the marker |
| The period marker is missing or unreadable | `period_unreadable` — never "assume this month" |
| A duplicate salon number in the data band | `duplicate_salon_number` |
| A metric code outside the reviewed vocabulary | `report_invalid`, with the problem list |
| The named parser key is not registered | `unknown_parser_key` |

A refusal is a flag for review, not a retry. The workbook is preserved with the
refusal recorded against it, so a human sees the file and the reason together.
**Nothing guesses.** A report whose structure changed unexpectedly is a report
whose meaning may have changed, and a dashboard that quietly absorbs it is worse
than one that stops.

---

## 7. What would block automation today

Of the four originally listed, three are resolved — authentication, the
attachment filename and the arrival timestamp. **Only the skipped-row count
remains.** None is load-bearing for the dashboard.

**1. ~~The approved-digest allowlist is the only authentication.~~** *Resolved.*
`REPORTING_INGEST_SECRET` is now required on every call and the route no longer
refuses on environment. Emptying the allowlist for recurring intake is a
configuration decision — see §1.

**2. ~~`original_filename` does not survive the current path.~~** *Resolved.*
The intake endpoint takes `originalFilename` explicitly and prefers it over the
multipart part's filename.

**3. ~~`received_at` defaults to `now()`.~~** *Resolved.*
`begin_report_ingestion` now reads `received_at` from the `p_file` payload and
falls back to `now()` only when the caller does not know it. Applied in
`20260902001000_reporting_intake_lineage.sql`.

**4. Skipped-row counts are still not persisted.** The parser counts them and the
ingestion row has nowhere to put them, so the source & quality panel must say
*Not recorded* rather than `0` — those are different facts. Adding the column is
a migration and a parser-version bump, and it should happen before automated
intake, because with a human submitting each report somebody sees the response;
with a scheduler submitting it, the stored row is the only record.

Two further notes that are not blockers but are worth stating:

- **~~Sender address has no column.~~** *Resolved.* `report_files.sender_email`,
  added in the same migration. Lineage only — never used for authorization.
- **RLS still cannot be narrowed by district.** The district and region columns
  hold manager *names*, which change; narrowing a policy to a district needs
  stable district and region codes from the source. Reads run server-side under
  the secret key until then, which is safe but is not the destination.

---

## 8. What this document is not

It is not approval to build Power Automate integration, a public upload endpoint,
or an unauthenticated intake route. It records the contract so that the schema,
the parsers and the dashboard stay compatible with it — and so that the
remaining items in §7 are decisions somebody makes on purpose rather than
discoveries made under time pressure on the morning the first automated report
fails.

It also does not assume any particular identity provider. See
`docs/architecture-constraints.md`: report ingestion authenticates with its own
machine credential, employee login is provider-agnostic with Supabase Auth as
the default, and Microsoft Entra is an optional adapter that may never exist.
