# Salon Performance — `vs 2025`, and why the first fix did not show

**Date:** 14 September 2026
**Source:** `Comp Report 2026 09 08 - Bowen Curt.xlsx`, supplied by the business.
Not committed: it carries salon-level financials and manager names.

---

## 1. Root cause — a selection fix for a data problem

Maddy's review says, literally: *"The comparison is set to vs. 2024, not 2025."*

An earlier pass read that as a defaulting bug and fixed a real one. `filters.ts`
held `PREFERRED_BASELINE_YEAR = 2024`, written when 2024 *was* the prior year;
`windows.ts` replaced it with `preferredBaselineYear(currentYear)`, which returns
`currentYear - 1` and moves with the data. That work was correct and is still in
place.

**The screen did not change, and nothing reported that.** Windows are
*discovered* from stored facts — `reportWindows` offers a year because facts
carry it — and no month-to-date sheet produced a 2025 basis year:

| Sheet | 2025 comparison? |
|---|---|
| `CompReport(MTD) vs 2024` | **No.** Every comparison column on it is `TY vs 2024 % Change`. There is no 2025 column anywhere on the sheet. |
| `CompReport(MTD)` | **Yes** — `TY vs. 2025 % Change`. But the rolling parser was scoped to exactly 24 trailing-window codes, and this block sat outside that scope. |

So `defaultWindow` asked for 2025, did not find it, and fell through to its
documented fallback — *the newest uncaveated year* — which was 2024. Correct
behaviour producing the exact screen the review complained about.

**The failure mode worth naming:** the fix was verified against the selection
logic (which was right) and not against the option list (which was short one
entry). A test asserting "the default is derived, not hardcoded" passes whether
or not 2025 exists.

---

## 2. The source field used

Read by **header text**, never by column letter. From `CompReport(MTD)`, salon
band header row 34:

| Column | Header | Becomes |
|---|---|---|
| AF | `Est. 2026 Total Revenue` | `total_revenue`, basis 2026 |
| AG | `2025 Total Revenue` | `total_revenue`, basis 2025 |
| **AH** | **`TY vs. 2025 % Change`** | **`total_revenue_pct_change`, basis 2025** |

Verified across all fifteen salon rows: `AH = round(AF / AG - 1, 4)` on **15/15**.
The source rounds to four places and **the stored value is the source's own** —
nothing is recomputed. A regression test asserts that by giving the fixture a
rounded change that a recomputing parser could not reproduce.

`vs 2024` is untouched and reads `TY vs 2024 % Change` from
`CompReport(MTD) vs 2024` (column AC), at full precision. The two are different
fields: across the fifteen salons they disagree on **15/15** rows — `-0.88%` vs
`+4.66%` for KS Lawrence, `-11.46%` vs `+29.83%` for NE Omaha Pacific.

### What is deliberately not mapped

**The 2024 block on `CompReport(MTD)`** — `AI 2026 Revenue (if >24 mos. old)` /
`AJ 2024 Total Revenue` / `AK TY vs. 2024 % Change`. It reconciles
(`AK = round(AI / AJ - 1, 4)` on 15/15) and is still excluded, for two measured
reasons:

- **Its current side is a different population.** AI is Total Revenue *for salons
  older than 24 months*. On this delivery AI equals AF on all fifteen rows
  because every salon is old enough — so the difference is invisible today and
  would appear without warning the first month a new salon opens.
- **`vs 2024` already has a better source.** The dedicated sheet carries the same
  comparison at full precision; this one rounds to four places.

The exclusion needs no special case: AI does not match the current-side pattern,
so the triple never completes, and a warning says so.

**Every other measure's 2025 comparison.** The sheet also carries
`2026 UV Tans` / `2025 UV Tans` / `UV Tans % Change` and eight more like it.
Their change headers name no year, so the year-anchored rule does not reach them.
Total Revenue is the measure the dashboard opens on and the one the review named;
the rest stay out of scope with the sheet's other 300-odd columns.

### Why the change column is the anchor

Resolution starts at `TY vs. <year> % Change` and works leftwards, rather than
collecting every `<year> Total Revenue` header. The sheet repeats an abandoned
template block at GI..GN — `Est. 2016 Total Revenue`, `2015 Total Revenue`,
`2011 Total Revenue` — which a measure-first rule would file as three real basis
years and put in the window dropdown. Those columns write `TY vs. LY % Change`
and `TY vs. L2Yrs % Change`, naming no year, so anchoring excludes the block by
construction. A test asserts the debris (which holds `-9,999` in every cell)
never reaches a fact.

