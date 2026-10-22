# QA findings — Ask Sunny & Ask Bubbles (22 Oct 2026, final)

**Branches:** `claude/lucid-shannon-v79zju` in each repo. **Final heads (pushed):** Ask Sunny `4ee4c1b` (base `origin/main` `1feaa75`), Ask Bubbles `2ea0a93` (base `origin/main` `3395e8d`).
**Status: both ON HOLD.** No pull request opened, nothing merged to `main`, nothing deployed. No production or historical HR record was read or changed (all testing used synthetic data on unit fixtures and a disposable local Supabase stack).

This file has two parts: **(1) the final status of every finding** after the user-authorized fix round, and **(2) the initial findings** exactly as reported before any fix (baseline Sunny `9548afb`, Bubbles `ce03a64`; the original file is also kept at `(the QA master folder) QA_FINDINGS.initial.md`).

---

## ⚠️ Critical: live payroll defect on Ask Bubbles `main` (not fixed on `main`)

Ask Bubbles `origin/main` (`3395e8d`) reads **"we will not payroll deduct $25"**, **"don't payroll deduct $25"** and **"$25 payroll deduction was waived"** as **Payroll deduct: Yes** (`evidence/final-probes/reviewer-bubbles-main.json` (Ask Bubbles repository)). A Corrective Action saved from such a conversation records the opposite of what the manager said. The fix (F-01) is on the held branch and is verified end-to-end (unit, probe, and browser save + read-back: `['no']` for all three, `['yes']` for the positive control). **Recommendation: approve F-01 for Bubbles on an expedited basis**, and have HR check Bubbles Corrective Actions created since the payroll reader shipped whose description contains a negated or waived deduction. QA did not inspect or change any of those records.

---

## Part 1 — Final status

Probe numbers are branch / `main`, same harness and fixtures (`REGRESSION_MATRIX.md`; raw: `evidence/final-probes/`). Bubbles probes ran at `cf694d2`; `2ea0a93` changes one test expectation only.

### Your three reported findings
| | Status | Sunny | Bubbles | Evidence |
|---|---|---|---|---|
| **A** lower-case name ("my employee pat rivera …") | **Fixed** | `dc5e7a6` (branch) | already on main | A1–A7 pass both apps; Sunny `main` still fails A1/A2 |
| **B** "i already told you" loses the form | **Fixed**; one residual (B3) | `dc5e7a6` | already | B1, B2 pass both; browser: continueKey kept on turns 2 and 3, kept across reload |
| **C** several incident dates | **Fixed** in Sunny (asks "Which date goes on the form?") | W4 `4171a5e` | already | C1–C5, X4 ("most recent"), X8 pass both apps |

