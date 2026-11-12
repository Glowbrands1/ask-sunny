# Gate-Sunny-3 — ONE_CARD_ONE_PAGE_ENABLED (flag only) — GO

- Base: Sunny main `a5b96f4d` (flag-only gate; the OFF arm is the same main OFF run as FULL_POSITION_TITLE's)
- Flag: `ONE_CARD_ONE_PAGE_ENABLED`
- Method: 1 OFF + 1 ON, full `npx vitest run` with production's flags (`on` + `assumedOn`) in the env. ON adds the flag
  to the env and to `FLAG_CLASSIFY_ON`. Replay text recorded with `REPLAY_RECORD`.

## Results

| | tests | passed | failed |
|---|---|---|---|
| OFF | 21,797 | 20,404 | 1,259 |
| ON  | 21,797 | 20,394 | 1,269 |

Test status changes OFF → ON (+10 failures, all `it.fails` arms of cases that now hold):

| Test | Class |
|---|---|
| the 9 `nov9-one-card-one-page-*` cases (another, another-model-heading, cash-drawer, cash-drawer-model-heading, coaching, for-being-short, for-being-short-model-heading, front-desk, front-desk-model-heading): OPEN arm passed → failed | INTENDED: each now holds |
| flags-off-parity, replay pack second half | INTENDED-HARNESS: the same cases in parity's child run |

Nothing else changed status.

`nov10-citation-page-agrees-cash-drawer` **is not in Sunny's pack** (no match anywhere in the tree at a5b96f4d), so
it was neither run nor held here. It may be a Bubbles-only case id.

## Replay text (1,585 records): 134 differ

| Change | Records | Class |
|---|---|---|
| The 9 target cases: the card's citation line takes the Policy line's page (p.12 → p.13), and the Coaching card drops its second p.12 line | 10 (9 open arms + 1) | INTENDED |
| A passing card whose Policy line names "**<Section>** (page N)" gains the line "<Section> Policy, JBA Policy Manual p.N" under Job title (Standards of Conduct p.12/p.13, Attendance p.14). The cases still pass; the system prompts are the same. | 124 | INTENDED-ADJACENT: the flag's own doc says "a card whose Policy line names a section with its page gets the citation line" |

Check over every ON reply (1,339 citation lines): each line agrees with its card's Policy line, with 4 exceptions in 2
cases, both **unchanged from OFF** (two-policy cards, pre-existing):
`nov5-kitten-account-not-awaiting` (Policy: Animals in the Workplace p.30; line: Visitors in the Workplace p.29) and
`nov9-model-policy-defers-took-money` (Policy: Standards of Conduct p.13; line: Handling Theft p.30). Not caused by the
flag. Noted for QA.

0 REGRESSION.

Eval (`evals/flags.json` on = `ONE_CARD_ONE_PAGE_ENABLED`): 63/63 tests; 51 cases, 42 pass off and 42 on, and no case
changes outcome. Latency p50/p95: off 176/953 ms, on 163/923 ms.

## Verdict

**GO.** The open cases that now hold are the 9 `nov9-one-card-one-page-*` cases. QA should expect about 124 more passing
cards to show the citation line.
