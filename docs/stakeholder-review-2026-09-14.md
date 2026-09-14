# Stakeholder review, 14 September 2026 — audit, changes and open questions

Branch: `feature/ask-sunny-stakeholder-review-sep14`

Every item in the review is classified below as exactly one of **Completed**,
**Needs stakeholder clarification**, or **Deferred**. Nothing from the review is
absent from this document.

---

## 1. Audit matrix

Each row traces the reported symptom to the code that produced it, rather than
restating the review.

| # | Feedback item | Current behaviour | Root cause | Files / components | DB, view or parser | Fix | Risk |
|---|---|---|---|---|---|---|---|
| 1 | Test data live on Overview — Jordan Vance (test), suzy sunshine, Ace Test, Maple Crossing | Records appear in the follow-up queue | **Data quality.** Live `form_instances` rows from testing against the deployment. Nothing in the repo creates them; no release removes them | `lib/forms/production-records.ts`, `app/(app)/page.tsx` | Reads `form_instance_overview`; no schema change | Roster guard + empty-by-default configured exclusion; archive remains the instrument for the four named records | Low — nothing is deleted, everything stays in Form Monitoring |
| 2 | Spa Wellness status applied by equipment type, not per row | Beauty Shaper +127% reads SIGNIFICANTLY UNDER; every Poly RLT row identical | **Backend/read logic.** The detail table computed each row's delta but took its band from `equipmentPerformance`, the *estate-level* classification for that equipment type | `read/bed-spa/spa-wellness-analytics.ts`, `reports/spa-wellness/page.tsx` | No DB change; classification is in the read layer | `equipmentRowPerformance()` classifies each installed unit against its own peer average; figure and badge come from one call | Low — pure function, regression-tested |
| 3 | Spa Engagement rank runs #249 … #-11 | Impossible ranks on the axis | **Frontend.** The inverted-rank chart was given no axis domain, so the library chose one past both ends and the formatter turned those ticks back into ranks | `read/bed-spa/rank.ts`, `features/reports/bed-spa/ranked-bar-chart.tsx` | Validation added at the read layer (`readRank`) | Domain bounded to `[1, population]`, whole-rank ticks, `clampRank` as a last guard, invalid stored ranks dropped as unreadable | Low |
| 4 | PPTA has three definitions; $0.00 and $0.19 look like parsing | Sales Totals called it money per transaction; framework called it Product Productivity Average; Bonus Viewer defined Unique PPTA | **Ambiguous definition, now resolved.** Confirmed: PPTA = Product Sales ÷ Total Tans | `lib/reporting/ppta.ts` and every consumer | Metric map note; no column change | One authority module; tans-weighted combination; implausible values flagged, never corrected | Medium — changes a refusal into a figure; see §3 |
| 5a | Overview follow-up card shows 15, then 16, categories total 20 | Three different totals | **Frontend.** "Open" was `total − overdue`, which already contained the four due this week | `features/dashboard/overview.tsx` | — | Three disjoint buckets that sum to the total, with the arithmetic printed on the card | Low |
| 5b | Spa Wellness header says 61 units, footer says 57 | Two numbers for the same thing | **Different populations, now labelled.** Header counts `equipment_pieces` the source reports per salon; footer counts installed units that recorded *use* | `reports/spa-wellness/page.tsx` | — | See §3 — the distinction is real; the labels now say which is which | Low |
| 6 | Reports & Analytics not scoped to the employee account | Identical to admin, line for line | **Authorization.** `AccessScope` existed on every identity and the reporting read layer never asked for it | `lib/reporting/scope/*`, every report page | `.in("salon_number", …)` on every fact query | Allowlist applied *in the query*, before any row is read | Medium — the largest change; fully tested |
| 7 | Overview not scoped; shows full-region figures under a one-salon chip | $676.3K, 7,120 unique tanners | Same cause as 6 | `read/overview.ts`, `features/dashboard/performance-overview.tsx` | Same | Every builder narrows its own read; caption names the population | Medium |
| 8 | Ask Sunny returns all 15 salons when asked | Scope was a wording preference | Same cause as 6 — the briefing's queries were unscoped | `read/report-briefing.ts` and the three section loaders | Same | The allowlist reaches the queries; the model is told the rows *were not read* | Medium |
| 9 | Markdown tables render as raw pipes | `| Salon | PPTA |` on screen | **Frontend.** `RichText` had no table rule; pipe rows fell through to a paragraph | `components/rich-text.tsx` | — | GFM pipe tables as React elements; no raw HTML path | Low |
| 10 | Reports open at maximum detail | 57-row table is the landing view | **UX.** No drill-down affordance existed | `features/reports/detail-section.tsx` + five pages | — | Native `<details>`; nothing deleted | Low |
| 11 | Explanatory copy doing too much | Three-sentence PPTA tile; "Two measures that look alike" | **UX** | `selected-salon-cards.tsx`, `reports/spa-engagement/page.tsx` | — | Behind one line, same words | Low |
| 12 | Data Source & Quality is engineering-facing | Parser name and version on a manager's screen | **UX / role** | `lib/auth/admin-view.ts`, five pages | — | Admin-only. Explicitly *not* a security boundary | Low |
| 13 | Freshness inconsistent; UTC; "Loaded"; "Recipient Slice"; Sales Totals has no timestamp | Four chips on one tab, four different ones on another | **Frontend, assembled per page** | `read/freshness-line.ts`, `features/reports/freshness-line.tsx` | Cadence declared on `REPORT_FAMILIES` | One line, four measured segments, Central Time via `America/Chicago` | Low |
| 14 | Salon Performance compares vs 2024 | Should be 2025 | **Configuration.** `PREFERRED_BASELINE_YEAR = 2024` and a default window token of `"2024"` | `read/filters.ts`, `read/windows.ts`, `read/canonical.ts` | — | Derived: `preferredBaselineYear(currentYear)`; default is a sentinel, not a year | Low |
| 15 | Movers axis runs to −71% with nothing negative | Half the plot empty | **Frontend.** Unconditional symmetric domain | `salon-performance/chart-axis.ts` | — | Symmetry only when both signs are present | Low |
| 16 | "Largest Decreases: None" is an empty box | Labelled empty container | **Frontend** | `reports/salon-performance/page.tsx` | — | A list renders only when it has rows | Low |
| 17 | Two Ask Sunny buttons on Sales Totals | Only this tab | **Frontend** | `reports/sales-totals/page.tsx` | — | The shared yellow bar is the only control; the panel is unmounted, not deleted | Low |
| 18 | "Utilisation" spelling | Two places | **Copy** | `reports/bed-usage/page.tsx`, `reports-routes.ts`, `report-families.ts` | — | American spelling in user-facing copy; both spellings kept as chat routing keywords | Low |
| 19 | Is August Bed Usage stale or the newest month? | A date alone cannot say | **Missing metadata** | `read/freshness-line.ts` | Cadence on `REPORT_FAMILIES` | `monthlyCurrency()` compares the period end with the last completed month | Low |
| 20 | Spa Wellness: Rejuve benchmarked on 1 salon, Ovation on 2 | Confident "OUTPERFORMING PEERS" over a peer group of one | **Presentation of a real limitation** | `spa-wellness-analytics.ts`, `reports/spa-wellness/page.tsx` | — | Small-sample marker naming the count. **No significance test is computed** — none is approved | Low |
| 21 | Spa Engagement: all 15 SIGNIFICANTLY UNDER | Nothing actionable | Same cause as item 2, reaching the combined view | `reports/spa-engagement/page.tsx`, `bed-spa/briefing-source.ts` | — | Fixed by the per-row classification | Low |
| 22 | Spa Engagement: three columns entirely N/A | 45 cells of N/A | **Period mismatch**, one cause reported 45 times | `reports/spa-engagement/page.tsx` | — | An entirely empty column is dropped and its absence named once | Low |
| 23 | "Spa Equipment Peer Performance / Weakest Installed Unit" shows bed counts | Reads as one column | **Labelling.** Two adjacent columns, one a count and one a band | `reports/spa-engagement/page.tsx` | — | Renamed: "Spa Units Installed (Count)" and "Weakest Unit vs Peers (Band, not a count)" | Low |
| 24 | Totals row shows 0.0029 against salon values 0.02–0.11 | Reads as a benchmark | **Arithmetic.** Recomputing a bed-normalised rate from the sums divides by ~60 beds rather than ~4 | `reports/spa-engagement/page.tsx` | — | Cell reads `n/a` with the arithmetic explained. **No replacement invented** — see §3 | Low |
| 25 | Overview: "Open Form Monitoring" three times | On one card | **Frontend** | `features/dashboard/overview.tsx` | — | Two remain, on different objects | Low |
| 26 | Overview: Recommended Training is empty | Heading over nothing | **Frontend + missing config.** Rows came from three hard-coded demo video ids the live store has none of | `lib/config/training-links.ts` | — | Teams and Woven links from configuration; says plainly when unset | Low — **URLs still needed**, see §5 |
| 27 | Login: "Training that finds you" | A promise not kept | **Copy** | `features/auth/login-screen.tsx` | — | Removed | Low |
| 28 | Status vocabulary | Several sets of labels | **Already one four-tier scale**; four *kinds* of state were reading as one | `performance/status-vocabulary.ts` | — | Categories named and asserted; **no threshold changed** | Low |
| 29 | "Estate" terminology | Not field language | **Copy** | Throughout; guard in `terminology.test.ts` | — | "your salons" / "these salons" / "the chain" by context; identifiers untouched | Low |
| 30 | Role labels vs effective access | Account labelled Regional Manager, scoped to one salon | **Two orthogonal axes, working as designed** | `lib/permissions/index.ts`, `app_users.scope_*` | — | See §3 — this is a configuration question, not a defect | — |

