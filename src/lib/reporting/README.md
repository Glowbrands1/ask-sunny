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

`MetricMapping.fallbackColumns` is **deliberately empty** — see the comment in
`metric-map.ts`. Positional fallback is implemented but cannot be populated
without the real workbook's column letters, and a guessed letter reads the wrong
column with full confidence.

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
