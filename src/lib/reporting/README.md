# Reporting parsers

Turns a report workbook into a `ParsedReport`. **Nothing here writes to a
database, to Storage, or to the network.** Persistence is a later
`ReportingRepository`; keeping that boundary is what lets the whole parser be
tested from a byte array.

```
bytes -> readWorkbook -> WorkbookView -> ReportParser.detect
                                      -> ReportParser.parse -> ParsedReport
                                      -> (later) validation -> ReportingRepository
```

## Layout

| File | Responsibility |
| --- | --- |
| `workbook.ts` | ExcelJS adapter. Normalises cached formula values, rich text, errors. Parsers never import ExcelJS. |
| `cells.ts` | Coercion. Returns `null` rather than a default, always. |
| `period.ts` | Period detection. No `new Date()`, no timezone inference. |
| `parser.ts` | The `ReportParser` seam and `selectParser`. |
| `types.ts` | `ParsedReport` and friends — database-independent. |
| `comp-sales/metric-map.ts` | Declarative map of the 16 seeded metrics. |
| `comp-sales/dimensions.ts` | The A–T descriptor band. |
| `comp-sales/parser.ts` | `CompSalesReportParser`. |
| `index.ts` | Registry. One line per report family. |

Adding **KPI**, **Personal Bonus** or **Salon Bonus** means a new directory
implementing `ReportParser` plus one line in `REPORT_PARSERS`. No existing
parser is touched, and there is no shared conditional to extend.

## Comp Sales — scope

`CompReport(MTD) vs 2024`: comparable-store (same-store) salon performance.
**Not compensation, payroll, salary or bonuses** — the sheet has no employee
dimension.

Deliberately **not** implemented, each for a stated reason:

- **No company totals.** A recipient's workbook may be a filtered slice, so a
  total computed here would be a confident number about an unverifiable
  population. Totals rows already in the sheet are skipped.
- **No actual-vs-target.** The workbook contains no targets.
- **No period-over-period.** One historical workbook cannot support it.
- **No ingestion of the ~150 other measures.** Only the 16 reviewed codes.
  An unrecognised column becomes a warning, never a new metric.

## Sheet detection

Structural, not by filename. Four **identity markers** must all hold:

1. a header row carrying **both** a salon-number and a store-name column;
2. the salon-number column;
3. the store-name column;
4. the core metric headers — `otc_revenue`, `eft_revenue`, `total_revenue`.

The sheet **name** only orders the candidates. A workbook whose sheet is called
`CompReport(MTD) vs 2024` but holds unrelated data fails every marker and is
rejected — see the decoy fixture.

A named candidate that fails is reported as `template_drift` ("our parser is out
of date"); anything else is `unsupported` ("wrong file").

The **period marker is not an identity marker**: a sheet with the right band and
measures *is* the Comp Report even when its period cell is malformed. Calling
that drift would send an operator hunting a template change over one bad cell,
so detection identifies the report and `parse` raises `period_unreadable`.
Either way the report does not get ingested.

## Metric resolution

Header text is primary; position is fallback only. The year is **not** part of
the code — `2026 OTC Revenue` and `2024 OTC Revenue` are one metric with
different `basis_year` values.

**Block association** is the one inference. The sheet groups each measure as
`[current year] [baseline year] [% change]`, and the change column's header names
only the comparison (`TY vs. 2024 % Change`), not the measure. Such a column is
attributed to the **nearest preceding base metric resolved by header**. When no
base metric precedes it the column is left unresolved with an
`unassociated_percent_change` warning — never attributed to a guess.

Two columns resolving to the same metric *and* year (the abandoned duplicate
block) keep the first and warn; this is what protects
`comp_sales_facts_live_key`.

`MetricMapping.observedColumns` records the column letters confirmed in the
audited workbook, and is used **only as a drift signal** — never to resolve a
column. See "Positional fallback" below.

## Confirmed template facts (`Comp Report 2026 08 30`)

Established by the read-only dry run against the real workbook.

**Two header rows, and they disagree.**

| Row | Heads | Far-right columns read |
| --- | --- | --- |
| 1 | the summary block in rows 2–32 (filtered totals/averages, age cohorts, quintiles) | "2025 Spa Sessions" / "2023 Spa Sessions" |
| 34 | the salon data band from row 35, plus the descriptor headers | "2026 Spa Sessions" / "2024 Spa Sessions" |

The parser takes the header row **nearest the data**, so row 34 governs. This is
load-bearing: reading row 1 would stamp the data band's spa figures with basis
years 2025 and 2023 — wrong years on real numbers, with no error raised. A
"most headers wins" rule would have been a coin toss.

**Layout.** Descriptors in A–T, measures in U–BT, 72 columns, 150 rows.
The period marker is in **F1**, as formatted text (`MTD 08/30/2026`).

**Two baseline blocks.** `U:AR` is 2026-vs-2024; `AU:BO` adds a 2019 baseline.
The 2019 columns reconcile exactly — `(U − AV)/AV = AW` on all 15 rows.

**Seven mis-headed columns.** `AU, AX, BA, BD, BG, BJ, BM` are headed
`"2024 <measure>"` but hold values *identical to the 2026 current-year columns*,
and differ from the true 2024 columns on every row. Their headers are stale,
left by a template roll-forward. This is the worst defect a header-primary
parser can meet, because the header is what it trusts — so the exclusion is
**proven from the data** by `verifyDuplicateColumns`, not left to the accident
that the leftmost duplicate happens to win.

`BR:BT` repeats the spa-session block verbatim (identical values) and is
excluded as benign redundancy.

**A recipient slice, visibly.** The template carries 116 salon slots; this
copy fills 15. The other 101 are reported as `template_placeholder`, not as
rows that lost their salon key — which is why the parser must never compute a
company total.

**`n/a` means not-applicable.** Eight salons have `n/a` in the spa %-change
column (no spa equipment). That is an absent measure, not malformed data, and
produces no fact and no warning.

## Positional fallback: deliberately not enabled

The audited workbook argued against it. Header matching resolved 38 of 38
supported measure columns, so a positional path would never have been reached —
and the columns a positional read would have trusted (`AU`, `AX`, `BA`, …) are
precisely the seven whose headers lie. A fallback that fires exactly where the
data is untrustworthy is worse than no fallback.

So `observedColumns` is populated but drives only an
`unexpected_metric_column` warning when a metric resolves somewhere else.
Header matching still decides; the warning just says the template moved.

## Testing

Fixtures are synthesised in-process by `__fixtures__/comp-sales-workbook.ts`.
**The real workbook is never committed** — it carries salon-level financials and
manager names. Every figure and place name in the fixtures is invented.

`contract.test.ts` extracts constraint regexes and the seeded metric codes **out
of the migration SQL** rather than restating them, so parser and schema cannot
drift apart silently.

### Real-workbook dry run (read-only)

```sh
COMP_REPORT_XLSX=/path/to/workbook.xlsx npm run dry-run:comp-sales
```

Skipped when the variable is unset. Uploads nothing, inserts nothing, and prints
counts, structural facts and **header text only** — never salon-level figures.
