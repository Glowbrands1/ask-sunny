# Release — 14 September stakeholder review

## What shipped

| | |
|---|---|
| Feature branch | `feature/ask-sunny-stakeholder-review-sep14` |
| Feature HEAD | `c42b79a` |
| **Rollback point** (`origin/main` before) | **`7c137a5`** |
| Merge commit / new `origin/main` | `c4a8422` |
| Commits merged | 19 + merge commit |
| Diff | 114 files, +13,064 / −895 |
| Merged | 2026-09-14, `--no-ff`, repo's own convention. No force-push, no history rewrite. |

`main` had **not** moved since the branch was cut, so the merge was a clean
no-fast-forward with no conflicts and nothing to integrate.

## Verification at merge

Run on the feature branch, then **again on the merged `main`** before pushing:

| Check | Result |
|---|---|
| Test suite | 5,654 passed · 37 skipped · 233 files |
| Typecheck | clean |
| Lint | clean, `--max-warnings=0` |
| Production build | compiles |
| `git diff --check` | clean |

## Rolling back

Nothing destructive shipped: no migration, no schema change, no production data
written. To revert, `git revert -m 1 c4a8422` — the merge commit — which returns
the tree to `7c137a5` while keeping the history. Prefer that to resetting
`main`.

## Not done in this release, and why

| Item | Why |
|---|---|
| Archive the eight test records | Needs an authenticated session holding `manage_form_records`. Ad hoc SQL was explicitly ruled out. `docs/test-data-cleanup.md` has the ids and the approved `PUT`. |
| Re-upload the two PPTA knowledge documents | Needs an authenticated Knowledge upload. Sources located in Storage; one is a `.docx`. See `docs/ppta-knowledge-base-conflicts.md`. |
| Teams / Woven training URLs | No authoritative value exists in the repo, the environment or any connected source. Not invented. The unconfigured state is graceful and tested. |
| Production deployment verification | **Blocked two independent ways** — see below. The push to `origin/main` is confirmed server-side on GitHub. |
| Spa Engagement Overall Rank weighting | Undocumented business logic. Deliberately not invented; the safe implementation stands — Spa Conversion Rate is the documented primary KPI, and undefined combined figures read `n/a`. |


## Commit identities, so the two SHAs are not confused

| SHA | What it is |
|---|---|
| `7c137a5` | `origin/main` **before** the release. The rollback point. |
| `c42b79a` | The feature branch's final commit. |
| `c4a8422` | The **merge commit**. Two parents: `7c137a5` and `c42b79a`. This is the commit that put the review on `main`. |
| `74c7eca` | A docs-only follow-up adding this file. **The current `origin/main` HEAD.** |

`74c7eca` is a descendant of `c4a8422`, so `origin/main` contains the whole
release. Revert `c4a8422` (with `-m 1`) to undo the code; `74c7eca` carries no
code.

## Why production could not be verified from this session

Two independent blocks, neither of them a fault in the release:

1. **Egress policy.** The session's proxy answers `403` to `CONNECT
   ask-sunny.vercel.app:443` — an organization egress denial, recorded in the
   proxy's own failure log. The proxy documentation is explicit that such a
   denial must be reported rather than routed around.
2. **Vercel access.** The token authenticates and sees the `Glo Brands` team,
   but `list_projects` returns empty, `get_project` 404s on the `ask-sunny`
   slug, `get_deployment` 404s on the hostname, and the Vercel fetch tool
   cannot create a share link. The token has team-read and no project-read.

So the running deployment's `/api/health` could not be read, and whether Vercel
built `74c7eca` could not be observed.

## What production WILL report, from the code

Worth stating because this exact failure happened once before, and the fix is
already in `main` and untouched by this release.

`modeSource()` returns `production-deployment` whenever
`NEXT_PUBLIC_VERCEL_ENV === "production"`, and that **overrides
`NEXT_PUBLIC_DEMO_MODE` entirely** — including an explicit `"true"`. The comment
in `lib/config/runtime.ts` records why: production once served
`{"mode":"demo","configured":true}` from this very hostname with every
credential present, because one build-time string had gone stale. A
`NEXT_PUBLIC_` value is frozen into the bundle at build time and no read
recovers the runtime value, so the flag was the wrong thing for production to
depend on.

Therefore a Production deployment reports `mode: "live"` and the real Anthropic
provider **unless** `NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION` is set to `true` —
the one deliberate, default-off escape hatch. Covered by `providers.test.ts`.

**The single check:** open `https://ask-sunny.vercel.app/api/health` and confirm
`mode: "live"`, `deploymentEnvironment: "production"`, and
`qa.assistant.provider: "claude"`. If it says `demo`, the cause is
`NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION` being set — not the flag, and not this
release.
