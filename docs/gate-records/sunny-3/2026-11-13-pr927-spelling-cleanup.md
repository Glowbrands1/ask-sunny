# Gate-Sunny-3 — #927 SPELLING_CLEANUP_ENABLED — GO on behaviour; CI red (13 tests) until fixed (head 98acc4959)

Head `98acc4959` = main `0bbf0c901` + 2 commits (port of Bubbles 3b1ce5ae + QA's quote guard); tsc clean. 1 OFF + 1 ON,
full suite, production flags in the env; ON adds SPELLING_CLEANUP_ENABLED (via FLAG_CLASSIFY_ON).

| | tests | passed | failed |
|---|---|---|---|
| main 0bbf0c901 | 22,176 | 20,779 | 1,263 |
| PR OFF | 22,192 | 20,785 | 1,273 |
| PR ON | 22,192 | 20,779 | 1,279 |

## Only the 4 nov13 cases change

PR ON vs OFF, replay (1,685 records): **4 differ**, exactly the 4 nov13 OPEN arms, which now hold:
`nov13-spelling-cleanup-sanitation`, `-name-changed-redrafts`, `-quote-kept-as-typed`, `-quote-as-typed-saved`.
Main vs PR OFF: the only additions are those 8 new arms, and 0 existing records change.

## Sanitation: saved Observation and Policy Other

"please make a ca for Brisa Talmadge for not doing th e10 minute sanitaion" (invented person), saved values after
Create:
- OFF: Observation "…not doing the 10-minute sanitation.", Policy **Standards of Conduct** (p. 12), Type of
  Offense standards_of_conduct (the reported bug).
- ON: Observation "Observed:\nBrisa Talmadge was not doing the 10-minute sanitation.", Policy **Other**, Type of
  Offense **other**. One draft call, and the rule is in its system.
- The plan reads "Management will review **the Other policy** with Brisa. …". Main already writes this wording for
  every cleaning → Other card with the flag off (checked with "…not doing the 10 minute sanitizing"), so it isn't new.
  A note for QA.

## Name and quote cases redraft without the rule

- `-name-changed-redrafts`: the draft respells "Talmage". There are 2 draft calls: the first system has "SPELLING,
  SPACING AND CAPITALS", the second doesn't.
- `-quote-kept-as-typed`: a draft that mends "i dont care" → "I don't care." makes a second call without the rule.
- `-quote-as-typed-saved`: a draft that keeps "i dont care" makes 1 call and saves the quote as typed.
- Note: after the fallback, the second draft isn't checked again (in the code, for the draft route, the Step B
  revision and the patch reader), so a model that changes a fact twice would be saved. Not blocking. The fallback has
  no cleanup rule, so it is main's prompt.

## Prompts byte-identical with the flag off

The replay records hash only the chat model's system, so I temporarily added hashes for every **draft**
(anthropic create), **revision** (revise_form_fields) and **Step B patch** (callFormPatchModel) system. I ran the whole
replay pack on main and on PR OFF with production flags. Across all 1,677 shared records, **0 differ**: 1,256 draft,
223 revision, 347 patch and 209 chat system prompts all identical. (The instrumentation was reverted after.) This
matches the code: OFF, the draft route uses `systemFor(false)`, chat-revision uses `systemFor(true)` (which keeps
LANGUAGE_CLEANUP_RULES as before), and the patch reader uses `systemFor(false)`.

## Blocking: 13 tests fail on the PR in a clean env (CI red)

`coaching-autocomplete.test.ts` (7) and `plan-of-action.test.ts` (6) fail on the PR **with no flags at all** (clean env:
13 failed / 28 passed; main: 41/41). They read the draft route's source and slice from `const system = [` to `const
prompt = [`. The PR renamed it to `const systemFor = (cleanup: boolean) => [`, so the slice is empty ("expected '' to
contain 'PLAN_OF_ACTION'"). This is a harness break, not a prompt change: the prompts are byte-identical (above). But
`npm test` is red, so CI on #927 fails. Fix: keep a `const system = [` literal in route.ts, or point the two tests'
slice at `systemFor`.

Also with the flag ON: `edit-policy-ask-schema.test.ts` "on (with Step B): …endsWith(EDIT_POLICY_ASK_LINES)" fails,
because the cleanup rules are now appended after it, as the PR intends. INTENDED-HARNESS; make it flag-aware before the
flip.

Other: the parity first-half child is INTENDED-HARNESS. Eval (flag on): 63/63, 42/51 cases pass, and no case changes
outcome.

## Verdict

**GO on behaviour** (0 REGRESSION; prompts unchanged OFF). **Not mergeable until** the 13 source-slice tests pass on the
PR, since CI is red, and the edit-policy-ask test should be made flag-aware before the flip. Cases that now hold:
`nov13-spelling-cleanup-sanitation`, `-name-changed-redrafts`, `-quote-kept-as-typed`, `-quote-as-typed-saved`.