---

## 2. Completed

Summarised; the commits carry the detail.

**Incorrect data and calculations**
- Spa Wellness status is computed per salon/equipment row. Two rows of the same
  equipment type can and do land in different bands
  (`spa-row-classification.test.ts`).
- The same fix corrects the Spa Engagement combined view, where all 15 salons
  read SIGNIFICANTLY UNDER, and the chat briefing, which had the same defect.
- Spa Engagement rank can no longer render below 1, on the axis or anywhere
  else; invalid stored ranks are dropped as unreadable rather than drawn.
- PPTA is Product Sales ÷ Total Tans in one module and every consumer. Combined
  across salons by weighting each salon's own tans — exact under the definition.
  Implausible values are flagged as data issues and excluded from ranking and
  coaching; **no value is corrected**.
- Overview follow-up totals reconcile, with the arithmetic printed on the card.

**Rollout blockers**
- Non-production records are kept off the Overview by a roster guard plus an
  empty-by-default configured exclusion. Nothing is deleted; archive is the
  instrument for the four named records, and it already exists.

**Authorization and salon scoping**
- `reporting/scope/authorized-salons.ts` resolves an `AccessScope` to salon
  numbers, resolving districts and regions through the roster. `null` means
  unrestricted; an unresolvable area yields an **empty** allowlist, so an unknown
  assignment shows nothing rather than everything.
