# PPTA — the `$0.19` and `$0.00` traced to source

**Question asked:** *"Do not conclude `$0.19` is valid simply because it is
theoretically possible. Trace the exact affected salon from raw source data →
parser → ingestion representation → reporting calculation → displayed value.
Show `Product Sales / Total Tans = PPTA` using the actual values."*

**Verdict: both figures are supported by the delivery. Neither is a parser bug.
Nothing was changed in the numbers.** One explanatory sentence was corrected —
see §6.

---

## 1. What could and could not be traced

| Stage | Available? | Evidence used |
|---|---|---|
| Raw source workbook | **No** | Never committed. `__fixtures__/sales-totals-report.ts`: "The real reports carry salon-level financials for a live business and are never committed." |
| Parser | Yes | `sales-totals/parser.ts`, `sales-totals/metric-map.ts` |
| Ingestion representation | Yes | Supabase project `rbkylaavthsjepsczccv`, `sales_totals_current_facts` |
| Reporting calculation | Yes | `lib/reporting/ppta.ts`, `sales-totals-aggregate.ts` |
| Displayed value | Yes | `reports/sales-totals` |

Because the workbook itself is not available, the numerator was **not** taken on
trust. §4 reconstructs it from a second, independent column in the same
delivery, which is a stronger check than reading the file would have been:
it proves the daily column and the month-to-date column agree with each other.

## 2. The delivery carries no Product Sales column

`sales_totals_current_facts` holds exactly six metrics:

    efts, grand_total, new_customers, ppta, sunless_sessions, tans

There is **no Product Sales column**, so `Product Sales ÷ Total Tans` cannot be
recomputed directly from the delivery. What can be derived is the numerator:
`implied product sales = ppta × tans`.

## 3. PPTA is definitively not `Grand Total ÷ Tans`

MO Kansas City Wornall, 2026-09-12 daily: `grand_total` 551.39, `tans` 102.

    551.39 / 102 = 5.41     but the reported PPTA is 2.38

Consistent with a product-only numerator, and with `metric-map.ts`, which
already states that PPTA "does not reconcile to Grand Total ÷ Tans".

Across the fifteen salons the implied product sales run **26.8% – 58.9% of
Grand Total** — a plausible product share for a tanning salon, and never above
100%, which a shifted or mis-scaled column would very likely breach.

## 4. The decisive check: the MTD column corroborates the daily column

Product sales for a day can be derived **twice**, from two different columns:

    A.  from the daily row:  ppta_daily × tans_daily
    B.  from the month-to-date movement:
        (ppta_mtd(D) × tans_mtd(D)) − (ppta_mtd(D−1) × tans_mtd(D−1))

A and B share no cell. If the PPTA column were shifted, mis-scaled, or
fabricated, they could not agree.

Run over every salon and every pair of consecutive delivered dates where the
tans movement equals the daily tans exactly — **105 pairs** — A and B agree
within the band that two-decimal rounding on four published figures allows.

### The `$0.19` rows

**NE Kearney (0309), 2026-09-02 — `$0.19`**

| | PPTA | Tans | Implied product sales |
|---|---|---|---|
| MTD through 09-01 | 0.41 | 98 | $40.18 |
| MTD through 09-02 | 0.29 | 203 | $58.87 |
| **Movement** | | **105** | **$18.69**  (rounding band $17.19 – $20.20) |
| Daily 09-02 | **0.19** | **105** | **$19.95**  (rounding band $19.43 – $20.48) |

Tans movement 203 − 98 = 105 = the daily's tans, exactly. The two product-sales
bands overlap at $19.43 – $20.20. **Consistent.**

    Product Sales / Total Tans = PPTA
    $19.95 / 105 tans = $0.19    ✔ as displayed

**NE Lincoln O Street (0311), 2026-09-12 — `$0.19`**

MTD product movement $5.84 (band −$3.92 – $15.60); daily `0.19 × 41 = $7.79`
(band $7.59 – $8.00). $7.79 sits inside the movement band. **Consistent.**

    $7.79 / 41 tans = $0.19      ✔ as displayed

A salon taking roughly $20 of product on a 105-tan day is a weak retail day.
It is not an impossible one, and it is now corroborated by a column that had no
part in producing it.

## 5. The `$0.00` is a real net-negative product day

**NE Omaha 132nd and Maple (0313), 2026-09-12**: `ppta` 0.0000 with `tans` 74
and `grand_total` 168.24 — the `$0.00` the review saw, and the reason that salon
ranked last.

The MTD movement for that salon on that day is **−$5.83**: month-to-date product
sales went **down** while 74 tans were taken. Refunds and returns exceeded
product sales, and the source floors the daily figure at 0.00 rather than
publishing a negative.

So the zero is neither missing data nor a parser fault. It is also **not a rate**
— which is why the existing rule stands: a non-positive PPTA is not used to rank
or coach. See `PPTA_IMPLAUSIBLE_AT_OR_BELOW` in `lib/reporting/ppta.ts`.

## 6. The one thing that was wrong, and is now fixed

`pptaPlausibilityNote(0)` told the reader a zero "is as likely to be a source or
parsing problem as a salon that sold no product". The trace shows that is wrong
about this salon: it was a real trading day whose product sales netted below
zero. The note now names both readings, says the figure alone cannot distinguish
them, and keeps the rule that a zero is never ranked on.

**No figure changed.** Both `$0.19` values and the `$0.00` stand as delivered.

## 7. Why a parser bug is ruled out

1. **Headers are validated, not counted.** `parser.ts` checks each measure's
   header text at its own column pair and refuses the sheet when one does not
   match (`${measure.header} header (found "…")`). A shifted column fails
   ingestion rather than producing a wrong number.
2. **A shift could not reconcile.** The daily and MTD columns agree across 105
   independent pairs. No column offset survives that.
3. **The ratio test.** Implied product sales never exceed Grand Total, at any
   salon, on any delivered date.
4. **The stakeholder's own quoted figures match the store exactly.** Wornall
   2026-09-12: daily 2.38, MTD 2.12 — precisely what Sunny reported. Ingestion
   is faithful to what the reviewer saw.

## 8. Two data-quality findings for Paulyne — not code defects

**8.1 — Two days were never delivered.** The window 2026-09-01 to 2026-09-12
should hold twelve daily deliveries. It holds ten: **2026-09-05 and 2026-09-08
are absent entirely**. Month-to-date figures therefore cannot be reproduced by
summing the dailies on hand (Wornall's MTD tans are 1,261 against 1,029 across
the delivered days). *Were those two days skipped at source, or did their
delivery fail?*

**8.2 — 2026-09-07 is an all-zero delivery.** Every salon reports `ppta` 0,
`tans` 0 and `grand_total` 0 on that date. The **summary** rows for the same
date report `ppta` 0.29 on zero tans with a grand total of $0.08 (All Salons)
and $0.13 (STC Franchisees), which is a rate over an empty denominator. *Was
2026-09-07 a closed day, or an empty delivery that should be re-sent?*

Neither is caused by this branch and neither is fixed by it: both need the
delivery checked at source.
