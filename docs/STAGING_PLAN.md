# Staging environment plan — Ask Sunny (22 Oct 2026)

Status: **plan only.** Nothing below has been created or changed. Every step that creates a paid resource, changes Vercel or Supabase configuration, or copies any company document needs the owner's approval first.

## Why staging is needed

* **Preview writes to production today.** `NEXT_PUBLIC_SUPABASE_URL`, the publishable key and `SUPABASE_SECRET_KEY` are a single entry targeting both *preview* and *production*; two old feature branches have branch-scoped overrides. A write test on any Preview deployment changes production HR records.
* **The release still needs live checks that mocks cannot give:**
  * the real model reading unfamiliar wording;
  * the app persisting through PostgREST/Auth and reading back after a refresh;
  * a real browser on the Corrective Action flow (draft → date correction → confirm level → finalize → reopen);
  * live authorization and tenant isolation.

## Current platform facts (read-only checks, 22 Oct 2026)

| Item | Value |
|---|---|
| Supabase project | `rbkylaavthsjepsczccv` (named "Ask Sunny Dev" in Supabase, but it **is** production; it is the only authorised target in `HANDOFF.md`) — the production database |
| Supabase organization plan | **Free** (`JB & Associates, Inc`). Both apps' production projects are in this org. No branches exist. |
| Free-plan limits that matter | Two free projects across every org a person owns or administers, and this org already has two. Free projects auto-pause after about 7 days of low activity. There is no Supabase Branching on Free. |
| Vercel project | `ask-sunny` in team *Glo Brands*. Custom environments allowed: **1 per project** (none created). |
| Cron jobs | `vercel.json` crons run only on Production deployments, so a staging deployment does not start syncs by itself. |

## Recommended option — Supabase Pro + a persistent staging branch, and a Vercel "staging" custom environment

1. **Supabase** (owner approval and billing): upgrade the org to **Pro**.
   * Create a *persistent* branch `staging` on `rbkylaavthsjepsczccv`. A branch is a separate database, Auth and Storage built from `supabase/migrations` with **no production data**.
   * Alternative: a separate `ask-sunny-staging` project.
   * Pro also stops the production projects from auto-pausing and adds daily backups. That is worth having on its own, since production HR records currently run on the Free plan.
2. **Vercel**: create custom environment `staging` on `ask-sunny`, tracking git branch `staging` (or the PR branch), with its own variables:
   * `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`: the staging branch's values.
   * `ANTHROPIC_API_KEY`: a **separate key with a low monthly spend limit**; also `ANTHROPIC_MODEL` / `ANTHROPIC_EFFORT` as in production.
   * `NEXT_PUBLIC_SITE_URL`: the staging URL. `NEXT_PUBLIC_DEMO_MODE`: unset or false.
   * **Off or unset in staging**: every external sync and write switch, and their credentials. `WOVEN_SYNC_ENABLED`, `WOVEN_SYNC_WRITES_ENABLED`, `WOVEN_SYNC_SCHEDULE_ENABLED`, `WOVEN_KNOWLEDGE_SYNC_ENABLED`, `WOVEN_VALIDATION_ENABLED`, `APIFY_SYNC_ENABLED`, `APIFY_SCHEDULE_ENABLED`, `GBP_SYNC_MODE` (off); omit the Woven, Apify, Google Business Profile and Resend credentials, and the reporting ingest secrets.
   * `CRON_SECRET`: a new staging-only value.
3. **Synthetic data**, by a reviewed seed script in the repo, run against staging only:
   * Auth users created with the admin API, with synthetic `@example.test` addresses: an admin, a manager at one location, and a manager at another location (to test isolation).
   * Matching `app_users` rows, roles and location scope; synthetic locations and an employee directory of invented names.
   * The form template library (seeded by the app on first use).
   * No production employee, review or form record is copied.
4. **Policy manual in staging.** CA citations need the manual's text.
   * Uploading the company's JBA manual PDF to staging copies a company document, not an HR record, but it still needs the owner's OK.
   * Without it, staging can still test everything except citations, using a synthetic "test manual" with the same headings.
5. **Live tests to run there:**
   * the CA conversation set from `docs/OVERNIGHT_QA_REPORT.md` with the real model;
   * Playwright (this repo has no Playwright suite yet; add `@playwright/test` with a CA spec, modelled on Ask Bubbles' `e2e/`) against the staging URL (`E2E_BASE_URL=…`) with a real login, covering draft → correct dates → confirm level → finalize → reopen, and the refused finalize;
   * a second-location manager is refused another location's draft (tenant isolation);
   * the "requires owner confirmation" and suggested-level notices after a hard refresh.

### Estimated effort and cost

| Item | Effort | Monthly cost (USD, list prices) |
|---|---|---|
| Supabase Pro (org-wide, covers both apps) | 15 min | $25 (includes $10 of compute credits) |
| Production project compute after upgrade (Micro) | — | about $10 per project; one is covered by the credits |
| Persistent staging branch (Micro, always on) | 1–2 h per app | about $10 per branch (about $0.0134/h) — or less if paused, or ephemeral per PR |
| Vercel custom environment and branch-scoped variables | 1 h per app | $0 (allowed on the current plan) |
| Seed script for synthetic users, locations and directory | 3–4 h per app | $0 |
| Separate Anthropic key with a spend cap | 15 min | usage only; a full CA test pass is cents to a few dollars |
| Playwright CA live spec | 4–6 h plus about 4 h to add Playwright to this repo | $0 |

Total: about **2–3 days of setup** for both apps. Running cost is about **$45–$65 a month** for both apps on Pro with two always-on staging branches, or about $35 with ephemeral branches.

### Lower-cost alternatives

* **Second Free org owned by a different person**: $0, up to two staging projects. No branching, auto-pause after 7 days, and the migrations are applied by hand with `supabase db push`. Acceptable for a one-off validation.
* **Local stack in CI**: `scripts/local-stack` (Postgres, GoTrue, PostgREST in Docker) on a GitHub Actions runner. $0 and fully isolated, but there's no Vercel Preview, and the model still needs a key. This session could not run it because the container has no Docker daemon.

## Rollback

Staging is additive. Deleting the branch or project and the Vercel custom environment removes it, and production is untouched throughout.