- Applied **in the query** on: Salon Performance (and its drill-down), Sales
  Totals, Bed Usage, Spa Wellness, Spa Engagement, the Overview, the follow-up
  queue, the Sales Totals analyser route and the Ask Sunny report briefing.
- A URL naming salons is intersected with the allowlist; an empty intersection
  yields nothing, never everything.
- The briefing header tells the model the other salons' rows **were not read** —
  a fact about the data, not an instruction to withhold.
- Navigation gating is untouched and still hides the Admin area.

**Reporting freshness**
- One line on all five tabs, four measured segments, Central Time through
  `America/Chicago`. Sales Totals has a refresh timestamp. "Loaded" → "Refreshed".
  "Recipient Slice" removed, its claim kept in plain words. Cadence declared per
  family. Overview tiles carry their own period and cadence.

**Report-specific, Overview, UX, terminology** — as per the matrix.

---

## 3. Needs stakeholder clarification

Five items as first written. **One (3.3) is now answered** by the business
documentation supplied on 2026-09-14 and needed a code fix rather than a
question; **3.2's data half is answered** — the `Overall Rank` weighting was
verified against the source workbook and approved, leaving a business-use
question about which metric a Salon Director is coached on; **3.1 is no longer
blocking**. Each item below states what is ambiguous, what was found, and the
exact question.

