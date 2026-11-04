# FORM_NAME_FROM_ROSTER_ENABLED: `anchorsOnRoster` has no "unchecked with a close name" branch here

**Difference.** In the sibling app, `anchorsOnRoster` (`src/lib/forms/roster-shape.ts`) also returns true for `match.kind === "unchecked" && Boolean(match.closeName)`. Here it returns true only for `exact` and `confirm`.

**Why it is intentional.** This app's `matchEmployeeName` (`src/lib/forms/employee-match.ts`) never puts a `closeName` on an `unchecked` result; its type is `{ kind: "unchecked" }`, returned only for an empty roster or a name the manager already kept. The sibling app's matcher returns `unchecked` with a `closeName` when it ranks a near spelling of a kept typed name, so it needs the extra branch. Here the branch could never be taken, so the two apps behave the same for the anchor.

**If this app's matcher ever adds `closeName` to `unchecked`, add the branch here too.** (QA review of #513, 4 Nov 2026.)
