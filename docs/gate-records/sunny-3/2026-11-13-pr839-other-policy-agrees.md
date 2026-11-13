# Gate-Sunny-3 — #839 OTHER_POLICY_AGREES + OTHER_NOT_A_POLICY_NAME + ACCOUNT_TYPOS_FIXED (head 33e2a71a)

Head `33e2a71a` (contains main `394d5b7c`; tsc clean). Earlier heads: c0d0d6cf (probed, then superseded), 9a248824
(named-policy fix), 6ee590b0 (skipped: tsc). Runs, full suite, production flags in the env: main 394d5b7c; PR OFF;
PR ON with all three flags (FLAG_CLASSIFY_ON).

| | tests | passed | failed |
|---|---|---|---|
| main 394d5b7c | 22,265 | 20,866 | 1,265 |
| PR OFF | 22,313 | 20,913 | 1,266 |
| PR ON (3 flags) | 22,313 | 20,896 | 1,283 |

## Protected hunk: OTHER_NOT_A_POLICY_NAME in forms/ca-action-plan.ts

The PR's diff matches `docs/patches/other-not-a-policy-name.patch` exactly: same added lines and the same context. The
only difference is the hunk's position (`@@ -105` in the patch vs `@@ -107` on main, because main has 2 more lines above).
Applying the patch to main's file gives a file **byte-identical** to the PR's: sha256
`9e104aae87e696f183e32f1b6870fa01e18134a4645c403678dcff80a197a9d8`. Re-checked on 33e2a71a: unchanged.

## Main vs PR OFF

- Only additions: the new cases' arms plus account-spelling and policy-fields unit tests.
- **0 existing replay records change.**
- Parity first-half child: INTENDED-HARNESS.

## Proof case and nov11 (step 2)

`nov13-sanitation-chat-scripted-card-and-draft-agree`: **OPEN on main/production** (the card cites Care and Cleaning
p.21 while the saved draft is Other) and **holds ON**:
- card `**Policy:** Other`, no Care and Cleaning / p.21 line;
- draft policy_violated "Other";
- after "the 10 minute sanitaion in the morning", the Observation keeps "in the morning";
- the reply names the Observation of Offense change, never "I haven't changed".