**No item on this list is a rollout blocker.** Every remaining question decides
emphasis or wording, not arithmetic, and every figure each one touches is
already computed and shown.

### 3.1 Spa Engagement — the combined bed-normalised total

**Ambiguous:** what a combined "Spa Sessions per Unique Tanner per Spa Bed"
should be across several salons.

**Evidence:** every other footer cell recomputes from the sums, which is correct
for a rate. Applying the same rule here divides by the *total* bed count across
all salons (~60) rather than one salon's (~4), producing the 0.0029 the review
saw beside salon values of 0.02–0.11. A plain mean of the salon values is a
different figure under the same label. The workbook publishes both an `All` row
of sums and an `All Average` row of per-salon means, and they differ — but
nothing states which is intended for this measure.

**Question:** *For "Spa Sessions per Unique Tanner per Spa Bed", what is the
correct figure across several salons — the average of the salon values, a
bed-weighted average, or is there no meaningful combined figure?*

Until answered the cell reads `n/a` with the arithmetic explained.

**NARROWED on 2026-09-14.** `docs/bed-usage-spa-metrics.md` does not mention
this measure at all, so the combined-figure question stands. What it does
settle is that this measure is **not** the one salons are ranked or compared on
— Spa Conversion Rate is — so an unavailable combined cell no longer sits under
the report's headline. The question is worth answering; it is not blocking.

### 3.2 Spa Engagement — is the report's own definition current?

The review asks: *"Do I need to provide an updated rundown of this report for us
to update in knowledge base?"*

**Yes, and specifically:** the four formulas the code implements were verified
against the workbook's own columns for all 248 salons, so the *arithmetic* is
not in doubt — and since 14 September the `Overall Rank` weighting is verified
from the same file too. What remains undocumented is the **interpretation**:
what a manager should do with each measure, and which of them is the headline.

**Question:** *Please send the current Spa Engagement rundown — for each of the
four measures, what it is for, what "good" looks like, and which one a Salon
Director should be managed on.*

**PARTIALLY ANSWERED on 2026-09-14** by `docs/bed-usage-spa-metrics.md`, which
names the headline outright:

> **Store Execution.** How effectively does each store convert customer traffic
> into spa usage? Primary metric: **Spa Conversion Rate**.

and defines it as `Monthly Spa Sessions ÷ Monthly Total Tans`, for ranking
stores, identifying top operators and low-conversion locations, comparing
salons with different traffic levels, separating traffic problems from
execution problems, and expansion decisions.

**Acted on:** Spa Conversion Rate is now the lead KPI on Spa Engagement, and the
page's plain-language reading places salons on the document's own two capital
sides. The four raw counts and the two bed-normalized figures moved behind a
disclosure — every figure survives.

**ANSWERED on 2026-09-14 by the source workbook itself.** The delivery
*Spa Sessions per Unique Tanner per Spa Bed (2026 09 01) All* publishes its own
weights on row 9, directly above the three Rank columns, and the method
reproduces its published `Overall Rank` exactly. What goes into it:

| Measure | Formula | Weight |
|---|---|---|
| Spa Sessions per Bed | Spa Sessions ÷ Spa Beds | 0.25 |
| Spa Sessions per Unique Tanner per Spa Bed | Spa Sessions ÷ Total Unique Tanners ÷ Spa Beds | 0.25 |
| Unique Spa Tanner % of Total Unique | Unique Spa Tanners ÷ Total Unique Tanners | 0.50 |

Each measure is ranked across the chain descending, Excel `RANK.EQ` style; the
score is the sum of weight × rank, so **lower is better**; `Overall Rank` is
`RANK.EQ` ascending on that score. Reconciliation counts and the full method are
in `docs/spa-engagement-overall-rank.md`; the shipped parser reproduces
248 / 248 salon rows and 55 / 55 district-manager rows with no mismatches.