### Findings F-01 … F-17
| ID | Sev. | Final status | Sunny commit(s) | Bubbles commit(s) | Verified by |
|---|---|---|---|---|---|
| F-01 negated/waived payroll read as Yes | High | **Fixed** (both). Live on Bubbles `main` — see above | W1 `5b208c5` → `67a084c` | W1 `c527329` → `25be953` | 6/6 payroll reader claims both apps (on `main`, Sunny returns null — asks — for all three negations; Bubbles returns **yes** for all three); X1, X5; browser save No×3 / Yes control |
| F-02 location-only reply overwrites the employee | High | **Fixed** (both) | W2 `8ae0147` → `e6ce884`; F-12 `1ebbf60` → `f8c4464` | W2 `2d8725b` → `55a496a`; F-12 `e8cdcc8` → `a19d32b` | L1–L4, M2, X3, X6, X9; browser AC1 (assigned: location set, employee kept; unassigned: location null, `needs_location`, employee kept) |
| F-03 dates by meaning (a–d) | Medium | **Fixed** (both) | W4 `7c4fa18`, `23b285a` → `4171a5e`; F-03d `2eaf93e` | W4 `614e1fd`, `64fd694` → `2272c73`; F-03d guard `999ac00` | C1–C5, R3, X4, X8; AC3 CA-request rows 12/12 both apps |
| F-04 "write a …" read as a CA request | Medium | **Fixed** (both) | W1 `38f9290` → `67a084c` | W1 `9ffbf5b` → `25be953` | 4/4 intent claims both apps |
| F-05 bare number after "at" read as a salon | Medium | **Fixed** (Sunny); Bubbles never had it (guard tests added) | W3 `de490a3` → `2790542` | W3 guard tests `cca056e` → `2bc638f` | 7/7 Sunny salon-number probes; identifiers 20/20 Sunny, 17/17 Bubbles |
| F-06 two people → one picked silently | Medium | **Fixed** (both). Sunny asks which person; Bubbles offers one card per person (its existing two-forms feature) — intended difference | W2 `b24882e` | W2 `6c5a14a` | I4, X7 |
| F-07 previous coaching in natural phrasing | Medium | **Fixed** for the 12 tested phrasings on both paths (CA request 12/12, "what should I do?" 12/12 both apps); **residual R1** | W4 `23b285a` | W4 `64fd694` | locprior AC3 rows (24/24 both apps; `main` Sunny 9/24, Bubbles 13/24); R3–R6 |
| F-08 escalation over-fires | Medium | **Fixed** (both) | W4 `23b285a` | W4 `64fd694` | 3/3 escalation claims both apps |
| F-09 role before the name hides the employee | Medium | **Fixed** (both) | W2 `d0e197a` | W2 `d2589cb` | 3/3 third-party claims both apps |
| F-10 district/region managers cannot file at any location | Medium | **Unchanged by instruction** — kept fail-closed until real district assignments can be verified | — | — | route probe: DM own-district → 403 in both (scored as the policy) |
| F-11 prior forms matched by name across locations | Medium | **Fixed** (both): attached only when unambiguous (full name, form has a location, every same-name form is at that location, complete read); otherwise shown as a *possible* match with its location and **never saved**. Chat, draft and saved form agree | W3 `7ef0e1a` + follow-up `d52a3fa` | W3 `95d0224` + follow-up `dea1646` | `qa-w3-prior-forms-identity.test.ts` and the F-11 follow-up tests (unit + route); full suites |
| F-12 a bare location reply ends the open intake | Low-Med | **Fixed** for location replies in both apps (a bare number counts only when a location is expected; times/prices/dates/quantities never; only an authorized location is set; ambiguous/unauthorized → asked; employee kept; intake stays open). **Residuals B3, N5** | `1ebbf60` → `f8c4464` | `e8cdcc8` → `a19d32b` | `qa-f12-*` tests; identifiers; browser AC1 |
| F-13 names capitalised | Low | **Resolved by your decision:** the manager's spelling is kept unless an exact directory match supplies it — chat, draft and saved form (browser: saved `pat rivera`) | W2 `cf8bdd6` | W2 `6ad7e59`, `2ea0a93` | A5–A7; browser saved values |
| F-14 deliberate Sunny branch changes | Low | **Unchanged — needs your confirmation** (306/307/314 left blank; "Create a form" hidden for Assistant Salon Directors and Employees) | — | — | — |
| F-15 Bubbles tenant-isolation guard | High | **Resolved and pushed** (`ce03a64`, comment wording only) | — | `ce03a64` | `tenant-isolation.test.ts` passes in the full suite |
| F-16 documentation errors | Low | **Resolved and committed** | `4fb664d` | `5e858aa` | — |
| F-17 other reviewer notes | Info/Low | **Unchanged** (not in the authorized list) | — | — | — |

