# Gate-Sunny-3 — #909 PAYROLL_AMOUNT_AFTER_PAYROLL_ENABLED (live bug) — GO

- Head `c03285037` (contains main `7e8dcdb6f`; tsc clean). 1 OFF + 1 ON, full suite, production flags in the env; ON
  adds PAYROLL_AMOUNT_AFTER_PAYROLL_ENABLED.
- The change is in `forms/payroll-deduct-answer.ts`, `payrollAmountWording`. A figure right after "payroll" (", of",
  "is", "amount (of)", ":") is rewritten to "payroll deduction of <figure>", and the existing amount reader decides
  whether it is money.

| | tests | passed | failed |
|---|---|---|---|
| OFF | 22,169 | 20,768 | 1,267 |
| ON  | 22,169 | 20,774 | 1,261 |

Status changes:

| Test | Class |
|---|---|
| replay `nov12-payroll-amount-after-payroll` OPEN arm: it now holds | INTENDED |
| flags-off-parity, replay-pack halves (children) | INTENDED-HARNESS |
| `intent-extraction.test.ts` "a lowercase name is the roster spelling …" ("… payroll $25.") and "reads payroll from dollars, a dollar sign, and a decimal" ("payroll of 25.00 dollars"): fail on the production baseline, pass ON. Confirmed by running the file alone, OFF and ON. | INTENDED (the live wordings) |
| date-answer-applied, live-flags-with-reader (a), form-revisions-e2e, directory-screen, chat-trace.migration: failed → passed in the full run only. Run alone, OFF and ON give the same result. | noise |

Replay text (1,675 records): **1 differs**, the target. The card now says "**Payroll deduction amount** **$25**",
the amount isn't asked again, and the draft's amount is $25. 0 REGRESSION.

Reader probes, production flags (OFF → ON amount):
- read: "… payroll $25." null → $25; "payroll of 25.00 dollars" null → $25.00; "payroll is $40" → $40;
  "payroll amount: $15.50" → $15.50; "payroll $25 and a write up" → $25.
- unchanged (null): "payroll 25" (bare number), "payroll 11/1/26 …", "payroll 2026 was wrong", "asked about payroll 3
  times", "payroll 2 weeks ago", "talked to payroll 9/29 …", "no payroll, $25 short", "$25 short, payroll it".
- Negations: "no payroll $25" now reads the amount with the answer "no". That matches main's existing reading of "no
  payroll deduction $25" ($25, "no"). End to end, the card says **No** and shows no amount, the same as OFF.
  "don't do payroll $25 this time" reads $25 with no answer, so the card asks "Is payroll deduct applicable?". In my
  probe, answering "yes" gave "Yes, $25". Main does the same for "don't do payroll deduction $25" (answer "unclear").
  Not new behaviour; a note only.
- End to end: "talked to payroll 11/2 about it" doesn't change; "payroll is $40" fills $40 instead of asking.

Eval (flag on): 63/63, 42/51 cases pass, and no case changes outcome.

**GO.** The case that now holds is `nov12-payroll-amount-after-payroll`.