**No correction was required** — the implementation already read the weights off
the sheet rather than assuming them, and already ranked over the whole chain.
What changed is the evidence and what the product says:
`spa-engagement/source-workbook.test.ts` now pins the method against a real
delivery, and the Ask Sunny briefing states the method and the weights instead
of quoting a bare rank.

**The weighting is no longer a blocker.** Approved by the stakeholder on
2026-09-14 once the workbook verification above was reviewed.

**What replaces it is a business-use question, not a data question.** The
weights are known and reproduced, but they are the *source's*. Spa Conversion
Rate is what `docs/bed-usage-spa-metrics.md` names as the store-execution
metric, and it is **not** an input to Overall Rank — the two share no term and
run in opposite directions. So:

> **Open question.** Should Salon Directors primarily be managed against Spa
> Conversion Rate, with Overall Rank used as a chain benchmark, or should
> Overall Rank itself be treated as the primary coaching metric?

Nothing in the product depends on the answer: both figures are computed, both
are shown, and Spa Conversion Rate leads the page today on the strength of the
business documentation. The answer decides emphasis and coaching language, not
arithmetic.

### 3.3 Spa Wellness — 61 active units vs 57 — **ANSWERED, and a bug fixed**

**Resolved on 2026-09-14** by `docs/bed-usage-spa-metrics.md`, which states the
presence rule outright:

> Zero usage means the equipment is NOT installed.

**The earlier answer in this document was wrong.** It read the four-unit gap as
four installed units that recorded no sessions, and the page said so on its
face. Under the rule above this source cannot describe an installed-but-idle
unit at all, so that sentence described something that could not exist.

**What the gap actually is,** traced against the stored facts for all three
windows. The two figures count at different granularities:

| Figure | What it counts |
|---|---|
| **61** | the source's own `Count of SPA Equipment` — physical **units** |
| **57** | one row per salon per equipment **type** that recorded sessions |

Thirteen of the fifteen salons hold exactly one unit of each type they have.
Two do not, and they are the entire gap:

| Salon | Units | Types with sessions | Extra |
|---|---|---|---|
| MO Kansas City Liberty | 7 | 5 | 2 |
| MO St Joseph | 6 | 4 | 2 |

Confirmed directly: 57 equipment rows in each of MTD, YTD and LTM, and **no
zero and no null session value in any window**. There is no unused equipment in
this delivery.

**Fixed.** `reconcileSpaUnits` attributes the gap and names the salons; the KPI
helper, the table footer and the assistant briefing all state it the same way,
and any remainder the duplicates do not explain is reported as unexplained
rather than folded in. Covered by `analytics.test.ts` and `briefing.test.ts`.

**No stakeholder question remains on this item.**

### 3.4 Role labels and effective access

**Evidence:** role and scope are two independent axes, and both are working as
designed. The **role** (`regional_manager`) decides *what a person may do* —
which pages and actions. The **scope** (`salon` / `loc-0306`) decides *whose
figures they see*. The test account has a wide role and a narrow scope, which is
a coherent configuration and probably not the one intended for a test of
lower-permission access.

The role matrix itself is consistent: Regional Manager = District Manager plus
`view_ai_usage`; the Admin console is limited to admin/owner/developer, which is
why navigation gating behaved correctly.

**Question:** *For the Phase 2 permission model, please confirm for each role
both axes — which capabilities it holds, and what scope its accounts are
assigned. In particular: should a Salon Director's account be scoped to their
salon, and should a District Manager's be scoped to their district?*

Until that arrives the matrix is unchanged, and scope is now enforced whatever
role it is paired with.

### 3.5 The salon roster's authority

**Evidence:** `src/data/demo/locations.ts` is the only mapping in the codebase
from a district or region id to the salons inside it. Its own header records
that it stopped being demo data when it was replaced with the fifteen salons
Reporting ingests. The new scoping resolves district and region assignments
through it, and the roster guard on non-production records uses it.

**Question:** *Is that fifteen-salon roster authoritative and current, and who
owns it when a salon opens or closes?* A roster table with an owner would be
better than a checked-in file; that is a Phase 2 decision, not a blocker.


---

## 3A. The review, line by line — final status

