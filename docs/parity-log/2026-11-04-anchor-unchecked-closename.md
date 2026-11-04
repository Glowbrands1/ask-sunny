# FORM_NAME_FROM_ROSTER_ENABLED: `anchorsOnRoster` has no "unchecked with a close name" branch here

**Difference.** In the sibling app, `anchorsOnRoster` (`src/lib/forms/roster-shape.ts`) also returns true for `match.kind === "unchecked" && Boolean(match.closeName)`. Here it returns true only for `exact` and `confirm`.

**Why it is intentional.** This app's `matchEmployeeName` (`src/lib/forms/employee-match.ts`) never puts a `closeName` on an `unchecked` result; its type is `{ kind: "unchecked" }`, returned only for an empty roster or a name the manager already kept. The sibling app's matcher, with its TYPED_NAME flag on, returns `unchecked` with a `closeName` when exactly one roster name is close to the typed one (a single close match is not asked about there; the card keeps the typed spelling), so it needs the extra branch to keep that near-miss as an anchor. This app has no such branch in its matcher: a single close match is `confirm`, which `anchorsOnRoster` already counts. Here the branch could never be taken, so the two apps behave the same for the anchor.

**If this app's matcher ever adds `closeName` to `unchecked`, add the branch here too.** (QA review of #513, 4 Nov 2026.)
