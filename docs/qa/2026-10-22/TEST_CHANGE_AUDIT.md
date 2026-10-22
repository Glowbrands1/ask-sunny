# Test change audit — 22 Oct 2026

Compared `origin/main` with the branch HEAD (`claude/lucid-shannon-v79zju`): Sunny `1feaa75 → 9548afb`, Bubbles `3395e8d → ce03a64`.
Sources: two independent read-only reviews (every row below was checked against the diff), plus the counts computed here with `git ls-tree` / `git grep` (method: files matching `*.test.{ts,tsx,mjs}`; declarations matching `^\s*(it|test)(.each(...))?(.skip|.only|.todo)?(`; reviewers used a different counter, so absolute numbers differ slightly but the direction is the same).

## Summary

| | Sunny | Bubbles |
|---|---|---|
| Test files (main → branch) | 502 → 512 (+10 added, 0 deleted, 22 modified) | 407 → 408 (+1 added, 0 deleted, 7 modified) |
| `it`/`test` declarations | 9065 → 9158 (+93) | 6353 → 6364 (+11) |
| `.skip` / `.only` / `.todo` | 6 → 6, **byte-identical** | 4 → 4, **byte-identical** |
| Assertions deleted | 0 | 0 |
| Assertions weakened (looser matcher, removed `expect`) | 0 | 0 |
| Expected values changed | 9 files (12 rows below) — all follow a stated behavior change | 3 files (7 rows below) + 2 timeout-only files — all follow a ported wording change |
| Timeout changes | only on NEW tests (`qa-claims.test.ts` 30 s; `chat-address.dom.test.tsx` `waitFor` 4 s) | 2 existing suites: `import-every-role.dom.test.tsx` 5 s → 20 s (+RTL async 1 s → 5 s); `corrective-action-conversation.test.ts` 5 s → 30 s — byte-identical port of Sunny `7b3edea` |
| Changed during this QA | nothing | nothing (QA commit `ce03a64` changes two production comments, not the guard test) |

