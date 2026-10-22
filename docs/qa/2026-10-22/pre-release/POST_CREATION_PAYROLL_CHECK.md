# Payroll corrections after the form exists — targeted safety check (22 Oct 2026)

**Data:** synthetic only — Ask Sunny: "Ellie Sendgraff", salon director at `loc-0310`; Ask Bubbles: "Pat Rivera", `‹Bubbles store id›`. **No HR record read or changed.**
**How:** the real proposal → create → draft (Action Plan) → finalize → read-back routes, then the chat route's handlers in the route's own order (correction → redraft → proposal), per app with its own harness (`corrective-action-chat-edits-e2e` setup). Probe sources and raw JSON: `evidence/post-creation/`. Browser: 3 Playwright cases per app (see `FINAL` evidence).

## Before the fix (final heads of the previous report)

Both apps behaved identically:

| Manager says, after a Yes ($25) form exists | Saved payroll | Action Plan | Chat | Verdict |
|---|---|---|---|---|
| "change payroll deduct to no" / "actually, no payroll deduct" | No | no deduction | "Updated … → No. The Action Plan no longer states a payroll deduction." | ✓ |
| "the $25 payroll deduction was waived" | No | no deduction | same | ✓ |
| "we cancelled the $25 payroll deduction" / "cancel the $25 payroll deduction" | **Yes (kept)** | **"$25 will be deducted…" (kept)** | starts drafting a **new** Corrective Action card | **✗ silent Yes** |
| "hold off on the $25 payroll deduction" / "not sure about the payroll deduction anymore" | **Yes (kept)** | **deduction (kept)** | new card | **✗ silent Yes** |
| Finalized form + "change payroll deduct to no" / "…was waived" | signed record Yes (untouched); **new draft No**, plan without deduction | — | "was finalized, so I opened a new draft…" | ✓ |
| Finalized form + "hold off on the $25 payroll deduction" | signed record Yes; **no draft, nothing asked** | — | new card | **✗ silent Yes** |
| Control: No form + "change payroll deduct to yes" | Yes | states the deduction | ✓ | ✓ |

(An early probe run reported the finalized cases as broken; that was a harness artifact — the fake store did not join template columns for a draft created mid-turn the way the Postgres view does. With the harness corrected, both apps handle explicit corrections to finalized forms correctly.)

## Root cause
`correctActiveForm` (`src/lib/forms/chat-correction.ts`, both apps) changed the payroll answer of a created form only when the reader returned Yes or No. "Cancelled" was not a word the reader knew, and hedged wording is deliberately unreadable — so the turn fell through to the ordinary proposal flow, which offered a new card and left the saved form, and its Action Plan, saying Yes.

## Fix (same in both apps; Bubbles `225bf10`, Sunny `880d19a`, payroll-only `56c45e1`)
1. A cancelled deduction is a waived one: "cancelled / cancel / called off" read **No**; "don't cancel …" / "we did not cancel …" are **asked**, never answered.
2. On a form that asks "Is payroll deduct applicable?", a statement about the deduction that is not a clear Yes or No **clears** the saved answer, rebuilds the Action Plan without a deduction, and asks **"Is payroll deduct applicable? Yes or No?"**; the next bare yes/no answers it. On a finalized form this is done on the new draft and the signed record is left untouched.

## After the fix (both apps, identical outcomes; 0 safety violations)
| Scenario | Saved | Plan | Chat |
|---|---|---|---|
| Yes → "change payroll deduct to no" | No | no deduction | Updated → No |
| Yes → "the $25 payroll deduction was waived" | No | no deduction | Updated → No |
| Yes → "we cancelled the $25 payroll deduction" / "cancel …" | **No** | no deduction | Updated → No |
| Yes → "hold off on…" / "not sure about…" | **cleared** | no deduction | "…isn't a clear Yes or No, so I cleared the answer… **Is payroll deduct applicable?** Yes or No?" |
| …then "no" | No | no deduction | Updated → No |
| Finalized + "change payroll deduct to no" / waived | signed record Yes (untouched); draft **No** | draft: no deduction | new draft opened, change made |
| Finalized + "hold off on…" | signed record Yes (untouched); draft **cleared** | draft: no deduction | new draft opened; asks Yes or No |
| Control: No → "change payroll deduct to yes" | Yes | states the deduction | Updated → Yes |

Invariant checked on every step: on every draft, the saved answer and the Action Plan agree (Yes ⇔ the plan states a deduction), and no draft keeps a Yes after a No, a cancellation, a waiver or a hedge.

## Tests (committed, both apps)
- `src/app/api/forms/qa-payroll-after-creation-e2e.test.ts` — 8 end-to-end cases (cancelled ×2, hedged ×2, hedge then "no", control, finalized change, finalized hedge).
- `src/lib/forms/qa-f01b-payroll-fail-safe.test.ts` — +6 reader cases (cancelled ×4 → No; denied cancellation ×2 → asked).
- **Fail before / pass after: 9 of 51 fail on the previous code, 51/51 after**, in each app (`evidence/post-creation/*-fail-before.log`, `*-pass-after.log`).
- One existing entry changed on purpose: "cancel the $25 payroll deduction" moved from "asked" to "No" (a cancellation is a waiver), commented in the file.

## Residual (not a silent Yes)
- The signed (finalized) record keeps its Yes until the new draft is finalized — by design: a signed HR record is never edited in place; the draft replaces it when finalized, or is deleted.
- A correction typed while NO form is open is handled by the proposal flow, which already withdraws an earlier Yes (overnight fix `14c37f3`/`771466e`).
