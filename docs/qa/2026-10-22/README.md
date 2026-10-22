# Ask Sunny — QA record for the 22 Oct 2026 full release

| File | What it is |
|---|---|
| `PRE_MERGE_QA_REPORT.md` | Final pre-merge QA: results, release decisions, security review, the overlapping pull request, risks, verdict |
| `QA_SUMMARY.md` | Every QA finding fixed in this release, with its commit; changed test expectations; what is deferred |
| `RELEASE_DECISIONS.md` | The owner's release decisions and the tests that enforce them |
| `POST_DEPLOY_SMOKE_TESTS.md` | Checks to run on production after the deploy (synthetic accounts, drafts only), and the rollback |
| SUNNY_ROLES_AND_SALON_NUMBERS.md, SUNNY_UI_TIMEOUT_FIX.md | Supporting analysis |
| `evidence/` | Final validation of the release head (suite, typecheck, lint, build, local database, Playwright logs and screenshots), regression probes, isolation check, release-decision and payroll test log, and the overlapping pull request's trial merge |

All evidence uses synthetic data. Local machine paths are replaced with placeholders (`<repo>`, `<qa-scratch>`, `<local-stack>`).

**Earlier QA material.** The fuller QA record from 22 Oct covered both sibling apps: initial findings, superseded runs and intermediate evidence. It was removed from this folder at the pre-merge review because it carried the other company's details. It remains in this branch's history under `docs/qa/2026-10-22/` at commit `0df223e`. Squash-merging the release keeps it out of `main`.