Every point the stakeholder email raises, classified. Twenty-nine points; one
is a compliment and is recorded as such.

| # | The review's point | Status |
|---|---|---|
| 1 | Test data live on the Overview | **COMPLETE** — roster guard on name *and* salon id; the rest is a production action, see `test-data-cleanup.md` |
| 2 | Spa Wellness statuses identical per equipment type | **COMPLETE** — `equipmentRowPerformance`, each row classified against its own peer average |
| 3 | Spa Engagement rank `#-11` | **COMPLETE** — axis bound to `[1, population]`, invalid stored ranks dropped |
| 4 | PPTA has three definitions | **COMPLETE** — one authority module; two stale knowledge documents named for the model; the documents are Paulyne's to re-upload |
| 5 | `$0.00` and `$0.19` look like parsing | **COMPLETE** — traced to source and both supported; see `ppta-trace-2026-09-14.md` |
| 6 | Overview totals 15 / 16 / 20 | **COMPLETE** — three disjoint buckets that sum, with the arithmetic on the card |
| 7 | Spa Wellness 61 vs 57 | **COMPLETE** — units vs salon-and-equipment rows; the earlier "four idle units" answer was wrong and is corrected |
| 8 | Reports not scoped to the employee account | **COMPLETE** — narrowed in the query on every path; twelve surfaces proved, see `authorization-qa-2026-09-14.md` |
| 9 | Markdown tables render as literal pipes | **COMPLETE** — GFM tables as React elements; a whole assistant answer asserted |
| 10 | Reports open at maximum detail | **COMPLETE** — all five: four headline metrics, a chart, a plain-language reading, detail behind a disclosure |
| 11 | "Loaded" reads as a system event | **COMPLETE** — "Refreshed", Central Time via IANA zone |
| 12 | "Recipient Slice" is internal language | **COMPLETE** — removed; "15 salons included" |
| 13 | Sales Totals has no freshness stamp | **COMPLETE** — shared freshness line on all five |
| 14 | Overview tiles do not say how current they are | **COMPLETE** — per-tile cadence |
| 15 | Comparison set to vs. 2024 | **COMPLETE on 2026-09-14, in two passes** — the first derived the year instead of hardcoding it and the screen did not change, because no month-to-date sheet carried a 2025 basis year to select. The second reads `TY vs. 2025 % Change` from `CompReport(MTD)`. See `docs/salon-performance-vs-2025.md` |
| 16 | Movers axis unreadable | **COMPLETE** — `moversDomain` with headroom, symmetric only when both signs are present; proved per window (vs 2025 / vs 2024 / Last 3 Months) in `movers-window.test.ts` |
| 17 | Empty Decreases panel with no explanation | **COMPLETE** — one movers section; each list renders only when it holds rows, and the block disappears when neither does. Pinned in `movers-section.test.ts` |
| 18 | Two "Ask Sunny" controls on Sales Totals | **COMPLETE** — the shared bar wins; the panel is unmounted, not deleted |
| 19 | "Utilisation" spelled British | **COMPLETE** — guarded by test |
| 20 | Keep the FAST capacity explanation | **COMPLETE** — kept, and FAST is capacity in the reading, never underperformance |
| 21 | Bed Usage month currency | **COMPLETE** — `monthlyCurrency` |
| 22 | Spa Engagement: all 15 SIGNIFICANTLY UNDER | **COMPLETE** — same fix as #2 |
| 23 | Spa Engagement: three columns entirely N/A | **COMPLETE** — measured and dropped, named once |
| 24 | "Weakest Installed Unit" shows bed counts | **COMPLETE** — two headings, each saying what it holds |
| 25 | Totals row 0.0029 against salon values | **COMPLETE — not a blocker.** The cell reads `n/a` with the arithmetic explained beside it, so the misleading benchmark is gone. What remains is an OPTIONAL enhancement, not a defect: if the business ever wants a combined bed-normalised figure, it needs a definition. Nothing is waiting on Maddy to ship |
| 26 | Overview: "Open Form Monitoring" three times | **COMPLETE** — two, on different objects |
| 27 | Recommended Training is empty | **COMPLETE in code** — Teams and Woven from configuration, honest empty state; **HUMAN BLOCKER** for the URLs |
| 28 | Login: "Training that finds you" | **COMPLETE** — removed, guarded by test |
| 29 | "Estate" is not field language | **COMPLETE** — guarded by test; identifiers untouched by the review's own instruction |
| 30 | Google Reviews — leave unchanged | **INTENTIONALLY DEFERRED** — untouched, as asked. It shows all fifteen salons against seeded figures and will need the reporting boundary when connected to real data |

