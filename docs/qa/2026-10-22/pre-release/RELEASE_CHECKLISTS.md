# Release checklists — Ask Bubbles and Ask Sunny (22 Oct 2026)

Both releases are **ON HOLD**. Nothing here has been done in production; every ☐ that changes something outside the feature branches needs your explicit approval. **Blocker** = must be done before that release goes to production. **Optional** = a follow-up that can ship later.

---

## Ask Bubbles

### Option A — payroll-only (recommended first)
| # | Item | Type | Status |
|---|---|---|---|
| A1 | Approve pushing `qa/bubbles-payroll-only` (2 commits on `main`, 1 production file) and opening a PR into `main` | **Blocker** (your approval) | ☐ |
| A2 | CI green on that PR: lint, typecheck, `npm test` | **Blocker** | ☐ (local at `483e6b4`: 9,793 passed / 0 failed; tsc 0; lint 0 errors) |
| A3 | Code review of `src/lib/forms/payroll-deduct.ts`, the 9-line `form-proposal.ts` change and the 3 test files | **Blocker** | ☐ |
| A4 | Approve the HR audit plan gates G0 (deployment window) and G1 (Phase A) — can run before or after deploy | **Blocker for closing the incident**, not for deploying | ☐ |
| A5 | Deploy; smoke-check in production without creating a form: "we will not payroll deduct $25" → card **No**; "no need for the $25 payroll deduction" → card **asks**; "payroll deduct $25, she was late" → **Yes**, plan amount without a comma | **Blocker** (post-deploy verification) | ☐ |
| A6 | Record the fix deployment time = the audit window end | **Blocker for the audit** | ☐ |
| A7 | Server-side re-read of the payroll answer at create (as the warning level already does), so a client-sent value is never trusted | Optional hardening | ☐ |
| A8 | After a form exists, an unclear payroll statement in chat changes nothing and is not asked about (P-1) | Optional (low) | ☐ |

### Option B — full feature branch (after A, or instead of A)
| # | Item | Type | Status |
|---|---|---|---|
| B1 | Approve the PR from `claude/lucid-shannon-v79zju` into `main` | **Blocker** (your approval) | ☐ |
| B2 | CI green on the PR head | **Blocker** | ☐ (local at `82b34e3`: 10,139 passed / 0 failed; tsc 0; lint 0 errors; local-stack 25/25; Playwright 9/9) |
| B3 | Owner acknowledges names are now kept as typed (reverses the 9 Oct capitalisation rule in `owner-retest-e2e`) | **Blocker** (owner-visible behaviour) | ☐ |
| B4 | Owner acknowledges the new date question ("Which date goes on the form?"), location-reply and two-person behaviour | **Blocker** (owner-visible behaviour) | ☐ |
| B5 | HR audit (as A4–A6) if A was not released first | **Blocker for closing the incident** | ☐ |
| B6 | Post-deploy smoke: the 4 browser checks (continuity, location reply, location choice, payroll save/read-back) with a test account | **Blocker** (post-deploy verification) | ☐ |
| B7 | Stale `revocation.local-stack.test.ts` liveness checks | Done ✓ (`82b34e3`; 25/25; termination assertions unchanged) | ☑ |
| B8 | B3 "today" after "i already told you" ends the intake; R1 lower-case name in "what should I do?"; N5 admin's bare "‹Bubbles store number›"; P-1 | Optional (Low, pre-existing) | ☐ |
| B9 | District → store assignments verified, then district managers can file (fail-closed until then) | Optional (data decision) | ☐ |

---

## Ask Sunny

Production `main` is **not** affected by the payroll defect.

| # | Item | Type | Status |
|---|---|---|---|
| S1 | Chat-UI test timeouts | Done ✓ (`52fceb0`; 0/220 vs 17/220; `SUNNY_UI_TIMEOUT_FIX.md`) | ☑ |
| S2 | Confirm F-14: "Create a form" hidden for Assistant Salon Directors and Employees (UI only; the server already refuses them) | **Blocker** (your decision) | ☐ |
| S3 | Decide 306/307/314: keep "ask" (recommended) or adopt a "salon N = salon number / store N = Google code" rule | **Blocker** (your decision; the branch's "ask" is safe to ship) | ☐ |
| S4 | Approve the PR from `claude/lucid-shannon-v79zju` into `main` | **Blocker** (your approval) | ☐ |
| S5 | CI green on the PR head | **Blocker** | ☐ (local at `771466e`: 12,367 passed / 0 failed; tsc 0; lint 0 errors; local-stack 78/78; Playwright 9/9) |
| S6 | Owner acknowledges names kept as typed; date question; the full payroll reader (now fail-safe) arriving on Sunny | **Blocker** (owner-visible behaviour) | ☐ |
| S7 | Post-deploy smoke: the 4 browser checks with a test account | **Blocker** (post-deploy verification) | ☐ |
| S8 | `month-to-date.local-stack.test.ts` depends on run order (leftover `woven_location_map` rows); identical on `main`; not in CI | Optional | ☐ |
| S9 | B3, R1 and P-1 (Low, pre-existing) | Optional | ☐ |
| S10 | District → salon assignments verified, then district managers can file | Optional (data decision) | ☐ |
| S11 | Minor reviewer notes (F-17) | Optional | ☐ |

---

## Both apps — never without your approval
- No pull request, merge to `main`, deployment, production query or record change.
- No widening of any role's permissions or any location's access.
- No correction of a historical HR record except through the app's own revise flow, after the audit, by HR.
