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
| Production deployment verification | The Vercel token for this session sees the `Glo Brands` team but zero projects, so the deployment could not be observed. The push to `origin/main` is confirmed on GitHub. |
| Spa Engagement Overall Rank weighting | Undocumented business logic. Deliberately not invented; the safe implementation stands — Spa Conversion Rate is the documented primary KPI, and undefined combined figures read `n/a`. |