---

## 3. One schema consequence

The two month-to-date sheets now both report Total Revenue for the current year,
for the same salon and period, from their own columns. The live fact key forbade
that:

```
(salon_id, period_id, metric_id, coalesce(basis_year, -1))
```

That key predates `20260831002000_reporting_supersession_scope.sql`, which made
supersession **scoped to the sheets a report read** — so since that migration,
supersession has treated sheets as independent slices while this index treated
them as one namespace. They only avoided contradicting each other because the
sheets' mapped columns happened to be disjoint, which the ingest suite asserted
as if it were a design.

`20260914001000_comp_sales_live_key_per_sheet.sql` adds `source_sheet` to the
key. **At most one live fact per salon, period, metric, baseline year and sheet.**

Every read was already sheet-scoped and needed no change — verified rather than
assumed:

| Surface | How it scopes |
|---|---|
| Dashboard | passes the selected window's sheet to `getFactRows` |
| Salon drill-down | filters to `activeSheet` before indexing |
| Window comparison section | filters to each window's own sheet per row |
| Metric catalogue | the view already groups by `source_sheet` |

---

## 4. Result

**Window options** — discovered, in reading order:

1. Current MTD
2. **vs 2025** ← default
3. vs 2024
4. vs 2019 *(comparison population unconfirmed; never a default)*
5. Last 3 Months
6. Last 6 Months
7. Last 9 Months
8. Last 12 Months

**Default:** `vs 2025`, reached through `preferredBaselineYear(2026) = 2025` with
no year named anywhere. In 2027 the same code prefers 2026.

**On the real 8 September delivery**, through the shipped parser: 360
trailing-window facts plus **45** comparison facts —
`total_revenue|2026|AF`, `total_revenue|2025|AG`,
`total_revenue_pct_change|2025|AH` — and **zero** facts at basis year 2024 from
that sheet.

---

## 5. Movers axis

`moversDomain` was already conditional on the data's signs, and that is
unchanged. What was missing was proof that the axis follows **the selected
window**: the same fifteen salons are all up against 2024 and mixed against 2025,
so a chart reading a fixed comparison would be wrong on one of them however well
the domain function behaved.

`movers-window.test.ts` runs the whole chain — window → metric codes → facts →
rows → movers → domain — and asserts:

- `vs 2024`, where every salon is up: domain starts at **0**. No negative half.
- `vs 2025`, genuinely mixed: symmetric, both halves, zero in the middle.
- `Last 3 Months`, mixed: both halves.
- The three windows produce **three different domains**, which is what says the
  axis is a function of the selection.

## 6. Largest decreases

Unchanged and still one section: each list renders only when it holds rows, the
grid collapses to one column when only one side does, and the whole block
disappears when neither does. `movers-section.test.ts` now pins that, including
that no `None` placeholder returns and that no second `SectionHeader` splits the
lists away from the chart.


---

## 7. Migration safety audit — 14 September 2026

Run against the live database read-only, plus one self-rolling-back rehearsal.

**The change is index-only.** `drop index` + `create unique index` + `comment`.
No `alter table`, no constraint, no backfill, no `insert`/`update`/`delete`,
no data read. Asserted by a test over the migration's own SQL.

**Live data as it stands:** 7,662 fact rows, 6,242 live, across 3 sheets.
`new_key_violations = 0`, `old_key_violations = 0`,
`groups_spanning_two_sheets = 0`. The new key is strictly weaker than the old —
adding a column can only permit more rows — so a dataset satisfying the old key
always satisfies the new one, and the index cannot fail to build on existing
data.

**Why it is necessary, in numbers.** Both month-to-date sheets land in the SAME
`period_id`, and there are six such periods. In each, `CompReport(MTD) vs 2024`
already holds 15 live `total_revenue @ 2026` rows while `CompReport(MTD)` holds
0. Re-ingesting the rolling sheet with its own `Est. 2026 Total Revenue` would
therefore hit **15 unique violations per period, 90 in total**, under the old
key. `CompReport(YTD)` already carries a 2025 basis year and never collided
only because its grain gives it a different period.

**Rehearsal** (a `DO` block that applied the migration, tested both directions,
then raised to roll back):

