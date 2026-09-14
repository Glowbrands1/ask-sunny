# Spa Engagement `Overall Rank` — verified against the source workbook

**Date:** 14 September 2026
**Sources:** `Spa Sessions per Unique Tanner per Spa Bed (2026 09 01) All.xlsx`
and `STC SPA Wellness Tracking (2026 08 31).xlsx`, both supplied by the
business. Neither file is committed: between them they carry a 252-row staff
roster with addresses, phone numbers and e-mail addresses, and 248 salons of
other companies' figures.

This record exists because `Overall Rank` was the last open blocker on the
14 September stakeholder review — *"the weighting is undocumented"* — and the
answer turned out to be in the file all along, on a row nobody had read.

---

## 1. The formula, as the workbook states it

`All Summary` lays the ranking out like this:

| Row | What is on it |
|---|---|
| 9 | The **weights** — `K9 = 0.25`, `M9 = 0.25`, `O9 = 0.5`, each sitting directly above a Rank column |
| 10 | The headers |
| 11+ | One row per salon, 248 of them |

and row 10 names the columns:

| Column | Header |
|---|---|
| J | Spa Sessions per Bed |
| **K** | **Rank** — weight `0.25` |
| L | Spa Sessions per Unique Tanner per Spa Bed |
| **M** | **Rank** — weight `0.25` |
| N | Unique Spa Tanner % of Total Unique |
| **O** | **Rank** — weight `0.5` |
| **P** | **Overall Rank** |
| Q | *(unlabelled — see §5)* |

The three Rank headers are all the literal word `Rank`, so a Rank column cannot
be matched by name. Each sits immediately right of the measure it ranks, which
is the structural relationship the parser uses.

### The method

1. Each of the three measures is ranked **descending** over the whole chain,
   Excel `RANK.EQ` style: a value's rank is one plus the count of values
   strictly greater than it. **Ties share a rank and the next rank is skipped.**
2. The weighted score is `Σ (weight × rank)`. **Lower is better**, because
   rank 1 is the best rank.
3. `Overall Rank` is `RANK.EQ` **ascending** on that score: one plus the count
   of scores strictly less than it. Tied scores share an Overall Rank.

Restated as arithmetic:

> `score = 0.25 × rank(Spa Sessions per Bed) + 0.25 × rank(Spa Sessions per Unique Tanner per Spa Bed) + 0.50 × rank(Unique Spa Tanner %)`
> `Overall Rank = RANK.EQ(score, all scores, ascending)`

---

## 2. Reconciliation

Run through the shipped parser, not through a one-off script:

| Sheet | Rows | Component Rank mismatches | Overall Rank mismatches |
|---|---|---|---|
| `All Summary` | 248 salons | **0 / 744** (3 columns × 248) | **0 / 248** |
| `All DM Ranking` | 55 district managers | **0 / 165** | **0 / 55** |

`All DM Ranking` has the same shape with the weights on row 2 (`I2`, `K2`,
`M2`), ranks in `I` / `K` / `M`, and `Overall Rank` in `N`.

### `RANK.EQ` is load bearing

A sort position — each row taking its own place in the descending order — is the
obvious wrong implementation, and it agrees with the sheet only where there are
no ties:

| Measure | Rows a positional index gets right |
|---|---|
| Spa Sessions per Bed | 107 / 248 |
| Spa Sessions per Unique Tanner per Spa Bed | 233 / 248 |
| Unique Spa Tanner % of Total Unique | 212 / 248 |

Tied scores are common at the top too: 28 distinct scores are shared by two or
more salons, and the sheet gives them the same Overall Rank (score `21.25` →
ranks 11 and 11; `23.5` → 14 and 14; `43.25` → 28 and 28).

---

## 3. The ranking population is the whole chain

248 salons across 29 operating companies, of which **15 are JB and Associates**.
Every one of the 248 summary rows resolves against the `Roster` sheet, so the
population is not an artefact of unmatched rows.

The JB salons land between **#7 and #198 of 248**:

| Overall Rank | Salon | District |
|---|---|---|
| 7 | NE Grand Island | Dugan, Rachael |
| 36 | NE Omaha Pacific | Cotton, Sarah |
| 87 | NE Kearney | Dugan, Rachael |
| 98 | KS Overland Park | Patterson, Madeline |
| 132 | NE Lincoln Pine Lake | Dugan, Rachael |
| 133 | MO Kansas City Wornall | Patterson, Madeline |
| 134 | NE Omaha 144th and Center | Cotton, Sarah |
| 142 | KS Manhattan | Patterson, Madeline |
| 144 | NE Omaha 132nd and Maple | Cotton, Sarah |
| 152 | MO Kansas City Liberty | Patterson, Madeline |
| 156 | KS Shawnee Mission Pkwy | Patterson, Madeline |
| 171 | MO St Joseph | Cotton, Sarah |
| 193 | KS Lawrence | Patterson, Madeline |
| 196 | NE Lincoln O Street | Dugan, Rachael |
| 198 | NE Lincoln 27th Street | Dugan, Rachael |

