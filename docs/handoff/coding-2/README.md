# coding 2 handoff (10 Nov 2026, ~18:30Z)

Docs only. This records the work of the session that was "coding 2" for Ask Sunny and Ask Bubbles. That session is being replaced (account migration).

## Role

- Gate, push and port fixes in both apps.
- Single writer of `src/lib/ai/server-ask.ts` in both apps:
  - no `process.env`, no `.catch(`;
  - every diff needs QA or Pau approval.
- Single writer of the `ca-policy.ts` changes routed to coding 2.
- Never merges, never flips flags, never redeploys. QA does that.

## Pushed tonight

### Ask Sunny

| What | Branch | Head | PR |
|---|---|---|---|
| Round 22 release, QA's (eval flags, fixtures, sf-s4 and s14 fixes, replay cases) | claude/gate-sunny-r22 | ee7e373f | #783 |
| CHAT_PARALLEL_LOADS early few-shot | claude/parallel-loads-early-few-shot | 5c64bac8 | #784 |
| NOT_FOLLOWING_IS_VIOLATION | claude/not-following-is-violation | 84f86253 | #794 |
| CARD_READY_NEEDS_EMPLOYEE | claude/card-ready-needs-employee | b209c469 | #795 |
| Roster set retry #3 (inside #783) | claude/roster-name-set | c2f1d74f | #741 |
| Group-4 reruns | (PR branches) | 9429635a / 4dbf6de3 / db3eae89 / fae84f8a / 063a8fe4 / 4fd4398f / 195b3028 / 10bb06cb | #589 / #587 / #593 / #551 / #545 / #662 / #585 / #568 |
| TERMINATION_STATED_TICKS server-ask wrap, gated, on coding 6's branch; coding 6 opens the PR | claude/termination-stated-ticks | c0f25752 | none yet |
| ROSTER_COMPOUND_FIRST_NEAR_MISS ("Delphine Marlwoe Ostrander", sf-b5); not full-gated | claude/roster-compound-first-near-miss | 90ed39f5 | none: new PR off main after #783 merges |
| TYPO_CORRECTED_SAME_PERSON: flag, guard case, patch; gate was running at handoff | claude/typo-corrected-same-person-wip | 00c41c49 | none |

### Ask Bubbles

| What | Branch | Head | PR |
|---|---|---|---|
| Round 16c release, QA's (sf-s4 and s14 port cherry-picked) | claude/gate-bubbles-r16c | d7487833 | #665 |
| CA_REASON_DUE_TO rebuilt on main; closes #501 | claude/ca-reason-sales-path | f8917127 | #703 |
| Test-only cases for B#453 and B#591 | claude/new-session-y9eevx | 8946cd12 | #701 |
| NOT_FOLLOWING_IS_VIOLATION | claude/not-following-is-violation | 131400e9 | #712 |
| NEAR_MISS_ANSWER_KEEPS_REQUEST (s14 path 1), based on r16c | claude/near-miss-answer-keeps-request | caf15503 | #716 |
| TYPO_CORRECTED_SAME_PERSON (s14 path 2): flag, open case, patch | claude/typo-corrected-same-person | ca4d0a01 | none |
| Group-4 reruns | (PR branches) | d71d2d50 / 357cd313 / aa3b1b87 / cdf644cc | #504 / #500 / #480 / #464 |
| ROSTER_COMPOUND_FIRST_NEAR_MISS; not full-gated | claude/roster-compound-first-near-miss | 67e04877 | none: follow-up after #665 ships |
| TERMINATION_STATED_TICKS server-ask wrap; gate was running at handoff | claude/termination-stated-ticks-wip | ef493c44 | none |

### Old local work, pushed as `-wip`

- Ask Sunny:
  - claude/card-meta-turns-stacked-wip
  - claude/card-name-then-words-wip
  - claude/kept-request-same-form-wip
  - claude/new-session-y9eevx-wip
  - claude/sf-s15-care-and-cleaning-wip
  - claude/r4-wip
