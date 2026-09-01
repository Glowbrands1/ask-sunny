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

## 1. Why the current route is not the mechanism

`POST /api/admin/reporting/ingest` accepts a workbook only if its SHA-256 is
already committed in `src/lib/reporting/approved-sources.ts`. That gate is
deliberate and it is doing its job: with no identity provider wired up, an
allowlist of reviewed digests is the only thing standing between an internal
Preview endpoint and an open file-upload API. It is also the reason the route
cannot be the permanent mechanism — **a digest can only be committed for a file
that already exists**, so every future weekly report would need a code change and
a deploy before it could be loaded. That is fine for the handful of reviewed
artifacts this project has ingested so far, and unworkable at one report a week
forever.

The replacement is not a weaker gate. It is a *different* gate: an authenticated
machine identity in place of a per-file allowlist.

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
one workbook holds several sheets a parser could read, and filing one sheet's
figures under another's name is the failure mode this rule exists for.

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
periods. They are never mixed, and the YTD sheet is not ingested at all yet.

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

Four things. None is load-bearing for the dashboard, and all are cheap now and
progressively less cheap later.

**1. The approved-digest allowlist is the only authentication.** Replacing it
needs a service identity — a machine principal with an `ingest_reports`
permission — plus the route moving off the allowlist and out of its
"never in production" guard. This is the whole of the work; the rest of this list
is small.

**2. `original_filename` does not survive the current path.** The route stores
the multipart part's filename, which for a scripted upload is whatever the script
called it, not what the sender attached. The column is right; the caller is not.
An automated intake must pass the attachment name explicitly.

**3. `received_at` defaults to `now()`.** For an emailed report that is the
processing time, not the arrival time, and the two diverge exactly when it
matters — a delayed or replayed message. `begin_report_ingestion` should accept
it in the `p_file` payload alongside the other external fields.

**4. Skipped-row counts are still not persisted.** The parser counts them and the
ingestion row has nowhere to put them, so the source & quality panel must say
*Not recorded* rather than `0` — those are different facts. Adding the column is
a migration and a parser-version bump, and it should happen before automated
intake, because with a human submitting each report somebody sees the response;
with a scheduler submitting it, the stored row is the only record.

Two further notes that are not blockers but are worth stating:

- **Sender address has no column.** Worth adding with the same migration as
  skipped rows.
- **RLS still cannot be narrowed by district.** The district and region columns
  hold manager *names*, which change; narrowing a policy to a district needs
  stable district and region codes from the source. Reads run server-side under
  the secret key until then, which is safe but is not the destination.

---

## 8. What this document is not

It is not approval to build Power Automate integration, a public upload endpoint,
or an unauthenticated intake route. It records the contract so that the schema,
the parsers and the dashboard stay compatible with it — and so that the four
items in §7 are decisions somebody makes on purpose rather than discoveries made
under time pressure on the morning the first automated report fails.
