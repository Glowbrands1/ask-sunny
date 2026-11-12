# Gate-Sunny-3 — #893 DETAILS_FROM_EARLIER none-found (LIVE fix) — GO

- Head: `a68ba675` (Coding-4). Merged onto main `05576461` with no conflicts; tsc clean.
- DETAILS_FROM_EARLIER_ANSWER is on in production, so the comparison is **main `05576461` vs the PR, both on production
  flags**. 1 + 1, full `npx vitest run`.
- The change is in `forms/form-content-turn.ts`. With no earlier content answer, `referredAnswer` falls back to the
  flag-off reading, and `APPS_OWN_REPLY` also covers "Who is this **<form>** for?" and "Which of them is this".

## Results

| | tests | passed | failed |
|---|---|---|---|
| main 05576461 | 21,884 | 20,491 | 1,259 |
| PR a68ba675 | 21,886 | 20,489 | 1,263 |

Status changes:

| Test | Class |
|---|---|
| new replay `nov12-details-from-earlier-answer-none-found`: holds with production's flags | INTENDED |
| new unit `form-content-turn.test.ts` "no earlier content answer … reads the turn as the flag-off reading does" | INTENDED |
| form-revisions-e2e (1), qa-payroll-after-creation-e2e (1), chat-trace.migration (2): passed → failed in the full run | **noise**: run alone with production flags, these same 4 fail on main 05576461 *and* on the PR (4 failed / 18 passed on both). Order- or load-dependent (4 suites were running at once), not caused by this PR. |

Replay text (1,590 → 1,591 records; the 1 added is the new case): **2 existing records differ**, both
`nov7-refusal-bub-didnt-edit` (production arm and Step B fix arm). At turn 5, "can you upate the draft with these
details of coaching?" (the same words as the live report):

- main: the free chat model answers ("A grounded answer from the policy manual." in the stub)
- PR: "I haven't changed the **Coaching Form** for **Oswin Marchbank** — everything on it is as it was. Tell me which
  part to change and what it should say, and I'll update just that."

The system prompt for that turn differs too, because the turn no longer goes to the free chat model. The case still
passes. Class: **INTENDED-ADJACENT**: it is the live bug itself, reached by an older case. The reply is now honest
instead of a free-model answer that could claim an update.

0 REGRESSION. Eval on the PR head: 63/63, the off column equals the baseline, 42/51 cases pass, and no case changes outcome.

## Verdict

**GO.** The case that now holds is `nov12-details-from-earlier-answer-none-found` (new). The same wording in
`nov7-refusal-bub-didnt-edit` no longer reaches the free chat model.
