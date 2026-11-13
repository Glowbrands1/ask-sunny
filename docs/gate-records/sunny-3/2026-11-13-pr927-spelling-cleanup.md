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

## Re-gate, head 1daeb29d4 (contains main 394d5b7c5; QA's fixes 1–4) — test fixes GO; flag ON **NO-GO**

### Test-only fixes: GO
- The six touched files (coaching-autocomplete, plan-of-action, edit-policy-ask-schema, form-patch-account-line,
  form-patch-model, spelling-cleanup): clean env, no flags: 57/57; clean env + the flag only: 57/57. With production
  flags, 5 fail both OFF and ON, the **same 5 as main 394d5b7c** (readFormPatch / account-line production-env baseline).
- Full `npm test`, clean env, no flags: 22,285 tests, **3 failed**, all noise:
  - chat-trace.migration fails alone on main too;
  - retrieval-query passes alone on PR and main;
  - flags-off-parity replay first-half child: `spawnSync … ETIMEDOUT` under 5 concurrent runs.
- Prompts with the flag off: replay pack on main 394d5b7c vs PR OFF, with draft, revision and patch system hashes added
  temporarily. **0 of 1,701 shared records differ** (1,262 draft, 223 revision, 347 patch and 209 chat prompts).
- Main vs PR OFF (full, production flags): 1,265 vs 1,267 failed. The replay additions are only the 10 new arms. The
  other flips (create-currency-audit P4, dm-feedback) are known load noise.

### Flag ON: NO-GO (the new field-by-field fallback, `withOwnWords`)
PR ON vs OFF: 1,267 → **1,340 failed (+73)**. The first head (98acc4959) had +6.

1. **A date the app writes out is read as "a date that was not given", and the Observation becomes the raw chat
   request.** `ordinal-date-in-draft-e2e` ON (production flags):
   `[spelling-cleanup] the cleaned draft changed date December 2, 2025 was not given; drafting with the manager's own
   text` → `the fallback draft still changed observation; saving the manager's own words there` → saved Observation
   **"create a CA form for quinn marlowe at kearney. Quinn was late on the 2nd"** (expected "…on October 2, 2026.").
   The same happens for "the 15th". The cleanup check (`cleanupChanges`) treats any date written out from the
   manager's ordinal/relative words, which the existing date repairs do on purpose, as invented. `withOwnWords` then
   saves the manager's whole turn, request words included.
2. **8 fixed replay arms that hold today fail** (production and fix arms):
   - `nov10-sf-s21-template-outline-saved`
   - `nov5-sf-s21-must-see-behaviors-template`
   - `nov7-s34-edit-make-it-about` ("make it about showing up late … make the date for 10/14/26")
   - `nov8-list-policy-on-card-ca`
3. Other ON-only failures in the same family (dates, prior rows, drafted text compared exactly):
   - qa-oct21-audit (16)
   - prior-sentence-fix-live (15) and prior-sentence-fix (5)
   - pm-draft-route ×2 (8)
   - prior-row-not-on-incident-date (4)
   - ordinal-date-in-draft (3)
   - tsd-epp/exit draft routes (4)
   - relative-date-reader, unread-day-date, account-only-policy-query "last tuesday", live-flags-with-reader (a),
     draft-reuse-same-chat
   Some are exact-text expectations that may only need to be flag-aware. But (1) and (2) are behaviour: a manager's
   chat sentence ends up on the form.

The 5 nov13 cases (now including `nov13-spelling-cleanup-fallback-checked-again`) hold ON.

Suggested direction:
- `cleanupChanges` should accept a date that is the same day as one the manager gave ("the 2nd" with the form's
  month/year, "last tuesday" resolved, a corrected year).
- The fallback's "own words" for a field should be that field's previous value or nothing, never the manager's whole
  chat turn.
- Re-run with FLAG_CLASSIFY_ON=SPELLING_CLEANUP_ENABLED and production flags; ON vs OFF should differ only in the
  nov13 arms (plus any exact-text tests made flag-aware, each with a comment).

**Verdict at 1daeb29d4: the test fixes are GO and safe with the flag off (prompts unchanged, suite green apart from
noise). Turning the flag on is NO-GO.**
