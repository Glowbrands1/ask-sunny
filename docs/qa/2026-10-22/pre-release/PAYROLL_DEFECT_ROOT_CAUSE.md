# Ask Bubbles — negated or waived payroll deduction saved as "Yes": root cause, fix, tests, historical impact

Status: **production `main` (`3395e8d`) is affected. Not fixed in production. Nothing deployed.** Fix prepared on the held branches only.

## 1. What happens

A manager writes, in the Ask Bubbles chat, a Corrective Action request that says the deduction will **not** be taken — for example:

| Manager's words | `main` reads | Correct |
|---|---|---|
| "we will not payroll deduct $25" | **Yes** | No |
| "don't payroll deduct $25" | **Yes** | No |
| "the $25 payroll deduction was waived" | **Yes** | No |
| "not going to payroll deduct $25", "we decided not to payroll deduct $25", "no longer payroll deducting $25", "we waived the $25 payroll deduction", "she will not be payroll deducted $25" | **Yes** | No |
| "we're not doing the $25 payroll deduction", "skip the $25 payroll deduction", "no need for the $25 payroll deduction" | **Yes** | No / ask |
| "payroll deduct $25 does not apply" | **Yes** | No |
| "maybe payroll deduct $25" | **Yes** | ask |

The chat card then says **"Is payroll deduct applicable? Yes — tell me if that should change."**. If the manager presses Create without correcting it, the form is saved with **Yes** ticked, and the drafted Action Plan says **"$25 will be deducted from <first name>'s pay."**

Evidence: `evidence/pre-release/payroll-edge-*.json` (33 sentences × every checkout), `evidence/final-probes/reviewer-bubbles-main.json` (Ask Bubbles repository), browser save/read-back in `evidence/browser/`.

## 2. Exact production code path (Ask Bubbles `main` `3395e8d`)

| Step | File:line | What it does |
|---|---|---|
| 1. Read the sentence | `src/lib/forms/payroll-deduct.ts:126-140` `statedPayrollDeduct` | Splits into clauses; a clause matching any `NEGATIVE` pattern is No, else any `POSITIVE` pattern is Yes |
| 1a. **The defect** | `payroll-deduct.ts:98-101` (`POSITIVE`) | `/\b(?:payroll\s+)?deduct(?:ion\|ed\|ing)?\s+(?:of\s+\|for\s+)?\$\s?\d/` ("payroll deduct $25") and `/\$\s?\d…\s+payroll\s+deduct/` ("$25 payroll deduction") — *"an amount to take is a yes"* |
| 1b. Why the negation is missed | `payroll-deduct.ts:75` (`NEGATIVE`) | `(don't\|won't\|will not\|not…)\s+(?:be\s+)?deduct` allows only "be" between the negation and "deduct", so "will not **payroll** deduct" and "don't **payroll** deduct" do not match; **no pattern reads a waiver**, "skip", "no need for", "not doing", or "does not apply" after an amount |
| 2. Conversation answer | `payroll-deduct.ts:224-263` `payrollDeductFromConversation` (line 248) | Last manager turn that states an answer wins |
| 3. Card | `src/lib/ai/form-proposal.ts:918-923` | `proposal.payrollDeduct = payrollDeductFromConversation(...)` |
| 3a. Card text | `form-proposal.ts:2710-2713` | "Is payroll deduct applicable? **Yes** — tell me if that should change." |
| 4. Create request | `src/features/chat/create-inline-form.ts:140` | Browser sends `payrollDeduct: "yes"` with the create request |
| 5. Saved | `src/app/api/forms/instances/route.ts:272-279` → `src/lib/forms/instances.ts:598-622` `applyStatedFacts` | Writes `form_instance_values` row `field_key='payroll_deduct'`, `checked=["yes"]`, `filled_by='system'`, `provenance={"source":"manager_statement"}`. **The server does not re-read the conversation for payroll** (it does for the warning level, `route.ts:291-296`): the value the card sent is trusted |
| 6. Action Plan | `src/app/api/forms/instances/[id]/draft/route.ts:1308-1311, 1697-1702` → `ca-action-plan.ts:158` `planPayrollAmount` → `payroll-deduct.ts:382-391` `payrollDeductSentence` | With the stored Yes and the amount read from the notes, the plan states "$25 will be deducted from Pat's pay." |
| 7. Second write path (after the form exists) | `src/lib/forms/chat-correction.ts:89, 223` | A later chat turn is read with `payrollDeductCorrection` → `statedPayrollDeduct`; a misread Yes is written onto the open form as the manager's edit (`filled_by='manager'`). *Established by code reading; covered by the same reader fix.* |

## 3. When it was introduced