| Check | Result |
|---|---|
| Index builds over 6,242 live rows | built |
| Same salon/period/metric/year, **different** sheet | **ALLOWED** |
| Same salon/period/metric/year, **same** sheet | **BLOCKED** |
| Index definition afterwards | back to the original four-column form |
| Rows left behind | 0 |

**Locking.** A plain `CREATE UNIQUE INDEX` takes `SHARE`, which blocks writes to
`comp_sales_facts` — not reads — for the duration. At 6,242 live rows that is
milliseconds. Ingestion is a manual admin action, so there is no concurrent
writer to block.

**Every write path.** One: `complete_comp_sales_ingestion`, a plain `INSERT ...
SELECT` with no `ON CONFLICT` on this table. Nothing upserts facts, nothing
names the index, and no application code depends on the old key's shape.

**Every read path is sheet-scoped**, verified rather than assumed: the dashboard
and the Ask Sunny briefing source pass `sourceSheet: activeSheet` to
`getFactRows`; the Overview does the same; the drill-down reads cross-sheet on
purpose and then filters to `sheetFacts` before indexing, with the window
comparison section filtering again per window; and `comp_sales_metric_catalogue`
groups by `source_sheet`.

**One real issue found and fixed.** `reporting-schema.test.ts` asserted the live
key by reading only the migration that CREATED the table, so it kept passing
while describing a key the schema no longer had. It now reads the effective
definition — the last migration that defines the index — and a deliberate
regression (removing `source_sheet` from the migration) was confirmed to fail
it. The stale comment in `contract.test.ts` and the key's description in
`src/lib/reporting/README.md` were corrected with it.

Rollback SQL, and the one precondition it carries, are recorded at the foot of
the migration file.


---

## 8. Release — 14 September 2026

**Merged** to `main` as `b784ee6` (`--no-ff`, two parents), pushed and confirmed
server-side.

### The database Production actually uses

Established from committed configuration, not from the project's name:

- `docs/production-demo-posture.md` records it outright — *"Production reads the
  Ask Sunny **Dev** Supabase project"*, `rbkylaavthsjepsczccv`, "Read by Preview
  **and** Production", with no separate Production project created.
- The account holds **exactly one** Supabase project, and it has **no database
  branches** — so there is no second database for Production to point at.
- That project holds the real dataset: the fifteen JB salons and six month-to-date
  periods through 2026-09-13.

Vercel's environment variables could not be read from this session (the token
sees the team but zero projects) and the production host is unreachable behind
the egress policy, so the binding is proved from the repo and the account rather
than by reading the deployed config.

### Migrations are not automatic

There is no `.github/workflows/`, no `vercel.json`, and no migration script in
`package.json`. `supabase/README.md` documents `supabase db push`; the CLI is not
installed in this session, so the migration was applied through the Supabase
migration API, which records it in the same `supabase_migrations.schema_migrations`
ledger as every other migration — version `20260914173340`, name
`comp_sales_live_key_per_sheet`. No ad-hoc replacement SQL was used.

### Verified after applying

```
CREATE UNIQUE INDEX comp_sales_facts_live_key ON public.comp_sales_facts
  USING btree (salon_id, period_id, metric_id,
               COALESCE(basis_year, '-1'::integer), source_sheet)
  WHERE (superseded_by_ingestion_id IS NULL)
```

- Duplicate violations under the new key: **0**
- `facts_total` 7,662 and `facts_live` 6,242 — **unchanged**, confirming no row
  was written, moved or deleted.

### What is live, and what is not yet

**The window list is derived from stored facts, so it does not change until the
Comp Report is ingested again.** Checked against the newest month-to-date period
(2026-09-13):

| Sheet | Basis years held | Trailing windows |
|---|---|---|
| `CompReport(MTD)` | *(none)* | 3, 6, 9, 12 months |
| `CompReport(MTD) vs 2024` | 2019, 2024, 2026 | — |

So the dropdown still derives **seven** options — Current MTD, vs 2024, vs 2019,
Last 3/6/9/12 Months — and `vs 2025` is **not** among them yet. Nothing is
wrong: the parser that reads `TY vs. 2025 % Change` is merged, and the schema
now permits the facts, but no delivery has been parsed by it.

**No manual step is required.** The Comp Report arrives by email, Resend fires
`email.received`, and `/api/reporting/inbound-email` runs every applicable
parser. The next delivery therefore produces the 2025 facts on its own, and
`vs 2025` appears as the second option and becomes the default through
`preferredBaselineYear(2026)`.

**To confirm after that delivery**, without opening the app:

