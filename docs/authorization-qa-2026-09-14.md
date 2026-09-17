# Authorization QA — an account scoped to MO Kansas City Wornall

**Test subject:** `regional_manager`, status `active`, `scope_level = salon`,
`scope_primary_area_id = loc-0306` → resolves to salon number `0306`,
MO Kansas City Wornall. This is the live account configuration in
`app_users`; the other four accounts are `global` admins.

**The requirement, verbatim from the review:**

> The assistant must not receive unauthorized structured report data and then be
> told through a prompt not to mention it. Prevent the unauthorized data from
> being retrieved in the first place.

So the bar is not "the screen hides it". The bar is **the rows are never read**.

---

## 1. Result by surface

| # | Surface | Boundary | Verdict | Evidence |
|---|---|---|---|---|
| 1 | Salon Performance | `salon_number` narrowed in query, and the URL's salon selection intersected with the allowlist **before** canonicalization | **PASS** | `report-context-scope.test.ts` |
| 2 | Sales Totals | single `or` predicate admitting chain summary rows + allowed salons only | **PASS** | `read-enforcement.test.ts` |
| 3 | Bed Usage | `.in("salon_number", …)` on every fact and period query | **PASS** | `read-enforcement.test.ts` |
| 4 | Spa Wellness | same, on salon facts, equipment facts and the period menu | **PASS** | `read-enforcement.test.ts` |
| 5 | Spa Engagement | same | **PASS** | `read-enforcement.test.ts` |
| 6 | **Ask Sunny model context** | scope threaded into all three loaders; finished briefing text contains no other salon's name or number | **PASS** | `model-context-leak.test.ts` |
| 7 | Overview — follow-up queue | `.in("location_id", …)` in the query | **PASS** | `read-enforcement.test.ts` |
| 8 | Overview — report tiles | built from the scoped reporting read | **PASS** | `overview.ts` early-returns on an empty allowlist |
| 9 | Period menus | narrowed too, so no unopenable period is offered | **PASS** | `read-enforcement.test.ts` |
| 10 | Chain benchmarks | deliberately **not** narrowed — they name no salon | **PASS (by design)** | `read-enforcement.test.ts` |
| 11 | Global search | lists all 15 salon **names** to any signed-in user | **NOTED — roster, not figures** | §4 |
| 12 | Google Reviews | shows all 15 salons | **OUT OF SCOPE by instruction** | §4 |

## 2. The two properties that make it fail closed

Both are now pinned by tests, because confusing them is the one mistake here
that turns a restriction into full access:

- **`null` means unrestricted; `[]` means restricted to nothing.** An account
  with no assignment resolves to `[]` and sees no salon — never the whole
  estate.
- **An area the roster cannot resolve yields `[]`**, not `null`.

## 3. How surface 6 is proven, and why the query tests are not enough

A predicate test says nothing about a benchmark row carrying a store name, a
period menu built by a second query, a delivery's own salon-count, or a briefing
header naming the estate. None of those is a fact row, and every one is a real
place a name could arrive from.

So `model-context-leak.test.ts` runs the **whole briefing** — all five families —
against a fake database that **holds all fifteen salons and honours the
predicates it is given**, then asserts on the finished text, the exact bytes
handed to the model:

1. none of the other fourteen salon **names** appears;
2. none of their **numbers** appears (a number is the key a follow-up query
   would use, so leaking `0495` is as much a disclosure as "MO St Joseph");
3. Wornall's own figures **are** present — a boundary that returned nothing
   would pass 1 and 2 and be useless;
4. the model is told the view is scoped, that the other rows **were not read**
   (not "hidden" — a model told rows are hidden offers to fetch them), and never
   to estimate or reconstruct one;
5. **the control:** an unrestricted reader through the same fake **does** see all
   fourteen. Without this, every assertion above would pass against an empty
   string, a throwing loader, or a fake returning no rows, and the suite would
   report a boundary it never exercised.

Remove any single `.in(...)` from `read.ts` and test 1 fails on the name that
appears in the output.

## 4. The two surfaces that are not report data

**Global search (surface 11)** lists all fifteen salon names, cities and
districts to any signed-in user, linking to Google Reviews. This is the
**roster**, not figures — the company's own list of its salons, which every
employee knows — and no metric is attached. It is a **policy question rather
than a defect**, and it belongs with the open question in
`stakeholder-review-2026-09-14.md` §3.4:

> *Should a Salon Director be able to see that other salons exist, by name, in
> search?*

Not changed here, because narrowing it is a decision about what scope *means*
for non-reporting surfaces, and that is the stakeholder's to make. Flagged
rather than quietly done.

**Google Reviews (surface 12)** shows all fifteen salons with seeded review
counts, ratings and progress — invented figures, per `src/data/demo/reviews.ts`.
The review said explicitly to leave Google Reviews unchanged, so it is
untouched. When it is connected to real review data, it will need the same
boundary the reports now have.

## 5. What was NOT accepted as proof

- **A test on returned rows.** It would pass against an implementation that
  reads everything and filters in memory — which satisfies the screen and not
  the requirement, and leaves the rows one logging statement or one
  serialisation bug from escaping.
- **A prompt instruction.** The review ruled this out by name.
- **RLS alone.** The reporting reads use the secret key and bypass RLS by
  design; the boundary has to be in the query the server builds.

## 6. Manual QA still worth doing

Automated tests prove the read layer. A human should still sign in as the
Wornall account once and confirm:

- each of the five reports renders with one salon and says so;
- the Overview counters and the follow-up queue show only Wornall's records;
- asking Sunny "how do all our salons compare?" gets a plain "I only have your
  assigned salon" rather than an estate answer;
- no salon filter dropdown offers a salon the account may not open.

Listed in `stakeholder-review-2026-09-14.md` §6.
