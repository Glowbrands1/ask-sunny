# The salon roster as an authorization source — technical audit

`src/data/demo/locations.ts` is the only mapping in the codebase from a district
or region id to the salons inside it. Since scope enforcement was added it
decides **which salons' figures a person may read**. This audit answers the
questions asked of it.

## 1. Is it genuinely demo data?

**No.** The roster is real and current. Its own header records the change: it
used to hold twelve invented Kentucky/Indiana/Tennessee stores, and was replaced
with the fifteen salons Reporting ingests.

Verified against the live delivery — all fifteen salon numbers and all fifteen
store names match `sales_totals_current_facts` **exactly**, with no extras on
either side:

    0306 0307 0309 0310 0311 0312 0313 0314 0394 0410 0462 0463 0468 0476 0495

What is still demo in `src/data/demo` is everything *attached* to these salons —
seeded review counts, revenue, coaching forms, employee names. Only the roster
is real.

## 2. Why is it still called `demo`?

Historical. The file was renamed in content and not in path, and the path is
what every reader sees first. That has a concrete cost: several call sites carry
comments saying "`DEMO_LOCATIONS` is seeded demo data, not an authority" and
decline to use it — written when that was true, and now wrong about the roster
while still right about the metrics in neighbouring files.

**Recommendation (Phase 2, not done here):** move the roster to
`src/data/salons.ts` and leave the seeded metrics behind in `src/data/demo`. It
is a rename across ~20 call sites with no behaviour change; it is out of scope
for a stakeholder-review branch and wants its own diff.

## 3. Is it used in production paths?

Yes, in four kinds of place:

| Use | Path | Consequence if wrong |
|---|---|---|
| **Authorization** | `reporting/scope/authorized-salons.ts` | who sees which salon's figures |
| Non-production filter | `forms/production-records.ts` | which records reach the Overview queue |
| Scope assignment UI | `features/admin/users-screen.tsx` | what an admin can assign |
| Display | `session-context`, global search, forms/create | labels only |

## 4. How does it relate to `app_users`?

`app_users` stores `scope_level`, `scope_primary_area_id` and
`scope_also_covers_area_ids`. Those area ids are **resolved through this file**.
The database holds the assignment; the file holds what the assignment means.

Live state — five accounts, all resolvable:

| Role | Status | Scope | Resolves to |
|---|---|---|---|
| admin × 4 | 2 active, 2 invited | `global` | unrestricted (roster not consulted) |
| regional_manager × 1 | active | `salon` / `loc-0306` | `0306`, MO Kansas City Wornall |

No account currently holds a district or region scope, so the roster's mapping
is not load-bearing for any live user **today**. It becomes load-bearing the
moment a District Manager account is created.

## 5. Relation to report salon names

Scoping is by **number**, not name: `loc-0306` → `0306`, matched against the
`salon_number` column. A rename therefore cannot break authorization.

It can break two other things:

- **The non-production record guard** matches records to the roster by *name*.
  If a salon is renamed in the source and not here, its real records stop
  matching the roster and could be treated as non-production.
- **`scopeAreaLabel`** would show the old name in the "you are seeing" sentence.

## 6. What happens when a salon is added, moved, closed or renamed?

| Event | Effect if the roster is not updated | Direction |
|---|---|---|
| **Salon added** | absent from its district's allowlist → its rows are never read for that district's manager | **Hidden** — safe, wrong |
| **Salon closed** | allowlist names a salon with no rows; the `in` predicate matches nothing | Harmless |
| **Salon renamed** | scoping unaffected; name-matched record guard and labels drift | Cosmetic + record-guard risk |
| **Salon moved between districts** | the manager of the district it **left keeps seeing it** | **EXPOSURE** |

**The move is the only case that shows somebody figures they should not have**,
and no test can catch it: the file stays internally consistent and simply
disagrees with the world. That is the argument for a roster with a named owner
rather than a checked-in file.

A **salon-scoped** user is immune to all four. `salonNumberOf` parses the number
out of the id and never reads the roster, so the one non-admin account in the
deployment is correct regardless of roster state.

## 7. Could a stale roster *expose* data?

**Only via case 4 above** — a salon that changed district. Every other staleness
fails closed (hides rows) or is inert.

Two properties keep the blast radius small, and both are now pinned by tests:

- an **unknown** area id resolves to an empty allowlist (restricted to nothing),
  **not** to the `null` that means unrestricted;
- `global` is the only level that returns `null`, and it never consults the
  roster.

## 8. What was added on this branch

`src/data/demo/locations.test.ts` — ten checks, because a file that decides who
sees what must not be hand-editable without one. It fails the build on: an id
`salonNumberOf` cannot parse (which would lock a Salon Director out of their own
salon); a duplicate id, number or name; a `districtId`/`regionId` that names no
record (the salon then belongs to no manager, silently); a salon whose region
contradicts its district's region (district and region scopes would disagree
about it); a denormalized label that drifted from the record it copies; a
district or region with no salons (a manager assigned to it gets a blank report
with no explanation); an area id `areaLabel` echoes back as a raw id.

Plus the three end-to-end properties: a district scope resolves to exactly that
district's salons, an unknown area authorizes nothing, and a salon scope does
not consult the roster.

## 9. Open question for the stakeholder

Unchanged and now better evidenced — see `stakeholder-review-2026-09-14.md` §3.5:

> *Is the fifteen-salon roster authoritative and current, and who owns it when a
> salon opens, closes or moves district?*

The audit adds the reason it matters: **a salon moving district is the one
staleness that exposes data**, and it is the one no test can detect.