**Not applied:** a global `testTimeout: 30_000` in both `vitest.config.mts` was prepared earlier and **withdrawn before QA** (kept, unapplied, as `evidence/baseline/pending-*-vitest-timeout.patch`) because it would change test configuration to make timeouts pass. The Sunny timeouts were then investigated in Phase 2 and classified as pre-existing timing-bound tests, not environment-only (`evidence/phase2-ui-timeouts/PHASE2_SUNNY_UI_FAILURES.md`, `FINAL_QA_VERDICT.md` (Ask Sunny's copy)).

## Ask Sunny — every changed expected value

| File:line (branch) | Before → after | Reason (commit) | Verdict |
|---|---|---|---|
| `src/lib/ai/corrective-action-conversation.test.ts:1375-1384` | 8 names expected verbatim (`"paulyne co"`, `"PAULYNE"`…) → `[typed, expected]` pairs, capitalised (`"Paulyne Co"`); `"pAuLyNe Co"` still kept as typed | names typed all-lower/all-caps printed capitalised (`38dad49`, cherry-picked from Sunny `d616cf4`) | intended |
| same file `:1440-1447` | `(paulyne)`→`paulyne` becomes `Paulyne`; `"PAULYNE CO"` → `Paulyne Co` | same | intended |
| same file `:1576, 1584, 1616` | `dana moss` → `Dana Moss` | same | intended |
| same file `:1799, 1802, 1805, 1825, 1828, 1842, 1847` | lower-case names → capitalised, incl. the content regex `**paulyne co**` → `**Paulyne Co**` | same | intended |
| `src/lib/ai/employment-change-conversation.test.ts:84, 115, 156, 201, 212, 234` | `paulyne` / `PAULYNE CO` / `JOHN SMITH` / `jane doe` → capitalised; `toBe(name)` → `toBe("Paulyne Co")` | same | intended (one fixed value: stricter) |
| `src/lib/ai/exit-form-conversation.test.ts:296, 303, 486-487` | `sarah jones`, `JANE SMITH` → `Sarah Jones`, `Jane Smith` | same | intended |
| `src/lib/ai/form-intake-qa-2026-09-30.test.ts:144-152` | lower/all-caps names → capitalised; comment "THE SPELLING IS THE MANAGER'S, not a normalised copy" rewritten | same | intended, **but reverses the deliberate 30 Sep rule** → product decision (QA_FINDINGS F-13) |
| `src/lib/ai/chat-form-known-context.test.ts:252` | `"at salon 306"` → `"at salon 0306"` | 306/307/314 are both a salon number and another salon's Google code, so a bare one is left blank (`fac0f44`, from Sunny `c52d74c`) | intended; positive coverage for "306" moved to a NEGATIVE case in `salon-mention.test.ts:82` |
| `src/lib/forms/salon-mention.test.ts:23` | `["salon 306", ["loc-0306"]]` → `["salon 0306", …]`; `"salon 306"` now expected `[]` | same | intended |
| `src/features/chat/context-panel-form-action.dom.test.tsx:166` | source scan `onCreateForm={createFormFromConversation}` → `…={mayCreateForms ? … : undefined}` | "Create a form" only for accounts that may create one (`af17a18`) | intended |
| `src/lib/forms/template-sync-policy.test.ts:204` | `toEqual` gains `failed: []` | new result field (`ee849df`) | stricter |
| `src/features/chat/conversation-history-order.dom.test.tsx:148-163` | one-click delete → confirm dialog (Cancel, then Delete) | confirm before delete (`415e0d2`) | strengthened |

New tests: 10 files — `hr-feedback-oct21-e2e` (33 scenarios), `form-intake-qa-2026-10-21` (22), `form-opportunity-escalation`, `template-sync-observability` (21), `chat-address` (+DOM), `autofill.dom`, `marquee.dom`, `form-creation`, `like`. One new permissive assertion: `rollout-fixes.dom.test.tsx:671` `rail === null || rail.disabled` (new test, not a weakened one).

**Coverage gaps the new tests leave** (all reproduced in QA_FINDINGS): payroll negation/waiver (F-01), "write a …" non-form sentences (F-04), bare "at <number>" non-salon sentences (F-05), "for the manager X" (F-09), escalation false positives (F-08). Each new reader was tested only on positive cases.

## Ask Bubbles — every changed expected value

| File:line (branch) | Before → after | Reason (commit) | Verdict |
|---|---|---|---|
| `src/app/api/forms/corrective-action-dm-feedback-e2e.test.ts:583` | `/couldn't find a section of the current policy manual for "unicorn parking"/` → `/Woven does not see a section … for "unicorn parking"/` | wording port (`fdcea02` ← Sunny `5ffa19e`); matches `ca-policy.ts:349` | intended |
| `src/app/api/forms/pm-draft-route.test.ts:780` | `/no approved policy matched/i` → `/Woven does not see a matching policy in the knowledge base/` | same | intended; now case-sensitive (stricter) |
| `src/app/api/forms/pm-draft-route.test.ts:890` | `/policy fields are left for the manager/i` → `/policy fields are left for you to complete/i` | same | intended |
| `src/app/api/forms/pm-draft-route.test.ts:1046` | as `:780` | same | intended |
| `src/features/chat/inline-form.dom.test.tsx:1225` | dialog `/policy verification is incomplete/i` → `/does not see this policy in the knowledge base/i` | `ffab76e`/`fdcea02` | intended |
| `src/features/chat/inline-form.dom.test.tsx:1788` | `/cannot vouch for wording it did not retrieve/i` → `/Woven does not see this policy in the knowledge base/` | same | intended |
| `src/features/chat/inline-form.dom.test.tsx:1824` | `not.toMatch(/no approved policy matched/)` → `not.toMatch(/Woven does not see/)` | same | intended; negative check moved to the new phrase (broader) |
| `src/features/chat/import-every-role.dom.test.tsx:15-16` | timeout 5 s → 20 s; RTL async 1 s → 5 s | port of Sunny `7b3edea` (`1bff826`) | timing only; no check removed |
| `src/lib/ai/corrective-action-conversation.test.ts:10` | timeout 5 s → 30 s | same | timing only |

New tests (11): `inline-form.dom` +2 (409 opens the dialog; a Save refreshes who wrote each value), `corrective-action-payroll-e2e` +1, `prior-actions` +4, `prior-forms-lines` +4 (new file).
**Coverage gap:** the new Forms Register read in `prior-forms.ts` has no isolation test (same name at a store the manager cannot see; unverified actor; no `view_form_monitoring`; draft route under the editor's visibility) — QA_FINDINGS F-11.

## Verdict on test integrity
No test was deleted, skipped or bent to pass in either app. Every changed expectation traces to a stated behavior change. The risk is the opposite: **new behavior was tested only on the sentences it was meant to catch**, which is how F-01, F-04, F-05, F-08 and F-09 got through.

---

# Fix round (22 Oct, after the user authorized targeted fixes)

Every existing test line changed during the fix round, per app. New test files (`qa-w1-*`, `qa-w2-*`, `qa-w3-*`, `qa-w4-*`, `qa-f11-*`, `qa-f12-*`) are additions and are counted in `FINAL_QA_VERDICT.md`. Each worker branch was checked by `tools/ownership.py`-equivalent rules: files outside the worker's list, removed/rewritten assertion lines, and any added `.skip` / `.only` / `.todo` / timeout. **No `.skip`, `.only`, `.todo` or timeout was added by any worker. No assertion was deleted.**

## Ask Sunny

| File:line | Before → after | Why | Decided by | Verdict |
|---|---|---|---|---|
| `src/lib/ai/form-intake-qa-2026-10-21.test.ts:232` | `["coaching form for Jane Doe at 373", "loc-0476"]` → `[…, null]` | QA F-05: a bare number after "at" is not a salon (a price or a time as often as a store code). "store 373" (line 231, with a location word) still → loc-0476 and is unchanged. This test file is **not on `main`** — it came onto the branch with the never-merged cherry-pick `1aaf993`, so the change restores `main`'s reading of the sentence. | user-approved F-05 rule; applied at W3 integration (`2790542`) | intended; documented in the commit and here |
| `src/lib/ai/corrective-action-conversation.test.ts`, `employment-change-conversation.test.ts`, `exit-form-conversation.test.ts`, `form-intake-qa-2026-09-30.test.ts` (the 25 name expectations `38dad49` had capitalised) | capitalised → **restored byte-for-byte to `origin/main`** (verified: each file differs from `main` only by one-line `// QA 22 Oct 2026 decision …` comments) | user decision: keep the manager's spelling unless an exact directory match supplies it | user; W2 (`cf8bdd6`) | restoration of main's assertions |
| `src/lib/ai/form-intake-qa-2026-10-21.test.ts` (branch-only file): "jane doe" ×6, "JANE DOE" ×1, "mary-kate o'neil", "brandi algya" ×2, "will turner", the "I didn't find **jane doe**" note | capitalised → as typed | same decision | user; W2 | intended; each line commented. One `it.each` became `[question, expected]` pairs — as strict (exact match per input) |
| `src/app/api/forms/corrective-action-payroll-e2e.test.ts:471,483`, `qa-w3-prior-forms-identity.test.ts:194` | `priorFormsOnFile: (name) => priorFormsForChat(actor, name)` → `(name, locationId) => priorFormsReadingForChat(actor, name, locationId)` | callback signature changed by the F-11 follow-up (`d52a3fa`) | parent | harness wiring only; no assertion changed |

## Ask Bubbles

| File:line | Before → after | Why | Decided by | Verdict |
|---|---|---|---|---|
| `src/app/api/forms/corrective-action-dm-feedback-e2e.test.ts:637` (test D) | `form_date` `"2026-10-21"` → `"2026-10-20"`; title "on a form dated the day it is created, neither the incident's date nor the deadline becomes the form's" → "the deadline is never the form's date; the one incident date (10/20) is (QA F-03)" | QA F-03: the "by the 10-15-26 deadline" date is no longer counted as a second incident, so the single incident date dates the form — the same expectation Sunny's test of the identical sentence already has (`corrective-action-dm-feedback-e2e.test.ts:660`). The deadline/incident assertions on the observation are unchanged. | user-approved F-03; W4 changed the value (outside its file list — reported), parent retitled at integration (`2272c73`) | intended; still an exact-value assertion |
| `src/app/api/forms/owner-retest-e2e.test.ts` (14 tests), `corrective-action-warning-level-e2e.test.ts` (4 lines, "paulyne test"), `admin-feedback-oct16-e2e.test.ts` ("tiffany lempka" ×2, "sam ortega" ×2), `src/lib/ai/form-intake-qa-2026-10-21.test.ts` (11 tests), `exit-form-conversation.test.ts` ("sarah jones"), `corrective-action-conversation.test.ts` ("marlowe co") | capitalised → as typed | user decision (typed spelling kept). Verified mechanically: 36 of 39 removed lines have a case-only twin; the other 3 are one `it.each` turned into `[question, expected]` pairs (as strict). **Note for the owner:** `owner-retest-e2e` encoded the 9 Oct owner acceptance rule that names are capitalised; this decision reverses it. | user; W2 (`6ad7e59`) | intended; flag to owner |
| `src/app/api/forms/corrective-action-payroll-e2e.test.ts:296,449,468` | fixture `"loc-0310"` (a Sunny salon id) → `"‹Bubbles store id›"` (a Bubbles store) | cross-app isolation check: `5f72447` had copied Sunny's fixture; line 296 was already on main | parent (`5ee3298`) | fixture data only; no assertion changed; 6/6 pass |
| `src/app/api/forms/corrective-action-payroll-e2e.test.ts:475,487`, `qa-w3-prior-forms-identity.test.ts:194` | callback wiring as in Sunny | F-11 follow-up (`dea1646`) | parent | wiring only |

## Fail-before / pass-after (new tests)
| Group | Sunny | Bubbles |
|---|---|---|
| W1 payroll + intent (4 files) | 55 tests; 31 fail on 9548afb | 55 tests; 31 fail on ce03a64 |
| W2 employee reading (2 files) | 76 tests; 45 fail on 9548afb (31 controls pass both) | 70 tests; 41 fail on ce03a64 |
| W3 prior-form identity + numbers | 10 + 11 + 23 salon-mention cases; 9 + 9 fail on base | 10 + 21 (store numbers: guard only, Bubbles never had F-05); 9 fail on base |
| W4 dates + prior coaching (3 files) | 70 + 39 + 4; 37 of the 70 fail on base | 70 + 39 + 5; 27 of the 70 fail on base |
| F-11 follow-up (agreement) | 5 | 5 |
| F-12 (2 files each) | e2e: **23 of 43 fail** on `e6ce884` (pre-F-12); the unit file tests the new `salon-reply.ts` and cannot load before it exists; **86/86 pass** at `4ee4c1b` | **31 of 80 fail** on `55a496a` (pre-F-12); **80/80 pass** at `2ea0a93` |
| F-03d "dated 10/20" ends a typed name | **3 of 6 fail** on `f8c4464`; 6/6 at `4ee4c1b` | guard (Bubbles already correct): 6/6 |
| X2 "no, keep it verbal" | **5 of 10 fail** on `2eaf93e`; 10/10 at `4ee4c1b` | guard (Bubbles already correct): 10/10 |

## Final additions (after F-12)

| App | File:line | Before → after | Why | Verdict |
|---|---|---|---|---|
| Bubbles | `src/app/api/chat/corrective-action-warning-level-chat-route.test.ts:322` (`2ea0a93`) | `"Paulyne Test"` → `"paulyne test"` | The final full suite at `cf694d2` found this one expectation W2's spelling change had missed (it lives under `src/app/api/chat`, outside the suites W2 ran). Same sentence `corrective-action-warning-level-e2e` already expects as typed; no directory match. Case of one expected value; commented; the level/payroll/content assertions in the same test are unchanged | intended (your spelling decision) |

No other existing test line changed after F-12. F-03d and X2 are new test files only.

## Full-suite integrity at the final heads
| | Sunny `4ee4c1b` | Bubbles `2ea0a93` |
|---|---|---|
| Tests vs QA baseline | 12,060 → **12,456** (+396) | 9,785 → **10,156** (+371) |
| Skipped | 131 → **131** (12 files, unchanged) | 59 → **59** (6 files, unchanged) |
| `.skip` / `.only` / `.todo` / timeout added by the branch's QA commits | **none** | **none** |
| Assertions deleted | **none** | **none** |
| Failures | 1 (run 1) and 2 (run 2): `rollout-fixes.dom.test.tsx` timeouts only — pre-existing, Phase 2 | **0** |

Fail-before logs: `evidence/fail-before/`.