- Ask Bubbles:
  - claude/bub-r16c-port-911b-wip (superseded)
  - claude/ca-reason-due-to-wip (superseded by #703)
  - claude/card-meta-turns-stacked-wip

**Stray duplicates to delete** (Ask Sunny; created by mistake at handoff; same heads as their `-wip` copies; branch deletion was blocked for this session):

- card-meta-turns-stacked
- card-name-then-words
- kept-request-same-form
- new-session-y9eevx
- sf-s15-care-and-cleaning
- r4

## First thing the replacement should do

1. Check that `claude/typo-corrected-same-person` (Ask Sunny) and `claude/termination-stated-ticks` (Ask Bubbles) finished their gates and were pushed.
   - If not, gate them (lint, tsc, `npm test`) from the `-wip` heads above, and push them as fast-forwards.
   - For termination, the base is coding 6's 1e97a4ce.
   - Then send both termination heads to coding 6, who runs the eval and opens the PR pair.
2. Ask QA whether Pau approved the TYPO_CORRECTED_SAME_PERSON lines. The patch is `docs/patches/typo-corrected-same-person.patch` on that branch, in both apps. If approved, apply it and add a unit test for `same()`. On Bubbles, flip the replay case to holding.

## Queue after that

1. Cash-handling citation: the card says Standards of Conduct p.12, the reply says p.13.
   - Both pages are real: chunk 36 is the heading on printed page 12; chunk 37 is printed page 13 and holds "Register / Bank shortages".
   - Waiting on QA's choice:
     - (a) p.12 everywhere;
     - (b) the exact page;
     - (c) pp.12–13.
   - Then build behind CITATION_PAGE_AGREES_ENABLED and check Bubbles.
2. ROSTER_COMPOUND_FIRST_NEAR_MISS PRs, after #783 / #665 merge.
3. GROUNDED_ENTITIES audit in Ask Bubbles, after #665 is live. Cases:
   - nov4-pau-metrics-not-people-unknown
   - nov5-r3-off-roster-lowercase-action-plan
   - nov5-twin-gate-ima-off-roster-observation
4. coding 4's live case `claude/not-following-live-case` (4e268731) as a follow-up PR on #794.

## Gotchas

- **Protected files** (they need Pau's lines via QA):
  - ai/form-proposal.ts
  - forms/proposal.ts
  - forms/form-date-answer.ts
  - forms/instances.ts
  - forms/payroll-deduct.ts
- **Flag pairing:** FORM_NAME_FROM_ROSTER ships and rolls back together with FORM_NAME_OFF_ROSTER_ASK. Without the second, 11 eval cases lose their off-roster names.
- **Eval counts:** `npm run eval` gives Ask Sunny 63 (replay 52 plus judge 11) and Ask Bubbles 35. Running replay.eval.ts alone shows 52.
- **Eval and bisect runs:** delete `evals/results/latest.json` before each run. A run that runs nothing leaves the old file behind.
- **Running suites:** never edit files in a worktree while its suite runs; it taints the run.
- **Production-env `npm test`:** it fails over 1,000 default-off pins even on main, so it is not a gate.
- **`*-flags-off` fixture tests** (noop-guard, glossary): newly flipped production flags go in their FLIPPED lists, with "Changed on purpose" comments.
- **`scripts/gate.sh`:** it removes and re-adds `wt/<repo>-<branch>`. A branch checked out in another worktree gives WORKTREE-FAIL.
- **s14:** Ask Sunny keeps the date through its stored form state. Ask Bubbles needs both path fixes (NEAR_MISS_ANSWER_KEEPS_REQUEST and TYPO_CORRECTED_SAME_PERSON).

## Files here

- `scripts/`: the session's gate, lane, rerun, follow-up, watch, eval-arm and bisect scripts. They hold sandbox paths only, no credentials.
- `open-pr-audit-2026-11-10.md`: the open-PR audit of 10 Nov.
