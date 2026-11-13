# Gate-Sunny-3 — #919 (#210 rebuild): NOT_A_NAME_GUARD_HISTORY + PAYROLL_DEDUCTIBLE_WORD + GROUP_WORDS_NOT_A_NAME + REOPEN_BY_ANY_OPEN_VERB — NO-GO (head e9d645f47)

- Head `e9d645f47` (contains main `0bbf0c901`; tsc clean). Runs, each a full suite with production flags in the env:
  main 0bbf0c901; PR (QA's extra pair: main vs PR, production flags only); PR ON with the four new flags.

| | tests | passed | failed |
|---|---|---|---|
| main 0bbf0c901 | 22,176 | 20,779 | 1,263 |
| PR, production flags | 22,215 | 20,805 | 1,276 |
| PR ON (+4 flags) | 22,215 | 20,789 | 1,292 |

## 1. Main vs PR on production flags: one live REGRESSION from an unflagged hunk

Replay text: **1 of 1,677 records differs**: `nov5-two-names-one-request-no-cross-match` (production). The turn is "I need a
coaching form for Marnie Holloway for her customer service at the register, and a CA for Remy Calder for opening the
salon late on 11/2".

- main: Marnie's Coaching card, with Observation "her customer service at the register", then "Do you want a
  Corrective Action Form for Remy Calder next?"
- PR: the same card, but the Observation is **"her customer service at the register, Remy Calder for opening the salon
  late on 11/2"**. Another person's account is on Marnie's form. The case still passes, because its assertions don't
  cover the Observation.

Cause, confirmed by reverting only this line and rerunning: `intent-slots.ts` `formsNamedTogether` now drops any part
that `isPriorStep` matches, and `PRIOR_STEP_SAID` matches **any date**. "a CA for Remy Calder for opening the salon late
on 11/2" has a date and no asking verb (the verb "need" is in the first part), so it's read as history and the two-form
request collapses. This sits behind FORM_CHOICE_STATED_ENABLED, which is **on in production**, so it would ship live
with no flag. Class: **REGRESSION** (another person's facts on a card).

QA's check: "she completed … coaching 9/29/26" becoming a prior action is intended. `prior-completed-oct25.test.ts`
passes, and no other replay record changes on production flags.

## 2. The PR's new tests fail with production flags on

`history-names-oct25.test.ts` + `cross-chat-history-oct25.test.ts` give 32/32 in a clean env, but **11 failed / 21 passed
with production flags**:
- 8 throw "The company knowledge base could not be searched": they don't stub retrieval that a production flag
  requires. Harness, but it means these tests don't run on production's path.
- 3 are real assertions: "a metric alone opens no Corrective Action card" gets 'Corrective Action Form';
  "bed tech st joe" gets 'Bed Tech', which doesn't match /^bed tech\b/; and PAYROLL_DEDUCTIBLE_WORD "on": "payroll is
  deductable" gets payrollDeduct null, not 'yes'.
- None of the conv_* reports are in the replay pack (CLAUDE.md §2 asks for it), so CI doesn't check them on
  production's flags.

## 3. Flags ON: NOT_A_NAME_GUARD_HISTORY_ENABLED breaks 10 fixed replay arms (wrong person)

PR ON vs PR: 19 replay records differ, and **10 fixed arms go ok True → False**:
`nov5-r2-dm-in-passing-account(-with-the-flip)`, `-employee-with-the-flip`, `-position(-with-the-flip)` (production and
fix arms), and `nov10-sf-b5-guest-attitude-cites-conduct` (production and fix arms).

- `nov5-r2-dm-in-passing-employee-with-the-flip`, turn 2 ("verbal warning The date she complained was Oct 31st …"):
  OFF, the card is for **Odalys Prewett Vansickle** (the employee). ON, it's for **Thessaly Brookhart**, the district
  manager named in passing. Wrong person.
- `nov10-sf-b5-guest-attitude-cites-conduct`: OFF, the card is for Oriel Vantasse. ON, it has **no employee**.

Isolated per flag, on the affected cases with production flags: NOT_A_NAME_GUARD_HISTORY alone gives **11 failed**;
PAYROLL_DEDUCTIBLE_WORD, GROUP_WORDS_NOT_A_NAME and REOPEN_BY_ANY_OPEN_VERB alone each give 0 failed. With
NOT_A_NAME_GUARD_HISTORY on, `groundEmployee` reads names only from `managerWords` (the manager's turns plus accepted
suggestions). A person the card already settled from the roster in an earlier step (state or earlier turns that the
reader doesn't include) is lost, and another roster name in the manager's words wins.

Other ON-only failures: `not-deductible-read-e2e` "off: as main asks again", `ai-reads-code-checks` S1,
`remap-incident-oct24` intent path, `full-manual-production-pages` and history-names "defaults off". I didn't classify
these further; section 3 settles the verdict.

## Verdict

**NO-GO** on e9d645f47.
1. Live, no flag: `isPriorStep` must not treat a part that names a form for **another person** (or any part with "a
   CA for <name>" / "a coaching form for <name>") as history just because it has a date. Add the
   nov5-two-names-one-request Observation as an assertion (Marnie's Observation never contains Remy's account).
2. NOT_A_NAME_GUARD_HISTORY: keep the person the card already holds (state or roster-settled earlier) and add the 10
   nov5-r2/sf-b5 arms to the PR's own run with the flag on.
3. Make the new conv_* tests run on production's flags (stub retrieval, or put them in the replay pack), and fix
   the 3 real assertions there.

The PAYROLL_DEDUCTIBLE_WORD, GROUP_WORDS_NOT_A_NAME and REOPEN_BY_ANY_OPEN_VERB flags show no replay regression on
their own. Splitting them out would let them be gated separately.
