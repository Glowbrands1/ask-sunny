# Ask Sunny — final pre-merge QA (pull request #129, 22 Oct 2026)

**Verdict: PASS.** Safe to merge and deploy after the owner's approval. Nothing here was merged, deployed or closed. No production database or HR record was read or changed.

## Heads
| | SHA |
|---|---|
| Final code head | `101f569`: release branch with `main` `49e5be9` (pull request #127, already in production) merged in |
| `main` / Sunny production | `49e5be9` (production deployment `dpl_7TNnrNmFETqE2ptwMCfTGeyKhZV1`) |

`main` moved during this review (#127 merged and deployed at ~20:16 UTC). It was merged into the branch and the only conflict was in a test file, where both sides added test blocks; both were kept. The 38 extra tests are exactly #127's (19 + 19); every other file's test counts are unchanged.

## Results (run on the final code head, sequentially, synthetic data)
| Check | Result | Baseline |
|---|---|---|
| Full suite | **12,439 passed · 0 failed · 131 skipped** | 12,401 / 131: the +38 are #127's tests |
| Typecheck / lint | exit 0 / 0 errors, 3 warnings (same as `main`) | same |
| Production build (`next build`, live mode) | exit 0 | — |
| Local database (Postgres + GoTrue + PostgREST) | **78/78** | 78/78 |
| Playwright (live build, seeded synthetic accounts) | **12/12** | 12/12 |
| Regression probes (10 sets) | **identical** to the pre-merge run | — |
| Release-decision and payroll test set | 427/427 | — |

GitHub Actions and the Vercel preview are reported on the pull request for the final head.

## Release decisions verified
1. **Assistant Salon Directors and Employees cannot create forms:**
   - The server returns 403 on all 17 templates (roles probe).
   - No form card is offered in chat.
   - The "Create a form" control is hidden (`form-creation.test.ts`, `no-generic-create-form.test.ts`).
2. **306/307/314 are asked, never guessed:** this holds for every role (`qa-w3-salon-numbers.test.ts`, owner-decision block, `bee01d6`).
3. **District and region managers without verified assignments stay blocked:** no salon is filled in, and the server refuses (`location-authority.test.ts`; locprior probe).
4. **Names are kept exactly as typed** (`qa-w2-employee-e2e.test.ts`; Playwright read-back saved `pat rivera`).
5. **R1 is not in this release.**
6. **Payroll corrections never silently change a finalized record:** a correction goes to a new draft and the finalized record is untouched (post-creation probe, 12 scenarios; `qa-payroll-after-creation-e2e.test.ts`).
7. **Payroll safeguards:**
   - Reader, 43 sentences: 0 false Yes, 0 false No.
   - Chat: 19/19.
   - After creation: 12/12, identical before and after the merge.

## Code and security review
- **Migrations, environment variables, dependencies:** no database migration, no environment-variable change, no dependency or lockfile change.
- **Permissions:**
  - The role-to-permission matrix and `authorizeRequest` are unchanged.
  - The one permission-file change is a constant listing which permissions create forms; it is used only to hide the button.
- **Location choices:** every salon choice still passes `authorizeLocation` on the server. A forged salon id returns 403 (Playwright).
- **Demo mode:** the health check and server config now refuse the privileged key in demo mode, which tightens access.
- **Secrets:** none in the diff, in tests or in the QA evidence (scanned for API keys, JWTs, private keys, database URLs with passwords, and company email addresses).
- **QA evidence package:**
  - Rebuilt to cover Ask Sunny only.
  - Superseded runs removed; the docs folder went from 11 MB to the files listed in `README.md`.
  - Local machine paths and a placeholder key string sanitized.
  - The earlier two-company reports are in this branch's history only.
- **Cross-company isolation:** 0 Ask Bubbles data in Ask Sunny code or tests.

## Overlapping pull request #128
| #128 change | Status in #129 | Recommendation |
|---|---|---|
| Browser autofill off (`ea55dab`) | **Duplicate**: already in #129 (`988ab71`). #128's copy names the sibling app in a comment | Superseded; drop |
| Negated, waived or cancelled deduction is No (`d932689`) | **Duplicate**: #129's reader does this and more (fail-safe, undecided, after creation) | Superseded; keep #129's |
| The "$25," comma | **Duplicate** (`16b2836`) | Superseded |
| Amounts without "$" ("25 dollars", "3.25"), "change … to $5.00", a decimal point in "… to no" (`4395c71`) | **Missing from #129** | Keep. Resolved and tested on #129 (`evidence/overlapping-pr/`) |
| A defaulted form date is not the manager's; a day stated once (`bb113f0`) | **Missing from #129** | Keep |
| The draft's notice is shown on the chat card (`7dde410`) | **Missing from #129** | Keep |
| Audit regression suite, 56 scenarios (`f290631`) | **Missing from #129** | Keep |

**Trial merge of #128 into #129:**
- Two conflicts:
  - `autofill.ts`: kept #129's.
  - `payroll-deduct.ts`: kept #129's reader and added #128's amount reading, the same code the sibling app uses.
- Full suite **12,493 passed, 0 failed**: every #128 test and every #129 test.
- The payroll reader, chat and after-creation probes are **identical** to #129's.
- The trial ran before #127 landed. #127 changes only `proposal.ts`, which #128 does not touch.

**#128 is not superseded:** it carries four fixes #129 lacks. Recommended order:
1. Merge #129.
2. Update #128 from `main`, applying the resolution in `evidence/overlapping-pr/`.
3. Re-run CI and review, then merge #128.

Do not close #128.

## Remaining risks
- **Owner-visible behaviour:**
  - Names kept as typed.
  - The new date and salon questions.
  - The fail-safe payroll reader (asks rather than guesses).
- **#128 after #129:** it needs a merge from `main` and a retest. A known, tested resolution exists.
- **No production smoke test yet:** see `POST_DEPLOY_SMOKE_TESTS.md`.
- **Rollback:** redeploy the production deployment of `49e5be9`. No migration is involved.
- **No real HR record needs changing for this deployment.**
