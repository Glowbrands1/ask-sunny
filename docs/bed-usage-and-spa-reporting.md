# Bed Usage and Spa performance reporting

The business rules behind the **Bed Usage**, **Spa Wellness** and **Spa
Engagement** tabs, the combined **Spa Conversion Rate**, and the report figures
the assistant is grounded on.

This is the reference for *why the numbers are what they are*. The ingestion
mechanics it sits on are in
[`reporting-ingestion-contract.md`](./reporting-ingestion-contract.md); the
parser-level template facts are in
[`../src/lib/reporting/README.md`](../src/lib/reporting/README.md).

Every rule below is enforced in code and covered by a regression test. Where a
rule was *declined* — a threshold nobody approved — that is recorded too, since
the absence is the decision.

---

## 1. Scope: one company, enforced below the UI

All three reports are chain-wide deliveries. The authorized slice is

> **JB and Associates**

and it is enforced in four places, so no single mistake exposes another
company's salons:

| Layer | Mechanism |
| --- | --- |
| Parser | Rows for any other company are dropped before a fact exists. `src/lib/reporting/store-identity.ts` holds the one definition of the company name. |
| Ingest function | Salons resolve against the roster; an unresolved name is **returned to the caller**, never invented. A delivery resolving *zero* salons raises rather than writing an empty period. |
| Read layer | `company` is a parameter of every function and defaults to the authorized one. There is deliberately **no function that reads across companies**. |
| RLS | Enabled *and forced* on every table. `anon` and `authenticated` hold `select` only; writes belong to the secret key. |

Peer and chain comparisons are therefore stored as **bare averages and counts** —
`peer_average_sessions`, `peer_salon_count` — with no company, salon or store
name attached. That is the whole of what a comparison needs, and the whole of
what may be shown.

Salon matching is **exact, then aliased, then refused**: canonical store name,
then a controlled alias table (`STORE_NAME_ALIASES`, deliberately empty today),
then the roster. There is no fuzzy matching. An unmatched salon becomes an
ingestion warning that names it; it is never dropped and never guessed at.

---

## 2. Bed Usage

### What it measures

Monthly tanning traffic by salon and by equipment level, against the chain.

| Field | Meaning |
| --- | --- |
| `total_tans` | The salon's own `Salon Tans`, read **once per salon** — never summed from equipment rows. |
| `bed_count` | The salon's own bed count, likewise. |
| `per_bed` | `tans / beds`, **recomputed** at every level of aggregation. |
| `v_chain_percent` | The salon's per-bed usage against the chain benchmark for that level. |

**Per Bed is always recomputed, never averaged.** Averaging fifteen salons'
per-bed figures weights a one-unit row like a four-unit one, which is exactly
the distortion Per Bed exists to remove. `reconcile()` asserts that the source's
own salon totals agree with the sum of its equipment rows and *reports* a
disagreement rather than absorbing it.

**The chain benchmark comes from the `All Salons` block, not `Filtered Data`.**
The workbook carries both. `Filtered Data` describes the recipient's slice, so
using it would compare JB against JB and report every level as "at chain".

### Classification against the chain

An **ordered ladder**, evaluated top to bottom, first match wins:

| Rung | Band |
| --- | --- |
| `>= +2%` | Outperforming Peers |
| `>= -2%` | At Market |
| `> -8%` | Below Market |
| otherwise | Significantly Underperforming |

Written as a ladder rather than as ranges **because the approved table's ranges
overlap at their boundaries**: read as ranges, exactly `+2%` and exactly `-2%`
each belong to two bands, and a boundary value would classify differently
depending on which comparison an implementation happened to write first. The
third rung is *strictly* greater than `-8`, so exactly `-8%` is Significantly
Underperforming — which is what the approved table's final row, written `≤ -8%`,
says.

`v Chain` arrives from the workbook as a **multiple** of the chain average
(`1.0` = at chain). It is converted to a percentage **once**, at the parser
boundary, by `percentFromRatio`. Converting at each call site is how a `2.03`
would eventually be classified as `+2.03%` — outperforming by two points instead
of by a hundred and three.

### The FAST rule

> **FAST reductions are intentional and are not a performance shortfall.**

FAST is tracked for **capacity and volume migration** — whether FASTER, FASTEST
and INSTANT absorb former FAST demand. So:

- A FAST row below the chain is **suppressed as a finding and kept as a figure**.
  Hiding the figure would defeat the migration analysis the level is tracked for.
- A FAST row *above* the chain is **not** suppressed. The rule exists so a
  deliberate removal is not read as failure, not so good news is hidden.