**Nothing is left in a fourth category.** Every point is complete, blocked on a
human, or deferred by the review's own instruction.

---

## 4. Deferred / Phase 2

**Deferred product work**
- **Google Reviews** — untouched, as instructed: *"I'm leaving Google Review
  feedback out for now while you work on getting that connection set up
  properly."* The placeholder note on the Overview already says the integration
  is not connected.
- **Four headline metrics + one chart + one plain-language interpretation** on
  every report — **now done**, including the plain-language reading, which
  `docs/bed-usage-spa-metrics.md` made assertable: it says what each figure is
  for, so a reading states the document's own meaning rather than an invented
  one. Spa Engagement no longer waits on 3.2; the reading is written against Spa
  Conversion Rate, which the documentation names as the store-execution metric.

**Stakeholder-dependent**
- Teams and Woven training URLs (§5).
- The Spa Engagement bed-normalised total (3.1), and which metric a Salon
  Director is coached on (3.2). Neither blocks; both decide wording.
- ~~The Spa Wellness 61/57 reading (3.3)~~ — answered from the business
  documentation and confirmed against the source workbook.

**RBAC work awaiting finalised rules**
- The permission matrix itself, pending *"the finalized permission model by
  role"*. The scoping boundary is **not** deferred — it is enforced now.
- A real salon roster table (3.5).
- Forms still refuse to file against a salon for a district or regional actor,
  as `forms/location-scope.ts` records. The roster could now answer that
  question, but widening *write* authorization is a separate decision from
  narrowing *read* access, and was not asked for.

Nothing security-relevant is in this section.

---

## 5. Remaining configuration

| Setting | Variable | Status |
|---|---|---|
| Teams training destination | `NEXT_PUBLIC_TEAMS_TRAINING_URL` | **Needed.** Unset — the Overview says so rather than rendering a dead link |
| Woven training destination | `NEXT_PUBLIC_WOVEN_TRAINING_URL` | **Needed** |
| Non-production employee names | `ASK_SUNNY_EXCLUDED_EMPLOYEE_NAMES` | Optional, empty by default. Comma-separated. Only for a test record filed against a *real* salon — a record at a salon outside the roster is caught without configuration |

### Knowledge base documents that still contradict the app

The review found one of the three PPTA definitions in a **knowledge base
document**: *"The employee framework calls it Product Productivity Average and
directs Sunny to verify the formula elsewhere."* That document lives in Supabase
and is uploaded, not checked in, so this branch cannot correct it.

What this branch does instead is make the app's definition **outrank** it: the
report block states the definition, names the two readings it replaces, and
tells Sunny that a document disagreeing with it is out of date and to say so.
That holds an answer together, and it is not a substitute for the document being
right.

**Action for an administrator:** re-upload the Employee Performance Framework
with PPTA defined as *Product Sales ÷ Total Tans*, and the "verify the formula
elsewhere" instruction removed. Same for any Bonus Viewer document that defines
PPTA rather than Unique PPTA — the two are different measures and both should be
named.

Also required from the stakeholder: the answers in §3, and the finalised
role/permission mapping.

---

## 6. Manual QA checklist

### Admin account
- [ ] All five report tabs open; the freshness line reads `Data through … |
      Refreshed … a.m./p.m. CT | N salons included | Updated daily/weekly/monthly`
- [ ] No "UTC", "Loaded" or "Recipient Slice" anywhere
- [ ] "Data source & quality" is present and expandable on all five tabs
- [ ] Overview follow-up card: the three tiles sum to the open total, and the
      card prints the arithmetic