### Found and fixed during the fix round
| ID | Sev. | What | Fix |
|---|---|---|---|
| ISO-1 | Medium (isolation) | A Bubbles test fixture used Sunny's salon id `loc-0310` (copied by an earlier port) | Bubbles `5ee3298` → `‹Bubbles store id›`; fixture only |
| X2 | Medium | Sunny: "no, keep it verbal" after "make it a written warning" kept Written | Sunny `4ee4c1b`; Bubbles already correct, guard test `cf694d2` |
| F-03d | Low | "…for pat rivera dated 10/20" named "pat rivera dated" | Sunny `2eaf93e`; Bubbles guard `999ac00` |
| T-1 | Low (test) | One Bubbles chat-route expectation still capitalised the name after the spelling decision | Bubbles `2ea0a93` (casing of one expected value, commented) |

### Found and fixed in the overnight validation (after the first final report)
| ID | Sev. | What | Root cause | Fix (Bubbles / Sunny) | Tests (fail before) |
|---|---|---|---|---|---|
| F-01b | **High** | Other negations beside an amount still read **Yes** ("we're not doing / skip / no need for / hold off on the $25 payroll deduction", "payroll deduct $25 does not apply"); "we did not waive…" read No | An amount next to "payroll deduct" was a Yes unless a fixed negative phrasing matched | `e061750` / `9e84273` (+ payroll-only `2897163`): an amount-implied Yes needs no denial beside it, otherwise asked | 31 (16 fail on Bubbles `main`) |
| F-01c | Medium | Action Plan "**$25,** will be deducted…" (both `main`s) | Money pattern took the clause's comma | `72c24be` / `16b2836` (+ `711f893`) | 7 (3) |
| F-01d | **High** | A withdrawn Yes stayed on the card: the withdrawing turn left the form (both `main`s) | Open-form continuation only kept payroll turns read as Yes/No | `14c37f3` / `771466e` (+ `483e6b4`) | 4 (4) |
| UI-T | Low (CI) | Sunny chat-UI tests timed out by chance | First test per file imports the whole chat screen (4.6–6.2 s vs 5 s) | Sunny `52fceb0`: per-file `testTimeout` 20 s, no assertion changed | 0/220 vs 17/220 |
| LS-2 | Low (test) | Bubbles revocation local-stack test 22/25 since 8 Oct | Liveness proven by a knowledge read that migration `20261003001000` closed | Bubbles `82b34e3`: liveness via `authorizeRequest`; stricter knowledge assertion added; termination checks unchanged | 25/25 |

Final heads: **Ask Sunny `771466e`** (full suite 12,367 / 0 failed), **Ask Bubbles `82b34e3`** (10,139 / 0 failed), payroll-only option `483e6b4` (9,793 / 0 failed, local).

### Found and fixed in the final safety check (payroll after creation)
| ID | Sev. | What | Root cause | Fix (Bubbles / Sunny / payroll-only) | Tests (fail before) |
|---|---|---|---|---|---|
| F-01e | **High** | After a Yes form existed, "we cancelled / cancel / hold off on / not sure about the … payroll deduction" left the saved **Yes** and the Action Plan's deduction sentence, and the chat began a new form (both apps; on a finalized form, nothing was opened) | `correctActiveForm` changed payroll only on a clear Yes/No; "cancelled" was unknown and hedges are deliberately unreadable | `225bf10` / `880d19a` / `56c45e1`: cancelled = No; an unclear statement clears the answer, rebuilds the plan without a deduction and asks Yes or No (on a new draft for a finalized form; the signed record untouched) | 14 (9) |