- Nothing anywhere alerts on FAST, and nothing suggests a removal was a mistake.

Implemented as `isAdvisoryOnlyLevel(level)` — a predicate on the level itself,
not a flag a caller remembers to pass, so a chart added later cannot forget it.
`fastMigrationView()` presents FAST beside the premium levels as the absorption
question, which is what the level is for.

---

## 3. Spa Wellness

### The equipment-presence rule

> **Zero usage means the equipment is NOT installed.**

This is the most consequential rule in the domain, and it is enforced by the
*shape* of the data rather than by a check somebody could skip:

- The parser writes **no zero-valued fact**. A blank or zero cell produces no
  row and is counted in `not_installed_cell_count`.
- The schema forbids one: `sessions numeric(18,4) not null check (sessions > 0)`.
- `equipmentPerformance()` skips any non-positive row anyway, as defence in
  depth against a period ingested by an older parser.

So a salon with no row for a piece of equipment **does not have it**, and no
figure describes it as underusing equipment it does not own.

### Like-for-like peer comparison

For each equipment type:

- **our average** = our sessions ÷ **our salons that used it**
- **peer average** = the source's own average over **peer salons that used it**

Both denominators are counts of salons that actually used the equipment, so the
comparison is like-for-like on both sides. A salon without the equipment is in
neither.

| Rung | Band |
| --- | --- |
| `>= +10%` | Outperforming Peers |
| `>= -5%` | At Market |
| `> -15%` | Below Market |
| otherwise | Significantly Underperforming |

Wider than the bed usage ladder because spa equipment is discretionary with far
more variance per site. The two ladders are kept as **two named constants** —
`BED_USAGE_LADDER`, `SPA_PEER_LADDER` — rather than one parameterised function,
which is what stops a later edit from "simplifying" them into one set of numbers.

### Dynamic equipment columns

Spa equipment columns are identified **by their actual report headers**, never by
position. `resolveEquipmentBlock` takes everything between the last named
descriptor column and `Total Spa Sessions (Active Beds)` as the equipment band,
and `spaEquipmentCode` derives a stable code from each header.

`spa_equipment_types` is therefore an **open** table: a new machine appearing in
a future delivery is created at ingest time and appears on the dashboard with no
deployment. There is no `column 17 = Hydromassage` anywhere in the codebase, and
a fixture (`SPA Calmwave Lounge`) exists specifically to prove it.

The `Other` bucket is **not compared**. It aggregates whatever did not map to a
named type, so one salon's "Other" and another's are different machines. Its
sessions still count toward the estate total; only the comparison is withheld,
with the reason attached.

### The estate figure is session-weighted

`weightedPeerDeltaPercent` weights each type's shortfall by its sessions, and is
**labelled as weighted wherever it is shown**. An unweighted mean would let a
two-salon type at +86% cancel a fifteen-salon type at -21% and report the estate
as healthy.

### New equipment: an age, not a verdict

`daysSinceFirstUse(firstUse, asOf)` requires a reference date and is computed
**as of the report's own period end**, never `new Date()` — otherwise the figure
changes every day the page is loaded and stops matching the report it came from.

**There is no "new equipment" threshold.** No approved rule defines one, so
`firstUsedWithinPeriod` states the fact — this unit was first used inside the
window it is being measured over, so its sessions cover less time than its
peers' — and the reader judges. A `< 30 days` rule was *declined*, not
forgotten; if one is approved later it belongs beside the other business rules.

---

## 4. Spa Engagement — four measures that are not each other

The engagement report publishes several ratios that are easy to conflate. Each
has its own named function and its own label, and none is ever displayed under
another's name:

| Measure | Formula |
| --- | --- |
| **Spa Per Unique %** | `spa sessions ÷ total unique tanners` |
| **Spa Sessions per Spa Bed** | `spa sessions ÷ spa beds` |
| **Spa Sessions per Unique Tanner per Spa Bed** | `spa sessions ÷ total unique tanners ÷ spa beds` |
| **Unique Spa Tanner %** | `unique spa tanners ÷ total unique tanners` |

The first and third are **the pair that must never be conflated**. For a salon
with 33 sessions, 74 unique tanners and 4 beds: Spa Per Unique % is **44.6%**
and Spa Sessions per Unique Tanner per Spa Bed is **0.1115**. Labelling the
second as the first reports a store converting 45% of its customers as
converting 11%.

Each returns **null rather than zero** on a missing or zero denominator. A salon
with no spa beds has no sessions-per-bed figure; reporting `0` would put it at
the bottom of a ranking of stores that *do* have beds.

