# Gate-Sunny-3 — #922 SAME_NAME_ASKS_WHICH_ENABLED (live wrong-person bug) — GO (head fd748d669)

Head `fd748d669` = main `0bbf0c901` + 2 commits; tsc clean. 1 OFF + 1 ON, full suite, production flags in the env
(`on` + `assumedOn`); ON adds SAME_NAME_ASKS_WHICH_ENABLED (via FLAG_CLASSIFY_ON). The first pair was killed by a
container restart at about 03:00 and re-run in full.

## (1) Protected form-proposal.ts hunk — byte for byte

- `git diff 0bbf0c901 fd748d669 -- src/lib/ai/form-proposal.ts` gives the **same hunks** as
  `docs/patches/same-name-asks-which.patch` (`diff` of the `@@…` bodies: identical; only the abbreviated index
  hashes in the header differ in length).
- Applying the patch to 0bbf0c901's form-proposal.ts gives a file **byte-identical** to the PR's: sha256
  `eb5496721096320022a7c14896d83a41a468d431bdf94ddf8d8f6f6762e1cd67` for both. No other form-proposal.ts change.

## (2) Full runs

| | tests | passed | failed |
|---|---|---|---|
| main 0bbf0c901 | 22,176 | 20,779 | 1,263 |
| PR OFF | 22,192 | 20,796 | 1,262 |
| PR ON | 22,192 | 20,792 | 1,266 |

PR ON vs OFF: replay text, **4 of 1,685 records differ**, exactly the 4 target OPEN arms, which now hold:
`nov12-same-name-asks-which`, `nov12-same-name-numbered-reply-selects`, `nov12-same-name-title-reply-selects`,
`nov12-same-name-salon-reply-selects`. The rest:
- the parity first-half child: INTENDED-HARNESS;
- intent-extraction "a salon reply selects that person" (a main baseline failure on production flags): failed →
  passed ON.

0 REGRESSION.

## (3) The stand-in's loadScopedRoster now applies withinRosterLimit — what moves OFF

Main vs PR OFF: besides the 8 new arms, **12 existing records change** (all still pass). All are two-person requests:
`nov5-request-slot-two-people`, `nov6-two-forms-own-person-full`/`-lowercase`,
`nov7-two-forms-each-person-coaching-and-ca`/`-yes-starts-b`, `nov8-two-forms-offer-name-lowercase` (production and fix
arms).

Proof that this is the harness alone: I applied **only** the stand-in change (replay-pack-e2e.test.ts + the exported
`withinRosterLimit`) to main 0bbf0c901 and re-ran those cases. **All 14 records are byte-identical to PR OFF.**
`employee-roster.ts`'s refactor keeps the same logic. Class: **INTENDED-HARNESS**. The stand-in now matches
production's roster limit, so these records show what production does today. Two of them may be worth a look by QA,
though not because of this PR:
- `nov5-request-slot-two-people` ("CA for Wilhelmina Corvina and Peregrine Varnholt for being late"): the card is now
  headed for **Peregrine Varnholt** with "review the Attendance policy with Peregrine". The old stand-in had no header
  and Wilhelmina's plan.
- `nov6/nov7 two-forms` ("Coaching form for Peregrine Ashcombe. Also a CA for Tamsin Wexley."): the Coaching card now says
  "Everything I need is here, drawn from your message above. I have the employee and the salon…" where the old
  stand-in said "You haven't told me what happened yet". No account was given, so the new wording overstates it.

## (4) Selection by identity (production flags; uncommitted probes; invented names)

Roster: Marnie Holloway (Tanning Consultant, Kearney) + Marnie Holloway (Assistant Salon Director, Kearney); a second
set with a Marnie Holloway at Grand Island. The form row stores name + title + salon (no employee id), so identity is
checked on what Create saves:

| Probe | OFF | ON |
|---|---|---|
| first turn | ready, title **Tanning Consultant**, nothing asked (the bug) | "Did you mean 1. **Marnie Holloway** (NE Kearney, Tanning Consultant) or 2. … (NE Kearney, Assistant Salon Director)?", no title |
| "2" / "1" | — | saved: Assistant Salon Director / Tanning Consultant |
| "the assistant salon director" / "the tanning consultant" | title only by text | saved: ASD / TC |
| salon "NE Grand Island" / "kearney" | — | saved at loc-0307 / loc-0309 |
| the slot model reads employee "Marnie Holloway" (also lowercase, also with title TC) | TC, nothing asked | still asks; "2" → ASD, "1" → TC; never asks again |
| twins: same name, salon AND title | TC, nothing asked | asks; "2" selects **nobody** (asks again); no wrong-person save possible |

Notes (non-blocking):
- While the choice is open the card's status is "ready" with no title, so a Create before answering saves a form
  with no title, not the wrong person's.
- The PR's 2 new intent-extraction unit tests ("TYPED_NAME_PROCEEDS on (production) … on: …choice that shows salon and
  title" / "…numbered reply selects…") pass in a clean env but **fail with production flags, even with the flag on**.
  A leave-one-out search over all 373 production flags finds the cause: **CORRECTED_EMPLOYEE_SLOT_ENABLED**.
  `withCorrectedEmployee` clears `ambiguous` when the request names the person and no single exact match exists.
  The full route still asks, through form-proposal and grounded-entities (probes above), so the live behaviour is
  right. But the intent path alone isn't, and the tests don't run on production's flags. Tidy-up for Coding-6:
  pin CORRECTED_EMPLOYEE_SLOT in those tests, or have `withCorrectedEmployee` keep a same-name ambiguity when the flag
  is on.

## (5) Close match stays a note; roster/name cases

With the flag on, **no replay record other than the 4 targets changes**: every TYPED_NAME_PROCEEDS, near-miss and
roster case gives the same text. `hasSameNamePair` needs two candidates with the **same** normalised name, so a close
match ("Test Employee" / "Test Employee Two") stays a note. Eval (flag on): 63/63, 42/51 cases pass, and no case
changes outcome.

## Verdict

**GO** on fd748d669. Cases that now hold: `nov12-same-name-asks-which`, `nov12-same-name-numbered-reply-selects`,
`nov12-same-name-title-reply-selects`, `nov12-same-name-salon-reply-selects`.