| | |
|---|---|
| Introducing commit | `ac36870` — "Corrective Action from chat: HR's 21 Oct wordings, end to end" (2026-10-21 20:08 UTC). It added the two amount patterns (lines 96-101) |
| First `main` commit containing it | `11d1728` — merge of Ask Bubbles PR #63, **2026-10-21 20:55:22 UTC** |
| Before that | Every earlier `main` checked — `b8a45e7` (8 Oct), `12d2313`, `67765f3` (21 Oct, PR #64, the last before #63) — returns **"not stated"** for every negated sentence above, so the manager was asked. **No false Yes before PR #63** |
| Deployment window | From the first **production deployment** containing `11d1728` until a fix is deployed. **QA did not query production or Vercel**, so the deployment time is not verified — it is step 1 of the audit plan |
| Ask Sunny | Production `main` (`1feaa75`) is **not affected**: it never read an amount alone as Yes (returns "not stated" and asks). The Sunny **branch** carried the same reader (ported from Bubbles) and gets the same fix |

## 4. The fix (two commits, same in both apps)

1. **F-01** (`c527329` Bubbles branch / `5b208c5` Sunny branch; `4df6fbb` on the payroll-only option): any negation of the deduction, with or without "payroll", is No; a waived deduction is No; an undecided clause ("maybe", "not sure") is asked; a clause that says both is asked.
2. **F-01 follow-up — fail-safe** (`e061750` Bubbles branch / `9e84273` Sunny branch; `2897163` on the payroll-only option), found by this pre-release review: a Yes read from **an amount or a verb** (as opposed to "yes" / "applies" / "is applicable") is a Yes only when no word beside it — up to a comma either side — denies, waives, cancels or replaces it; otherwise the manager is asked. "payroll deduct $25 does not apply" is No; a denied waiver ("we did not waive …") is asked, never No. A later unclear statement in the conversation withdraws an earlier Yes, so the card asks again.

**Regression impact.** No sentence becomes Yes that was not Yes before. Some amount-only sentences with a denial next to them now **ask** instead of answering (e.g. "she did not call, payroll deduct $25" still reads Yes because the comma separates them; "payroll deduct $25 because she did not call" reads Yes; "no call no show payroll deduct $25" is asked). The card always offers an explicit Yes / No.

Result on the 33-sentence edge set (`evidence/pre-release/payroll-edge-hardened.json` (Ask Bubbles repository)): **0 false Yes, 0 false No**; every plain Yes still Yes; every plain No still No.

### 4b. Two more payroll defects found and fixed during the overnight validation

3. **Amount with the clause's comma** (`72c24be` Bubbles / `16b2836` Sunny / `711f893` payroll-only). "payroll deduct $25, she was late" put **"$25, will be deducted from Pat's pay."** on the Action Plan: the money pattern `\$\s?\d[\d,]*` took the comma that ends the clause as part of the amount. Present on **both apps' `main`** (Sunny `main` reaches it only through wordings it reads as Yes, e.g. "she owes $25, payroll deduction applies"). A comma is now part of an amount only between digit groups ("$1,250"). 7 tests; 3 fail before.
4. **A withdrawn Yes stayed on the card** (`14c37f3` Bubbles / `771466e` Sunny / `483e6b4` payroll-only). After "payroll deduct $25", the turn "actually we're not doing the $25 payroll deduction" left the open Corrective Action form for a general answer, so the card already shown kept saying **Yes**. The open-form continuation (`form-proposal.ts`, payroll block) only recognised a turn the reader could answer Yes or No; it now also keeps a turn that is about the deduction but unclear, the earlier Yes is withdrawn, and the card asks. Present on both `main`s. 4 tests; 4 fail before.

## 5. Tests

| Test | Cases | Fails before |
|---|---|---|
| `src/lib/forms/qa-w1-payroll-negation.test.ts` | 31 (negative, positive, undecided, contradictory, conversation) | 24 of the 36 W1 tests fail on the code before F-01 |
| `src/lib/ai/qa-w1-payroll-proposal.test.ts` | 5 (through `proposeFormForTurn`, turn by turn) | (included above) |
| `src/lib/forms/qa-f01b-payroll-fail-safe.test.ts` | 31 (denials beside an amount, "does not apply", denied waiver, every plain Yes, conversation withdrawal) | **16 fail on `main` `3395e8d`; 10 fail on the first F-01 fix** |
| `qa-f01b` amount cases + `qa-w1-payroll-proposal` withdrawal cases | 7 + 4 | 3 + 4 fail before |
| All payroll test files | Bubbles 44 files / 2,533 tests; Sunny 43 files / 2,327 tests | all pass with the fix |
| Browser (Playwright, live build, local stack) | save + read back: "will not" / "don't" / "waived" → `['no']`; "payroll deduct $25" → `['yes']` | — |

Logs: `evidence/pre-release/bubbles-f01b-before-*.log` (Ask Bubbles repository), `sunny-f01b-*.log`.

## 6. Potential historical impact

**Which records can be wrong:** Corrective Action Forms (template `dpoa`) created or corrected **through the chat** inside the window, where the manager's words negated, waived or cancelled a deduction next to an amount, and the manager did not change the Yes on the card or the form. They carry `payroll_deduct = ["yes"]` (`filled_by='system'`, provenance `manager_statement`, or `filled_by='manager'` via a chat correction), and if drafted, an Action Plan sentence "… will be deducted from …'s pay."

**What limits it:**
- The window is short: the defect reached `main` at 2026-10-21 20:55 UTC; QA found it on 22 Oct.
- The card shows the Yes in bold and invites a change before creation.
- Forms created manually (ticked by a person) are not affected by the reader.
- Whether any deduction was actually **processed in payroll** is outside the app; the app records the form only.

**What it can affect if not corrected:** an employee's disciplinary record states a deduction the manager said would not be taken; if the form was finalized, exported or signed, the paper copy says so; a payroll team acting on the form could deduct pay in error.

**What QA did not do:** read, count or change any production record. The read-only audit plan is `HR_AUDIT_PLAN.md`.