This is a property of the metric, not a data-scoping decision: "rank 7 of 248"
is what the source published and what a manager is measured on. **No JB-only
rank was introduced**, and none should be without the business asking for one —
it would be a different number under the same name, and re-ranking 15 salons
among themselves would move every one of them.

What the product keeps is only the authorized company's rows, each carrying its
chain-wide rank and the population size. No other company's salon, figure or
name is retained.

---

## 4. `Overall Rank` is not Spa Conversion Rate

They are adjacent in conversation and unrelated in arithmetic:

| | Spa Conversion Rate | Overall Rank |
|---|---|---|
| Formula | Spa Sessions ÷ Total Tans | weighted ranks of three other measures |
| Source | Bed Usage **and** Spa Wellness, combined | Spa Engagement workbook, published |
| Direction | higher is better | **lower** is better |
| Population | the salons in view | the whole chain |
| Status | the business documentation's store-execution metric | the source's own ranking |

Total Tans is not an input to `Overall Rank` at all, so a salon can convert well
and rank poorly, or the reverse. The briefing says this outright.

**The one question this verification leaves open** is which of the two a person
is measured on — a business decision, not a data one:

> Should Salon Directors primarily be managed against Spa Conversion Rate, with
> Overall Rank used as a chain benchmark, or should Overall Rank itself be
> treated as the primary coaching metric?

Both are computed and both are shown either way; the answer changes emphasis and
coaching language, not arithmetic.

---

## 5. Column Q is not the ranking basis

The column immediately right of `Overall Rank` is **unlabelled** and carries
numbers of a similar magnitude — `98.5`, `205.5`, `23.5`, `89.75` on the first
four rows — which makes it exactly the sort of column a reader assumes is the
score. It is not: ranking on it ascending does not reproduce `Overall Rank`. The
same column exists on `All DM Ranking` (column O: `42.75`, `2.75`, `12`, `40.5`
against published ranks 1, 2, 3, 4). A regression test asserts the negative
against the file.

---

## 6. What the Spa Wellness workbook confirms

`STC SPA Wellness Tracking (2026 08 31)` — sheets `MTD`, `YTD`, `LTM`,
`First Use Dates`, `Last Use Dates` — was checked in the same pass.

**The zero-usage rule is stronger than documented.** The business documentation
says "zero usage means the equipment is NOT installed". The source does not make
a zero ambiguous — **it never writes one**. Across all three windows and all 30
spa equipment columns, every cell is either a positive session count or blank;
there are 0 explicit zeroes and 6,620 blanks on the `MTD` sheet alone. An
installed-but-idle unit cannot be expressed in this file at all, which is what
made the earlier "four units recorded no sessions" reading impossible rather
than merely unlikely.

**The published `Filtered Average` applies the same rule to the denominator.**
Its divisor is the count of salons that *have* the equipment, not 248 — e.g.
`SPA Beauty Shaper` totals 14,784 over 134 salons for the published 110.328.
Two columns (`SPA Leg Compression`, `SPA Plunge Max`) are installed nowhere and
the sheet writes `n/a` rather than `0`. The parser's `chainAverageSessions`
reproduces the published row for every comparable type in all three windows.

**61 units vs 57 types, confirmed from source.** The 15 JB salons carry 61
installed units against 57 equipment types with usage, identically in `MTD`,
`YTD` and `LTM`. The whole gap is two multi-unit salons — MO Kansas City Liberty
(7 units, 5 types) and MO St Joseph (6 units, 4 types). Every other salon has
units equal to types. **No idle equipment.**

**The 15 salons and their districts match the production roster exactly.**
Store names and the three district labels — Patterson, Dugan, Cotton — agree
with `src/data/salons.ts`, checked by assertion rather than by eye.

---

## 7. Was anything wrong?

**No correction was required to the ranking implementation.** It already read
the weights off the sheet rather than assuming them, already ranked `RANK.EQ`
descending over the whole chain, already scored lower-is-better and already
ranked ascending on the score.

Three things did change:

1. **The evidence.** `metric-map.ts` claimed the regression suite pinned the
   method "against the real file". It did not — `parser.test.ts` runs on a
   synthetic workbook, which proves the parser self-consistent but cannot prove
   it matches what the business sends. `spa-engagement/source-workbook.test.ts`
   and `spa-wellness/source-workbook.test.ts` now do that, against a real
   delivery, skipping when none is configured:

   ```
   ASK_SUNNY_SPA_ENGAGEMENT_WORKBOOK=/path/to/engagement.xlsx \
   ASK_SUNNY_SPA_WELLNESS_WORKBOOK=/path/to/wellness.xlsx npm test
   ```

2. **What Ask Sunny can say.** The briefing quoted a bare rank and could not
   explain it. It now states the method in the source's own order, names each
   weighted measure with its formula and the weight **this delivery published**,
   names the population, and says outright that `Overall Rank` is not Spa
   Conversion Rate. A delivery carrying no weights produces a refusal, not a
   remembered 25/25/50.

3. **One inaccurate sentence.** The briefing told the model "the source writes a
   zero for equipment a salon does not have". The source writes a blank. Both
   are stored as no fact, so no figure was affected, but the sentence described
   the file incorrectly and is now corrected.