```sql
select c.source_sheet, c.code, c.available_basis_years
  from public.comp_sales_metric_catalogue c
  join public.report_periods p on p.id = c.period_id
 where p.grain = 'mtd'
   and c.code in ('total_revenue', 'total_revenue_pct_change')
 order by p.period_end desc, c.source_sheet;
```

`CompReport(MTD)` carrying `total_revenue_pct_change` with `{2025}` is the
dropdown entry; the fact's `source_column` will read `AH`, which is
`TY vs. 2025 % Change` and not a relabelled 2024 measure.


---

## 9. Completing the rollout — the re-read, and the defect it exposed

`vs 2025` needs the latest Comp Report read again by the new parser. Tracing
that through the approved workflow found a real defect in the change shipped
above.

### The latest source, identified

| | |
|---|---|
| File | `Comp Report 2026 09 13 - Bowen, Curt.xlsx` |
| Size | 613,750 bytes |
| SHA-256 | begins `510bb1c6f6d4995d` |
| Storage | `reporting-sources/comp_sales/mtd-2026-09-13/510bb1c6f6d4995d/Comp-Report-2026-09-13-Bowen-Curt.xlsx` |
| Arrived | by email, source `comp_report_email`, 2026-09-14 14:42 UTC |
| Parsed by | `comp_sales_mtd_vs_2024` (562 facts) and `comp_sales_mtd_rolling` **v1** (360 facts) |

It is already on file, so nothing needs forwarding. The 8 September workbook is
older than the current period and must not be used.

### The defect: a changed parser kept its version

`begin_report_ingestion` refuses a file already ingested by the same
`(file, parser_key, parser_version)` triple. Version 1 of the rolling parser
produced 24 trailing-window codes and 360 facts; the parser now also reads the
sheet's year comparison and produces 405. Leaving `ROLLING_PARSER_VERSION` at 1
would mean two different parsers sharing one version number — a ledger row
reading "rolling parser v1, 360 facts" that no longer says what produced it —
and would refuse the re-read outright.

**`ROLLING_PARSER_VERSION` is now 2.** That is the mechanism the schema was
built with, not a way around it. Supersession stays scoped to the sheets a
report reads, so the re-read supersedes only `CompReport(MTD)`'s own facts: the
562 the `CompReport(MTD) vs 2024` sheet contributed for the same period are
untouched, and `vs 2024` keeps reading its own full-precision column. The v1
facts are stamped superseded rather than deleted and stay readable to an audit.

### What is left, and who can do it

The ingestion itself could not be run from the session that made this change:
`/api/admin/reporting/ingest` requires `REPORTING_INGEST_SECRET`, which is a
server-side machine credential, and the production host is not reachable from
it. The file bytes are in private Storage and are not retrievable over the
database connection either.

So the remaining step is one authenticated call, by someone holding the ingest
credential, once the deployment carrying parser v2 is live. Verification
afterwards, from data rather than from the screen:

```sql
-- 1. The facts exist, from the right column.
select f.basis_year, f.source_column, count(*)
  from public.comp_sales_facts f
  join public.report_metrics m on m.id = f.metric_id
  join public.report_periods p on p.id = f.period_id
 where f.superseded_by_ingestion_id is null
   and f.source_sheet = 'CompReport(MTD)'
   and p.grain = 'mtd' and p.period_end = '2026-09-13'
   and m.code in ('total_revenue', 'total_revenue_pct_change')
 group by 1, 2 order by 1, 2;
-- expect total_revenue 2026 @ AF, total_revenue 2025 @ AG,
--        total_revenue_pct_change 2025 @ AH  (AH is `TY vs. 2025 % Change`)

-- 2. vs 2024 is untouched on its own sheet.
select count(*) from public.comp_sales_facts f
  join public.report_periods p on p.id = f.period_id
 where f.superseded_by_ingestion_id is null
   and f.source_sheet = 'CompReport(MTD) vs 2024'
   and p.grain = 'mtd' and p.period_end = '2026-09-13';
-- expect 562, unchanged

-- 3. The dropdown's own source of truth.
select c.source_sheet, c.code, c.available_basis_years
  from public.comp_sales_metric_catalogue c
  join public.report_periods p on p.id = c.period_id
 where p.grain = 'mtd' and p.period_end = '2026-09-13'
   and c.code in ('total_revenue', 'total_revenue_pct_change')
 order by c.source_sheet;
-- CompReport(MTD) carrying {2025} is the `vs 2025` entry
```
