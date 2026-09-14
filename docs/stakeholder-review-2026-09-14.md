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

Five items. Each states what is ambiguous, what was found, and the exact
question.

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

### 3.2 Spa Engagement — is the report's own definition current?

The review asks: *"Do I need to provide an updated rundown of this report for us
to update in knowledge base?"*

**Yes, and specifically:** the four formulas the code implements were verified
against the workbook's own columns for all 248 salons, so the *arithmetic* is
not in doubt. What is undocumented is the **interpretation**: what a manager
should do with each of the four, which of them is the headline, and whether the
published Overall Rank's weights are the ones the business wants managers
coached against.

**Question:** *Please send the current Spa Engagement rundown — for each of the
four measures, what it is for, what "good" looks like, and which one a Salon
Director should be managed on.*

### 3.3 Spa Wellness — 61 active units vs 57

**Evidence:** these are two real and different counts. **61** is the sum of
`equipment_pieces`, the count of installed units the source reports per salon.
**57** is the number of units that recorded *use* in the period — the table has
one row per installed, used unit, and writes no row for a unit with no sessions.
So four installed units recorded no sessions in the window.

**That is a finding, not a bug** — an idle spa unit is exactly the sort of thing
this report exists to surface — but it is only a finding if "installed but
unused" is what it means, rather than a gap in the source's use data.

**Question:** *When a salon reports an installed spa unit with no sessions in the
period, does that mean the unit was genuinely unused, or that its usage was not
captured? If the former, should the report call those units out?*

The page now reconciles them on its face: the KPI is "Spa Units Installed" and
says how many recorded no sessions, and the table footer reads "N units with
sessions". Neither figure is changed.

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

## 4. Deferred / Phase 2

**Deferred product work**
- **Google Reviews** — untouched, as instructed: *"I'm leaving Google Review
  feedback out for now while you work on getting that connection set up
  properly."* The placeholder note on the Overview already says the integration
  is not connected.
- **Four headline metrics + one chart + one plain-language interpretation** on
  every report. The drill-down half is done and the headline/chart half already
  existed on each tab. What is *not* done is a written plain-language
  interpretation per report: writing one means asserting what the numbers mean,
  and for Spa Engagement in particular that depends on 3.2.

**Stakeholder-dependent**
- Teams and Woven training URLs (§5).
- The Spa Engagement bed-normalised total (3.1) and rundown (3.2).
- The Spa Wellness 61/57 reading (3.3).

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