nov11 sanitation, holding ON:
- `-other-card-equals-draft`
- `-other-plan-not-other-policy`: no "review the Other policy" (the wording I flagged on #927)
- `-account-typos-mended`
The controls `-other-control-beds` and `-other-control-late` are unchanged.

## Named vs described (step 3)

My 18 wordings (invented person Odessa Quillfeather; Care and Cleaning retrieval and slot heading scripted as live).
With OTHER_POLICY_AGREES + OTHER_NOT_A_POLICY_NAME on 9a248824:
- **Named, all 10 → Care and Cleaning p.21**: "care and cleaning policy", "care and clening", full title, "care &
  cleaning", "care n cleaning", "equipment and facilities", "the cleaning policy", "care and cleaning violation",
  "write up … for care and cleaning".
- **Described, all 6 → Other**, card and saved draft (offense ["other"]).
- On c0d0d6cf, named 2 and 3 went to Other (REGRESSION); 9a248824 fixed them.
- Named 4/5/7–10 were Other on main; fixed too.

Coding-2 made the 12 core wordings cases, `nov13-cleaning-{named,described}-1..6`, plus
`nov13-named-care-and-cleaning-{policy,typo,ampersand}`. All hold ON.

Notes, not from this PR:
- "she did not take care and clean the beds" stays p.21 in both arms. It's correctly not read as naming the policy,
  but the cleaning reader also doesn't read it as a duty left undone.
- Named 1 ("violating the care and cleaning policy") on main, and ON "breaking the cleaning policy", show both "Woven
  does not see a section … won't cite one" and a p.21 line.

## PR ON vs OFF: every changed row

89 replay records differ. Classes:
- **INTENDED**: all target arms. OPEN → holds:
  - the proof case; nov11 ×3; nov13-cleaning-described-1..6 and named-4/5; nov13-named-care-and-cleaning ×3.
  - Plus their fix arms, and nov13-cleaning-named-2/6 (text only, both still pass).
- **INTENDED-ADJACENT**: `nov6-as-you-said-attendance-s2a-opening-cleaning-duties`. The card already said Policy Other
  while the plan said "review the Attendance policy". ON the plan says "the applicable company policy", so they agree.
- **ACCOUNT_TYPOS_FIXED, on every changed Observation (61 records):**
  - mends: performace → performance (sf-s21/s22/s24, MSB format…), corretive → corrective, opend → opened,
    caoching/coahcing → coaching, "10 minute disinfect" → "10-minute disinfect".
  - **REGRESSION**: a correctly spelled word changes. "The date she **complained** was Oct 31st" becomes "she
    **complaint**" in **21 records**: sf-b5, nov5-r2-dm-in-passing ×6, nov7-complaint-in-passing,
    nov7-near-miss-details-delphine(-turned-down), nov7-form-name-empty-card-delphine…, nov10-sf-b5-guest-attitude.
- **Stale with the flag** (INTENDED under the new rule; must be made flag-aware before the flip, and QA should confirm
  the ruling):
  - `remap-incident-oct24` "cleaning duties keep their words and cite Care and Cleaning p.21";
  - `policy-cleaning-incident-oct25` "flag on: cleaning is Care and Cleaning p.21 … card cites p.21 whatever heading".
  These pin POLICY_CLEANING_INCIDENT's older ruling (a described cleaning duty cites p.21). OTHER_POLICY_AGREES
  replaces it with Pau's rule (described → Other).
- Parity children: INTENDED-HARNESS. 0 other status changes.

## ACCOUNT_TYPOS_FIXED: every changed text (step 4)

Direct probes (`cardAccountText`):
- "she let **Shiff** close the regster" → "she let **shift** close the register" (a coworker's **name** changed)
- "Morgan and **Moring** covered the evning shift" → "Morgan and **morning** covered the evening shift" (a **name**)
- "customer Shannon **complaned**" → "**completed**" (a different word)
- "**Clening** was not done" → "cleaning was not done" (sentence capital lost)
- Kept as typed: quotes ("i dont care", 'thats not my job'), dates, numbers, $25, 9:15am, and the employee's own name
  even misspelled ("Odesa", "Quillfeathr").
Plus the replay changes above, including "complained" → "complaint" ×21.

## Eval (step 5)

`evals/flags.json` on = the two policy flags: **63/63**, 42/51 cases pass, and no case changes outcome. With all three:
63/63, same.

## Verdict per flag

- **OTHER_POLICY_AGREES_ENABLED: GO** on 33e2a71a.
  - The proof case and every target hold. Named policy wins (10/10); described is Other (6/6).
  - Before the flip, make the 2 POLICY_CLEANING_INCIDENT tests flag-aware (QA to confirm Pau's newer rule replaces the
    older "described cleaning = p.21").
- **OTHER_NOT_A_POLICY_NAME_ENABLED: GO**. The protected hunk is identical to the approved patch; no plan says "the
  Other policy".
- **ACCOUNT_TYPOS_FIXED_ENABLED: NO-GO**. It changes names (Shiff → shift, Moring → morning) and correct words
  (complained → complaint ×21 replay records; complaned → completed). It stays off per QA's ruling.

Cases that now hold (with the two GO flags): nov13-sanitation-chat-scripted-card-and-draft-agree,
nov11-sanitation-other-card-equals-draft, nov11-sanitation-other-plan-not-other-policy, nov13-cleaning-described-1..6,
nov13-cleaning-named-4, nov13-cleaning-named-5, nov13-named-care-and-cleaning-{policy,typo,ampersand}.
(nov11-sanitation-account-typos-mended holds only with ACCOUNT_TYPOS_FIXED.)

## Delta, head 4d3f80f1 (33e2a71a + main 5d9f1767/0ef33633 + the two pins flag-aware) — GO for 38e

1. **Product diff = only main's merge.** Per file, the PR's own changes (vs its main) are identical, ignoring hunk
   positions, for all 8 product files: form-card-slots, intent-extraction, keep-filled-slots, chat-quality-flags,
   account-spelling, ca-action-plan, ca-policy, policy-fields. Only these differ: remap-incident-oct24.test.ts and
   policy-cleaning-incident-oct25.test.ts (pinned flag-aware) and two case files. The protected ca-action-plan.ts is
   still the approved patch applied to the new main, byte-identical.
2. **1 OFF + 1 ON on 0ef33633's production flags** (CLOSE_SPELLING_MATCH on). ON = OTHER_POLICY_AGREES +
   OTHER_NOT_A_POLICY_NAME; ACCOUNT_TYPOS_FIXED off. SHARED_CITY_ASKS_SALON_ENABLED was set in both arms, but **no such
   flag exists on this head or on main 0ef33633**, so it's a no-op until 38d's change lands.
   - OFF 22,355 tests / 1,265 failed; ON 1,282.
   - The +17 are the 13 target OPEN arms, which now hold (INTENDED), and the 4 parity replay quarters
     (INTENDED-HARNESS).
   - The two previously stale POLICY_CLEANING_INCIDENT tests now pass ON.
   - Replay: 17 records differ:
     - all target arms: proof case, nov11 ×3, nov13-cleaning described 1–6 and named 4–5, named-care-and-cleaning
       typo/ampersand (`-policy` is fixed on main by CLOSE_SPELLING_MATCH);
     - plus nov6-as-you-said-attendance-s2a (INTENDED-ADJACENT: the plan now matches the card's Other).
     0 REGRESSION.
3. **Probes, close spelling on:** named 10/10 → Care and Cleaning p.21; described 6/6 → Other, card and saved draft.
   Named 1 now shows "Care and Cleaning …, as you said — the policy manual's section on page 21" both OFF and ON. The
   old contradictory "won't cite one" card is gone on main.
4. **Eval** (2 flags on): 63/63, 42/51 cases pass, and no case changes outcome.

**GO** on 4d3f80f1 for OTHER_POLICY_AGREES and OTHER_NOT_A_POLICY_NAME. ACCOUNT_TYPOS_FIXED stays NO-GO and off.