**Every estate ratio is recomputed from the sums**, never averaged across salons.
The workbook makes the same distinction itself — it publishes an `All` row of
sums and an `All Average` row of per-salon means, and they are different numbers.

**A caveat that travels with any summed unique-tanner figure**
(`UNIQUE_TANNER_SUM_NOTE`): a customer who visited two salons is counted in
both, so a total across salons is a sum of salon-level uniques rather than a
count of distinct people. The source has the same property, so this matches the
report rather than improving on it.

### Ranks

The workbook's ranks are reproduced with **Excel `RANK.EQ` semantics** — ties
share a rank and the next is skipped — and the rank **weights are read from the
row above each Rank column**, not hard-coded. If the weights cannot be read, the
parser **refuses** rather than substituting its own. No new weighting was
invented; `spa-engagement/parser.test.ts` proves the published ranks are
reproduced exactly.

A rank is always shown **with its population** (`12 of 248`), because the
population includes salons outside this company and a rank without it is not a
rank.

---

## 5. The combined metric: Spa Conversion Rate

> **Spa Conversion Rate = monthly spa sessions ÷ monthly total tans**

It normalizes spa usage for store traffic, which is what separates a traffic
problem from an execution problem.

### It refuses rather than approximates

`computeSpaConversion` is a decision function with **five stated reasons** for
`N/A`, checked in this order:

1. `period_mismatch` — the two reports cover different windows.
2. `salon_unresolved` — the salon's name could not be matched.
3. `sessions_missing` — no spa figure to convert.
4. `traffic_missing` — no Total Tans for the matching Bed Usage period.
5. `traffic_zero` — no traffic, so nothing to convert (and no division by zero).

**The period check runs first and applies to the whole view.** A conversion
computed across mismatched periods is wrong for every salon, so no per-salon
detail could rescue it, and reporting fifteen small per-salon reasons would hide
a view-level problem.

`periodsMatch` compares **the grain and both dates**. `MTD` through 31 August
and `YTD` through 31 August share a `period_end` and cover eight times the
traffic, so a date-only check would pass exactly the comparison that is most
wrong.

Every refusal renders **`N/A` plus the reason** — never a blank, never a zero. A
blank reads as "nobody has looked"; a zero reads as "this salon converts
nothing", which is a finding somebody would act on.

### The estate rate sums the parts and divides once

`aggregateSpaConversion` sums sessions and sums tans, then divides. Averaging
fifteen salons' rates weights a 1,451-tan salon the same as a 7,375-tan one.
Only salons whose own rate is available contribute, so an unmatched salon cannot
shrink the numerator while its traffic inflates the denominator.

### The combined view resolves its own period

The three reports arrive on their own schedules — in the supplied deliveries the
engagement report covers a single day in September while the other two cover
August. So the combined section takes **the newest window both halves of the
metric cover** (`newestSharedPeriod`), says which one that is, and withholds the
engagement columns when this report's own window is not it. Keyed to whichever
report happened to be newest, the conversion column would be `N/A` forever —
correctly and uselessly.

### Row set is the union, not the intersection

A salon present in the spa report and absent from Bed Usage is an **ingestion
gap**, and a table that silently omitted it would report a smaller, tidier
estate than exists. Every row says which of the three reports contributed to it,
and the unjoined names are listed.

### Status is a reading, not a recommendation

`SalonStatus` describes what the reports say — `traffic_without_conversion`,
`converting_with_weak_equipment`, `partial_period_equipment` — and the footnote
under the table says so: *"Status is a reading of what the reports say, not a
recommendation."*

**No capital-expansion thresholds are implemented.** The reports support the
decision; they do not make it. There is no autonomous capital-approval logic
anywhere in this domain, by decision.

---

## 6. Report families and email intake

The three reports join the existing inbound-email pipeline rather than getting
one of their own. Each is a `ReportFamily` in
`src/lib/reporting/inbound/report-families.ts`, recognised **structurally** —
`recognizes()` parses the bytes; the filename and extension are never consulted.

| Family key | Label | Approved senders | Subject fragment (default) |
| --- | --- | --- | --- |
| `bed_usage` | Bed Usage Report | `BED_USAGE_APPROVED_SENDERS` | `BED_USAGE_SUBJECT_FRAGMENT` (`bed usage`) |
| `spa_wellness` | STC SPA Wellness Tracking | `SPA_WELLNESS_APPROVED_SENDERS` | `SPA_WELLNESS_SUBJECT_FRAGMENT` (`spa wellness`) |
| `spa_engagement` | Spa Sessions per Unique Tanner per Spa Bed | `SPA_ENGAGEMENT_APPROVED_SENDERS` | `SPA_ENGAGEMENT_SUBJECT_FRAGMENT` (`spa sessions per unique tanner`) |