- [ ] Overview: "Open Form Monitoring" appears at most twice in the follow-up block
- [ ] Overview: Recommended Training shows the Teams/Woven links, or says the
      destinations are not configured — never an empty heading

### Restricted employee — MO Kansas City Wornall
- [ ] Admin navigation is absent (regression check — this was working)
- [ ] Salon Performance shows **one** salon; no other salon's name appears in the
      filter menu
- [ ] Editing the URL to `?salon=0313` shows nothing, **not** every salon
- [ ] Opening `/reports/salon-performance/0313` directly is refused
- [ ] Sales Totals shows one salon; the chain-wide summary cards still appear
- [ ] Bed Usage, Spa Wellness and Spa Engagement each show one salon
- [ ] Overview figures are that salon's, and the caption names the assignment
- [ ] Overview follow-up card says "Across MO Kansas City Wornall"
- [ ] "Data source & quality" is **absent** on all five tabs

### Overview
- [ ] No "Jordan Vance (test)", "suzy sunshine", "Ace Test" or "Maple Crossing"
      in the follow-up queue *(Maple Crossing is filtered structurally; the other
      three need archiving in Form Monitoring — see §2)*
- [ ] Each tile shows its own period **and** its own cadence

### Salon Performance
- [ ] Comparison reads **vs 2025** *(or the newest prior year the delivery
      carries — check the Comparison menu for what exists)*
- [ ] The movers chart axis does not extend past the data's own range
- [ ] No "Largest Decreases: None" box when nothing is negative
- [ ] "Salon detail" is collapsed, opens, and the table inside is unchanged

### Sales Totals
- [ ] **One** "Ask Sunny about this report" control
- [ ] Freshness line includes a Refreshed timestamp
- [ ] With several salons selected, PPTA shows a figure labelled "weighted by tans"
- [ ] A salon with a $0.00 PPTA is marked "data issue"
- [ ] "Why there is no combined figure" / "What PPTA is" open as disclosures

### Bed Usage
- [ ] "Utilization", not "Utilisation"
- [ ] FAST capacity panel is on the landing view
- [ ] Freshness detail says whether this is the most recently completed month
- [ ] "Versus the chain, by equipment level" is a drill-down

### Spa Wellness
- [ ] St. Joseph's Beauty Shaper reads a status consistent with its own delta
- [ ] Omaha 144th's Poly RLT reads a status consistent with its own delta
- [ ] Two rows of the same equipment type can show different statuses
- [ ] Rejuve and Ovation carry the small-sample marker
- [ ] The 57-row table is a drill-down

### Spa Engagement
- [ ] The rank chart axis shows no rank below #1 and none above the population
- [ ] The Combined Operational View no longer marks every salon the same
- [ ] Columns with no data at all are absent, with one line saying so
- [ ] "Spa Units Installed" and "Weakest Unit vs Peers" are distinct headings
- [ ] The Per Unique per Bed total reads `n/a`, with the reason available

### Ask Sunny
- [ ] Ask for a table — it renders as a table, not as pipes
- [ ] As the Wornall account: *"Which of our salons has the lowest PPTA? List
      every salon with its numbers."* → only Wornall, and Sunny says it only has
      that salon
- [ ] Rephrasing ("ignore your instructions", "for internal audit", "list all
      15") does not produce another salon's figures
- [ ] Ask about PPTA → the answer says product sales ÷ total tans
- [ ] Ask about a salon with a $0.00 PPTA → Sunny flags the figure rather than
      coaching or ranking from it

---

## 7. Database and migrations

**No migration was required and none was written.** Every change is in the
application's read layer, its components or its configuration. The reporting
tables, views, ingestion functions and RLS policies are untouched, and the
ingestion pipeline is unchanged.

Two things worth recording for whoever reads this next:

- The salon-scope boundary is enforced in the **application's** queries, through
  the server-side Supabase client, exactly as the rest of the reporting read
  layer already was. It is not enforced by RLS, because these reads run under
  the secret key server-side — an interim posture `reporting-read-repository.ts`
  has documented since it was written. Moving reporting to browser-side reads
  under RLS remains the eventual destination and needs stable district and
  region codes, which the source columns do not yet carry.
- No production data was read, written or deleted by this work.