### Remaining defects (none introduced by the branches)
| ID | App | Sev. | Description | Origin | Recommended action |
|---|---|---|---|---|---|
| CRIT-P (**fixed in production** `e7dd377`, PR #67, deployed 22 Oct 19:00 UTC) | Bubbles | **Critical** | Negated/waived payroll read as Yes (F-01) | Bubbles `main` before `e7dd377` | HR audit of forms saved 21 Oct 20:55 – 22 Oct 19:00 UTC (gates G1/G2, needs your approval) |
| B3 (**fixed** overnight: Bubbles `7e68a0e`, Sunny `555d5e6`) | both | Low | After a ready card and "i already told you", a one-word "today" fell to the grounded answer; the suggestion picker ended the intake. Root cause: the open-form check read calendar dates ("10/20") but not day words. A reply that is only a day now continues the form | pre-existing (both `main`s) | `qa-b3-day-reply-continues.test.ts` (QA's exact turns): 6 of 9 fail before, 9 of 9 pass, both apps |
| R1 (**not fixed**, reproduced overnight) | both | Low | "pat rivera was late again today. I already coached her last week… what should I do?" — with a **lower-case** name the turn leaves the forms path (no card); the capitalised R4 works | pre-existing | The cause is the employee-name reader (`extractEmployeeNames` deliberately refuses a lower-case leading phrase); widening it changes name reading for every chat turn, which is not a contained fix — a separate, reviewed change |
| N5 (**not fixed**, reproduced overnight) | Bubbles | Low | A global admin replies a bare "‹Bubbles store number›" when no store question is open → picker ends the intake (correctly not read as a store, per F-12 criterion 1, but the intake drops) | pre-existing | Needs a product decision: keeping the intake open would show the card unchanged with the number silently ignored (F-12 rule), or a new "did you mean store 264?" question |
| UI-T (**fixed** `52fceb0`) | Sunny | Low (CI flake) | `rollout-fixes.dom.test.tsx` and `rating-stays-in-place.dom.test.tsx` run ~4.4–5.2 s against the 5 s default timeout; baseline 11/110 failed executions vs branch 6/110 | pre-existing | per-file timeout headroom (needs your authorization: test configuration) |
| LS-1 (**fixed** overnight, Sunny `b9fe177`) | Sunny | Low (test isolation) | `month-to-date.local-stack.test.ts` failed its setup whenever it ran after the Woven access local-stack suites, which left `woven_location_map` rows on salon 0307 (ON DELETE RESTRICT, deliberate) | pre-existing | Each Woven suite deletes its own run's mapping rows in `afterAll`; test-only, no assertion changed. Reproduced (access → month-to-date: FK error, 8 skipped); after: 12/12, 8/8, 26/26, 8/8 on one stack. Bubbles has no month-to-date suite (parity log) |
| LS-2 (**fixed** `82b34e3`) | Bubbles | Low (stale test) | `revocation.local-stack.test.ts`: 3 tests expect a browser token to read knowledge, which migration `20261003001000_knowledge_server_only.sql` deliberately revoked; identical on `main` | pre-existing | update the 3 expectations to the server-only rule |
| F-10 | both | Medium (product/data) | district/region managers cannot file | by design | provide verified district→location assignments |
| F-14 | Sunny | Low | deliberate branch behaviors awaiting confirmation | branch | confirm or revert |
| F-17 | both | Info/Low | minor reviewer notes | mostly pre-existing | backlog |

**Owner note (Bubbles):** `owner-retest-e2e.test.ts` encoded the 9 Oct owner rule that typed names are capitalised; your 22 Oct decision (keep the manager's spelling) reverses it. The Bubbles owner should be told.

---

# Part 2 — Initial findings (before any fix; baseline Sunny `9548afb`, Bubbles `ce03a64`)

**Scope.** Branch `claude/lucid-shannon-v79zju` in each repo, against its `origin/main`:

| App | Base (`origin/main`) | Branch HEAD tested | Pushed? | Uncommitted (docs/CI only) |
|---|---|---|---|---|
| Ask Sunny | `1feaa75` | `9548afb` | yes | `.github/workflows/ci.yml`, `CLAUDE.md`, `docs/parity-log.md` |
| Ask Bubbles | `3395e8d` | `ce03a64` | **no** (`b6a19e7` is on origin; `ce03a64` is local) | same three files |

**Status: both PRs ON HOLD. Nothing opened, merged or deployed. No behavioral fix applied.**
The only code commit made during QA is `ce03a64` (Bubbles), which rewords two code comments so a guard test passes (no behavior change; see F-15).

**Method.** (1) Independent read-only reviews of each merged diff by two fresh reviewers, every claim re-verified by a probe; (2) conversation probes through the real `answerQuestion` path (forms gates, proposal, continuation exactly as the browser sends it), run on the branch AND on `main` so regressions are separated from pre-existing defects; (3) route-level probes of `POST /api/forms/instances`; (4) full sequential test suites, typecheck, lint, build, local-stack integration tests, and Playwright against live-mode builds (see `FINAL_QA_VERDICT.md`). Probe sources and raw outputs: `evidence/initial-probes/`. Probe files were never committed (`src/__qa__/` is in `.git/info/exclude` and deleted after every run).

Severity: **High** = wrong value can reach an HR record or a protected rule fails; **Medium** = wrong/blocked behavior a manager will hit; **Low** = edge case or wording; **Info**.
"Origin" says where a defect comes from: **branch** = introduced by this branch; **Bubbles main** = already live in Bubbles; **pre-existing** = on both `main`s.

---

## The three findings you reported

### A. Lowercase employee name — `"my employee pat rivera was late again today, i need a coaching form"`

| Checkout | Result |
|---|---|
| Sunny `main` `1feaa75` | `employeeName=null`, `status=needs_employee` — **reproduces your result exactly** |
| Sunny branch `9548afb` | `employeeName="Pat Rivera"`, `status=ready` (with and without a directory record) |
| Bubbles `main` / branch | `"Pat Rivera"`, `ready` |

**Root cause: capitalization-dependent extraction** — not employee lookup (it fails identically with an empty directory). `readEmployeeMentions` (`src/lib/forms/proposal.ts`) accepted "my employee <Name>" only for a capitalised name. Fixed on the branch by `dc5e7a6` (bisected: `38dad49` and `1aaf993` still fail; `dc5e7a6` passes), which reads a lower-case name after "my/our employee | team member | staff member | associate | coworker" through `readTypedName`; nothing is invented — with no directory record the card says the name was not found in the employee list.
**Conclusion:** your probe ran against code without `dc5e7a6` (Sunny `main`, or the CA worktree before its last commit). Evidence: `evidence/initial-probes/sunny-direct-*.json`, `bisect-*.json`.

### B. Continuity — `"create coaching form for pat rivera, late 3 times this week"` → `"i already told you"`

Raw second response:

| Checkout | Turn 2 via `answerQuestion` | Turn 2 via `proposeFormForTurn` with the browser's open-form key | …without the key |
|---|---|---|---|
| Sunny `main` | **form picker, no `formProposal`** | `null` (left the forms path) | `null` |
| Sunny branch | same Coaching card, Pat Rivera, `ready` | card, Pat Rivera | `null` |
| Bubbles main/branch | card, Pat Rivera | — | — |

**Root cause on `main`: the intake state really was lost for that turn.** "i already told you" was not an intake answer, so the turn fell to the grounded path, which appended a form-suggestion picker — and a picker *ends* the open intake in `continuationFor` (`src/lib/forms/proposal-continuation.ts`). Fixed on the branch by `dc5e7a6` (an objection to being re-asked carries the open form forward).
**Test-helper caveat (also true):** a helper that calls `proposeFormForTurn` *without* `continueTemplateKey` will always get `null` on a turn like this, even on the fixed branch — that is correct behavior, because the browser always sends the key (`continuationFor(history)`). The HR e2e helper sends it. The production code was not changed to satisfy any assertion.

### C. Multiple incident dates — `"create verbal ca for pat rivera. she was late on 10/5 and 10/15. no payroll deduct"`

| Checkout | formDate | Payroll | What the manager is told |
|---|---|---|---|
| Sunny `main` and branch | **2026-10-05** (silently) | No (stated) | nothing about the date |
| Bubbles `main` and branch | null (dated today until chosen) | No (stated) | "You mentioned more than one date (10/5, 10/15). Which date goes on the form? … Every date stays in the description" |

**Root cause (Sunny, pre-existing, by design):** `extractFormDate` returns *"the first incident date in the manager's words"* (`src/lib/forms/form-date-answer.ts:324`). Both dates are preserved in the source turns sent to the drafter; only the form's Date field is guessed. Payroll is **not** incorrectly asserted here: "no payroll deduct" is the manager's statement; with no statement (C4) it stays null and is asked. **Fix proposed, not applied** (significant behavior change): port Bubbles `9c02dcb` "ask which date goes on the form". Related date defects are F-03b/c/d below.

---

## Findings (most severe first)

### F-01 — HIGH — A negated or waived payroll deduction is read as **Yes**
`statedPayrollDeduct` returns `"yes"` for: "we will not payroll deduct $25", "don't payroll deduct $25", "$25 payroll deduction was waived".
| Sunny main | Sunny branch | Bubbles main | Bubbles branch |
|---|---|---|---|
| null (asks) | **yes** | **yes** | **yes** |

**Origin:** Bubbles `main` (live today); imported into Sunny by `48d179b` (port of Bubbles `9530112`/`ac36870`). **Root cause:** the amount patterns in `src/lib/forms/payroll-deduct.ts` ("payroll deduct $X", "$X payroll deduction") do not look for a negation or a waiver around them. **Impact:** a "Yes" ticked on a Corrective Action Form the manager said No to. **Proposed fix:** a negation/waiver guard (`not|don't|won't|never|no longer|waived|waive|instead of`) within the clause, checked before the amount patterns, plus regression tests with these three sentences — in both apps. Evidence: `evidence/initial-probes/reviewer-verify-*.json`.

### F-02 — HIGH — A location-only reply overwrites an already identified employee (acceptance criterion 1: FAIL)
| Turn 2 after "create a coaching form for pat rivera, late 3 times this week" | Sunny main | Sunny branch | Bubbles main/branch |
|---|---|---|---|
| "kearney" (salon director / location manager) | employee **"kearney"** | employee **"Kearney"** | employee **"Kearney"** (store also set correctly for a global admin) |
| "kearney" (district manager) | **"kearney"** | **"Kearney"** | Pat Rivera kept |
| "sorry, it's ‹Bubbles store›" (Bubbles admin) | — | — | employee **"‹Bubbles store›"** |

**Origin:** pre-existing in both apps. **Root cause:** a one-word location name is deliberately *not* treated as a place (`isRosterSalonName` only covers full names and multi-word short names, because "Kearney" is also a surname), so a whole-message reply is read by `readTypedName(…, whole=true)` as the answer to "who is this for?" and, in an open intake, replaces the employee. The card then says "I didn't find Kearney in the employee list". **Proposed fix:** while an intake already has an employee, a whole-message reply (or "sorry, it's X") that matches a roster location is read as the location, never as a person; a regression test per app. Behavior change → awaiting approval.

### F-03 — MEDIUM — Dates are not always interpreted by meaning (acceptance criterion 2: FAIL in Sunny, partial in Bubbles)
- **a. Two incident dates (Sunny):** first date silently used — finding C.
- **b. Prior coaching date becomes the form date (Sunny):** "create a verbal ca for pat rivera … I coached her on 10/1 for being late" → formDate **2026-10-01**; also "we had a talk with her about tardiness on 10/1", "this is after her coaching on 10/1", "we discussed attendance with her on 10/1" → 2026-10-01 (Bubbles: "we had a talk…" and "we discussed…" also → 2026-10-01; "I coached her…" and "this is after her coaching…" null). Root cause: `PRIOR_STEP_BEFORE` / `HISTORY_LABEL` only know a fixed set of verbs ("coached", "warned", "previous coaching"…); "had a talk", "discussed", "after her coaching" are not history markers, so the date is read as an incident date.
- **c. The coaching being documented is treated as history (Sunny):** "coaching form for pat rivera, she was late on 10/5 and 10/15, I coached her on 10/16" → Coaching Form dated **10/05**; the 10/16 coaching is skipped as an "earlier step". Bubbles asks between 10/5 and 10/15 (also ignores 10/16).
- **d. "dated 10/20" (explicit form date):** Sunny uses 10/20 but reads the employee as **"Pat Rivera Dated"** (name reader swallows "dated"; pre-existing); Bubbles keeps the name but asks which of 10/5, 10/15, 10/20 — the explicit form date is not recognised as one.
Origin: pre-existing. Proposed fixes: port `9c02dcb` to Sunny; widen the history markers; on a Coaching Form, "I coached her on X" is the form's own date; "dated X" is the form date and ends a typed name.

### F-04 — MEDIUM — "write a …" is read as a request to create a Corrective Action
"can you write a summary of the corrective action policy", "write a note explaining the corrective action steps", "write an email to Paisley about her CA" → `requestedCreation: true` (Sunny main: false). **Origin:** Bubbles `main`; imported into Sunny by `2f9417a` (port of `4cbb84c`). Root cause: `template-intent.ts` adds "write a/an" as a creation verb without requiring the object to be the form. Impact: a policy question goes into the CA intake instead of being answered.

### F-05 — MEDIUM — A bare 3-digit number after "at" is read as a salon (Sunny branch only)
"she got here at 410 today" → loc-0410; "she sold a package at 140" → loc-0306; "rang up a sale at 231 dollars" → loc-0394; "we met at 409 for lunch" → loc-0495 (Sunny `main`: none). **Origin:** branch — `fac0f44`, cherry-picked from Sunny's never-merged `c52d74c`. Root cause: `AT_NUMBER` in `salon-mention.ts`; `TIME_BEFORE` only excludes a few verbs. A named salon outranks the employee's directory salon, so a multi-salon manager can get the wrong salon silently.

### F-06 — MEDIUM — Two people in one request: one is picked silently
"coaching form for pat rivera and sam jones, both late" → a card for Pat Rivera only (both apps, both checkouts). Pre-existing.

### F-07 — MEDIUM — Previous coaching is not recognised across natural phrasing (acceptance criterion 3: FAIL)
12 phrasings (`evidence/initial-probes/locprior-*.json`):
| Path | Sunny branch | Bubbles branch |
|---|---|---|
| CA request: prior step recognised and its date kept off the form | 7/12 | 9/12 |
| "what should I do?": Corrective Action offered beside Coaching | 4/12 | 4/12 |

Missed in both: "we had a talk with her about tardiness on 10/1", "we discussed attendance with her on 10/1", "I talked to pat about being late last month" (CA path; Sunny also misses "this is after her coaching on 10/1" and dates "I coached her on 10/1" as the form date); "she was coached last week", "she had a coaching on 10/1", "previous coaching 10/1", "this is after her coaching", "she's been coached before" (offer path). Root cause: `PRIOR_ACTION` in `form-opportunity.ts` requires "already/verbally + verb" or "coached/talked to + her/him/them"; a name or a passive ("she was coached") does not match. Pre-existing; the branch improves two Sunny phrasings ("I coached her…", "I already spoke to her…").

### F-08 — MEDIUM — The new escalation signal over-fires (suggestion only)
"I already talked to her about the schedule and she still wants more hours", "I already addressed the broken bed with the vendor again" → `kind: "formal"` (suggests a Corrective Action). **Origin:** Bubbles `main`; into Sunny by `dc5e7a6`. Low impact (a suggestion card, never a form).

### F-09 — MEDIUM — A third party filter drops the actual subject
"Create a CA for the manager Jane Doe, she was late", "coaching for her coworker Amy Lee" → no employee (Sunny main read the name). **Origin:** Bubbles `main`; into Sunny by `4edb627` (`OTHER_PARTY`). The manager is asked "who is this for?" again.

### F-10 — MEDIUM — District/region managers cannot file a form against any location (acceptance criterion 5: partial)
Route probe: a district manager filing at a salon in their own district → **403** in both apps ("cannot yet verify which salons are in your district" / "not on your assignment"); chat proposals for DMs are `locationResolution: unavailable`. Salon-/location-level managers (including multi-location via also-covers) can select every assigned location and are refused (403) for every unassigned or forged id — 8/8 Sunny and 7/7 Bubbles route cases outside the DM case pass. **Origin:** pre-existing, deliberate fail-closed (Sunny `authorizeLocation`; Bubbles roster has no districts). Needs a product/data decision (district → salon roster), not a code fix.

### F-11 — MEDIUM — Prior-forms lookup matches by name across every store the manager can see (both apps)
`prior-forms.ts`: exact whole-name match, but not tied to the person or the form's location; a DM/RM/admin can get another same-name employee's history written into `prior_actions` by the draft route automatically. No isolation tests for same-name-other-store, unverified actor, or missing `view_form_monitoring`. **Origin:** Sunny `main` (`1d63aeb`); into Bubbles by `5f72447`. Authorization itself is correct (same visibility filter as the Forms Register; verified by the Bubbles reviewer). Related Low items: same-day forms dropped, forms dated after the draft listed as "previous", a removed line re-added on redraft, "any prior coaching?" no longer asked once a form is on file, 50-row cap.

### F-12 — LOW-MEDIUM — An open intake ends when a suggestion picker is shown
After a ready card, "today" (Sunny/Bubbles) or a bare store number "‹Bubbles store number›" (Bubbles) falls to the grounded path; the appended picker ends the intake (`continuationFor` stops at `formSelection`). Pre-existing.

### F-13 — LOW — Name capitalisation (deliberate, Sunny branch)
Names typed all-lower/all-caps are printed capitalised (from Sunny's own unmerged `d616cf4`, matching Bubbles). Reverses the 30 Sep "spelling is the manager's" rule; mis-casings "JD SMITH"→"Jd Smith", "JOHN SMITH III"→"John Smith Iii", "mcdonald"→"Mcdonald"; the "not found" note still says "exactly as you typed it". Product decision.

### F-14 — LOW — Deliberate Sunny branch changes to confirm
"306/307/314" (salon number and another salon's Google code) left blank; "Create a form" hidden for Assistant Salon Directors and Employees.

### F-15 — HIGH (resolved) — Bubbles branch `b6a19e7` failed the tenant-isolation guard test
Ported comments said "Ported from Ask Sunny"; `tenant-isolation.test.ts` (12) forbids production code naming another company. Fixed in `ce03a64` (comment wording only, test unchanged) — **local, not yet pushed.**

### F-16 — LOW — Documentation errors (fixed, uncommitted)
`CLAUDE.md` mapped "JBA Policy Manual ↔ Buff City Soap handbook" — wrong: Bubbles' approved source **is** the JBA Policy Manual (read as Buff City Soap); the parity log presented branch-only ports as merged; Sunny's "9 of 30 failed" was wrong (verified count in `FINAL_QA_VERDICT.md`); CI lacked `permissions: contents: read` and cancelled runs on `main`.

### F-17 — INFO/LOW — other reviewer notes
Knowledge supersede `limit(20)` with a `*` in a title can miss the exact match (Sunny); `?q=` never sends if IndexedDB hydrate rejects (Sunny branch); "N already up to date" shown on every Form Templates visit; "for 30 minutes" appended to a history line; `docs/production-demo-posture.md:84` stale; admin `publishDraft` unchecked-archive (pre-existing). The conversation id now in the URL is owner-scoped (a foreign `?c=` is ignored; server routes use `getOwnConversation`) — no leak.

---

## Not defects (verified)
- No authorization widening on either branch (form/conversation visibility, location scope, template-sync page, health route, knowledge supersede all equal or stricter).
- No test assertion deleted, skipped or weakened; every changed expected value maps to a stated behavior change (`TEST_CHANGE_AUDIT.md`).
- No cross-tenant path (one database per app).
