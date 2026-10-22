# Final release readiness — Ask Sunny (22 Oct 2026)

## 1. Branch and commit
Branch `claude/charming-goldberg-2lg2uq`. Code head `64b111a`; this document is committed after it.

## 2. Pull request
[Glowbrands1/ask-sunny#131](https://github.com/Glowbrands1/ask-sunny/pull/131) into `main`. The release session merges it; this branch's session does not.

## 3. Integration with `main`
* The branch is 0 commits behind `main` (`673e681`, the current production). Merge commits only; no rebase or force-push.
* Conflicts with `main`'s full release were resolved by keeping both sides.
* One integration fix: "Which date goes on the form?" is no longer asked after the manager has corrected the incident date (QA e2e Q21).
* No migrations, no environment variables, no `vercel.json` or dependency changes.

## 4. Scope
* **Included:** flexible CA requests and follow-ups; chat date corrections on an open CA draft (with audit events and `form_date` sync); idempotent Create; policy-source standing with "requires owner confirmation" where no owner confirmed the manual.
* **Removed** (owner decision, 22 Oct 2026): the manager-confirmed warning level. `finalizeInstance` and the instance route are identical to `main`.

## 5. QA
* Typecheck is clean, and lint has 0 errors.
* Forms, AI and chat suites pass on the final code.
* The full suite runs in CI on the PR.
* The QA e2e file asserts on the saved form, its events and the record row.
* On a local Postgres with the real migrations: duplicate id 23505, finalized values refused 23514, browser roles refused 42501.
* This repo has no browser suite (NOT TESTED).
* Live model, a live database through the app, and a live browser on the CA flow: **NOT TESTED**. There is no isolated staging, and the owner approved release without it.

## 6. Policy manual
**Requires owner confirmation, and this does not block release.**

* `ce6b00f1`, "JBA Policy Manual Edited 5.2025", applies to STC by its own text, but it is untagged.
* Its citations say "requires owner confirmation", and the 2024 edition is never chosen in its place.
* To approve it, an owner tags it `official-policy-manual` in the Knowledge Base.

## 7. Existing drafts
None are affected: the level and Finalize work as before. Citations stored before this release keep working. Older Sunny citations read as unconfirmed, as they should.

## 8. Deployment and rollback
* **Deploy:** merge the PR; Vercel deploys `main`. Then confirm the deployment is READY on the merge SHA and check runtime errors.
* **Rollback:** promote `dpl_6LerSUMQ4ZoYFN8tXyZLDBWUgyZJ` (`673e681`) in Vercel. It is instant, and there is no schema to undo.

## 9. Recommendation
**READY FOR PRODUCTION** on the owner's approval (22 Oct 2026, no staging), once CI is green. Live checks after deploy are read-only.