All three are in `EMAIL_INGESTIBLE_FAMILIES`, so **activating one is a
configuration decision, not a deployment**: set the senders variable to an
approved address. An unset senders list admits **nobody** — the subject fragment
has a default precisely so that activation turns entirely on sender approval.
Sender matching is **exact**; there are no domain wildcards, because a domain
rule would let any colleague file figures by replying to the thread.

Manual upload through `POST /api/reporting/intake` remains available and uses
**the same** `dispatchReportIntake`, so the two paths cannot diverge.

### Windowed deliveries

The Spa Wellness workbook carries MTD, YTD and LTM in one file — three periods
from one delivery. Each is ingested under its own parser key,
`windowParserKey(parserKey, window)` → `spa_wellness_tracking_mtd`. Without
that, the idempotency index `(file_id, parser_key, parser_version) where status
= 'succeeded'` would make the second and third windows look like duplicates of
the first and only one would ever load. (The separator is an **underscore**:
`report_ingestions.parser_key` is constrained to `^[a-z][a-z0-9_]{2,63}$`.)

---

## 7. How the assistant is grounded on these figures

Sunny answers from two kinds of source on **one** pipeline. There is no second
model call, no separate "analytics assistant" and no independent AI pipeline.

```
question
  -> isReportingQuestion(question)?          question-gate.ts   (keyword gate)
  -> [in parallel] knowledge retrieval  +  loadBedSpaBriefing()
  -> buildSystemPrompt({ hasContext, hasReportData })
  -> COMPANY KNOWLEDGE block + REPORT DATA block + the question
  -> Claude
```

| Source | Cited by | Rules |
| --- | --- | --- |
| Knowledge base chunks | `[S1]`-style markers the server assigns | Existing behaviour, unchanged. Citations are built from retrieved rows, never from model output. |
| Report figures | **the reporting period**, never a marker | Data, not policy. No new figure may be computed from them. |

`loadBedSpaBriefing` (`briefing-source.ts`, `server-only`) runs **the same
analytics functions the dashboards run** and hands the results to a pure
renderer (`briefing.ts`). There is one implementation of Spa Conversion Rate and
both surfaces call it, so a manager cannot read one figure on the tab and a
different one in chat.

Four properties worth stating:

- **It takes no period or company from the request.** The company defaults to the
  authorized one and there is no request field that could select another, so a
  crafted question cannot reach a slice the dashboards would not show.
- **It never throws.** A reporting outage must not take down the answer path; a
  failure returns `null` and the knowledge-base half answers alone.
- **Every section carries its own period**, and the briefing's rules block
  forbids combining them.
- **A truncated list says so.** `MAX_BRIEFING_ROWS` bounds each list, and the
  note that follows is what stops "which salons are lowest" being answered off
  the visible half.

The briefing repeats the domain rules to the model in the words above: zero means
not installed; FAST reductions are intentional; the two spa ratios are different
measures; `N/A` carries its reason; the reports describe what happened and do not
authorise a purchase, a removal or a disciplinary action.

**The gate is a keyword list, deliberately, not a classifier.** Its two failure
modes are not symmetric: a false positive costs latency and tokens, while a false
negative means Sunny says the knowledge base does not cover a figure that is
loaded. So the list leans inclusive and is drawn from the reports' own
vocabulary. `salon`, `store` and `location` are excluded — they appear in nearly
every question a manager asks, and gating on them is the same as having no gate.

### Loading the methodology document itself

The narrative methodology document (`bed_usage_spa_reports_and_metrics.md`) is a
**knowledge-base document**, not report data: upload it through the existing
Knowledge screen and it becomes citable like any other policy document. The
briefing above carries the *figures*; the document carries the *definitions*, and
a question that needs both gets both.

---

## 8. Rules that were declined

Recorded because the absence is the decision, and because a future reader will
otherwise assume they were overlooked.

| Not implemented | Why |
| --- | --- |
| A "new equipment" ramp threshold | No approved rule defines one. The dates are shown; the reader judges. |
| Capital-expansion thresholds | This is decision-support reporting, not a capital-approval engine. |
| Any new ranking weights | The workbook's own weights are read from the file and reproduced. |
| Fuzzy salon matching | An unmatched salon is a surfaced warning. A wrong match is worse than a gap. |
| A company-wide or cross-company view | There is no read function that could serve one. |
| Zero-valued spa facts | Forbidden by a check constraint, because a zero is an absence. |
