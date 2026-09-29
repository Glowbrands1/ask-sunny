# Resignation/Exit Form (`stc-exit`)

Transcribed from `STC Exit.docx`, the exit form Marissa supplied. This unblocks
item 4 of `teams-rollout-fixes-2026-09-22.md` ("Exit Form source/template not
found"). The source is kept at `src/test/fixtures/forms/stc-exit.docx` (author
metadata cleared) and `exit-library.test.ts` checks the template against it.

## What it is in the library

| | |
|---|---|
| Key | `stc-exit` |
| Name | Resignation/Exit Form (the title printed in the Word header) |
| Category | `separation` — **Separation & Exit Forms**, between HR & Performance and Hiring & Interview |
| Layout family | `exit` (new enum value — migration `20260928001000_forms_exit_layout_family.sql`) |
| Permission | `create_exit_form` — Salon Director, District Manager, Regional Manager, Admin, Owner, Developer. **Not** Assistant Salon Director or Employee (same grants as `create_corrective_action`) |
| Reading a filed one | **Also** `create_exit_form`, on top of the action's own permission and salon scoping: view, PDF, edit, the monitoring list, the Overview queue and the rail badge. A role without it gets the same 404 as a missing form (`readPermissionFor` / `withoutUnreadable` in `instance-scope.ts`) |
| Picker | Offered in "Which form do you need?" to roles that may create it; never shown to, or created for, anyone else — by name, alias or card |
| Inline in chat | Yes |
| Look | The Word source's: centred headings over rules, stacked header, Sun Tan City mark top right (the approved `sun-tan-city` asset), 1in margins |

It is seeded by `ensureTemplateLibrary` the first time Forms or chat reads the
library after the migration has run. No existing template, version or record is
touched.

## Who fills what

| Lines | Responsibility | How |
|---|---|---|
| Name, Date, Job Title, Location | `system` | From the record at creation. Date is the day the draft is created. Location is the production roster's name for the **authorized** salon id, resolved server-side (`resolveLocationName`); a salon named in chat settles it only when it is one the manager may file against |
| Last Day Worked, notice given/fulfilled dates, Resignation Details ticks | `ai`, **derived** | Computed from the manager's own words by `lib/forms/exit-facts.ts`. The model is never shown these keys and anything it returns for them is discarded |
| Resignation Date, How Employee Resigned, Reason for Resignation (revision 2) | `manager` | Filled only from the manager's own words by `lib/forms/exit-details.ts` (through `applyStatedFacts`, empty fields only), or by hand. The model is never shown them |
| Store items, **salon key** (revision 2), payroll deduction, bonus, minimum wage, rehire yes/no questions | `manager` | Same: ticked only from what the manager said ("she still has the key", "not eligible for rehire"), recorded as `system` with provenance `manager_statement`. `enforceResponsibilities` still drops anything the model returns for them |
| Additional Details (was "Details") | `ai` | Drafted by the model under exit-specific rules, then `guardExitDetails` drops any sentence that answers a yes/no question, claims a signature, claims a termination step was done, calls it a termination, or carries a date the manager did not give — unless the manager said it |
| Permanent Address, Written notice attached? | `manager` | Never filled by Ask Sunny; `enforceResponsibilities` drops any attempt |
| Three signature lines | signature | No key; nothing can write into them |
| Steps to Finish Termination | text | Printed instructions only. Creating or finalizing the form removes nobody from MyGlow, changes no payroll and touches no other system |

**Immediate involuntary separation** is a fact about what already happened. It
is ticked only when the manager's own words state a completed, employer-initiated
separation ("Jane was terminated today", "we fired Jane yesterday", "Jane was let
go on Friday"), by `completedInvoluntary` in `exit-facts.ts`. Intent, questions
and the form's own name tick nothing ("should we terminate Jane?", "we may fire
Jane", "termination paperwork for Jane", policy questions). The model can never
tick it: its output for that key is discarded and `SENSITIVE_ACTION_OPTION_KEYS`
refuses it.

The Word file was saved with "Written notice attached? ☒ No" already ticked.
That is a previous user's answer, not part of the blank form, and is not
reproduced.

## Revision 2 — HR's Details section (28 Sep 2026)

HR (Colene Schildt) asked for the Details section to state the resignation date,
how and why the employee left, whether store items and the salon key were
returned (a key that wasn't is a $25 payroll deduction), whether payroll
deduction applies, whether they are dropped to minimum wage and forfeit their
bonus, and whether they are eligible for rehire.

The Details section now reads, in this order:

| Line | Stored as | Prints |
|---|---|---|
| Resignation Date | `resignation_date` (date field) | the date |
| How Employee Resigned | `resignation_method` (text field) | e.g. "Text message", "No call/no show" |
| Reason for Resignation | `resignation_reason` (text field) | the manager's words, or "No reason given." |
| Store Items Returned | the existing `store_items_returned` yes/no | "Store items were (not) returned." |
| Salon Key Returned | **new** `salon_key_returned` yes/no, next to store items in Resignation Details | "Salon key was returned." / "Salon key was not returned. Employee will be payroll deducted $25 for the salon key." |
| Payroll Deduction | the existing `payroll_deduction_applicable` yes/no | "Payroll deduction is (not) applicable." |
| Minimum Wage / Bonus Forfeiture | the existing `dropped_to_minimum_wage` and `forfeit_bonus` yes/nos | one sentence for both, e.g. "Employee will not be dropped to minimum wage and will not forfeit bonus." |
| Eligible for Rehire | the existing `eligible_for_rehire` yes/no | "Employee is (not) eligible for rehire." |
| Additional Details | `details` (the drafted paragraph) | the paragraph |

**No answer is stored twice.** The five yes/no lines are an `answer_statements`
block: it owns no keys and prints each tick box's answer as HR's sentence
(`answerStatementText` in `document.ts`). The chat editor, the paper view and
the PDF all call that one function, so a tick and its sentence can't disagree,
and changing a tick updates its line immediately. An unanswered question (no
box, or both boxes ticked) prints a blank rule. On screen it says "Not answered yet".

**What Sunny reads, and what it asks.** `exit-details.ts` reads the manager's
turns (never Sunny's). A later turn replaces an earlier answer ("actually she
still has the key"). An answer given both ways in one turn is left blank and
asked about. A question ("is she eligible for rehire?") answers nothing. The
proposal lists what will be filled, in the form's own sentences, and asks
only for the lines still missing. For an involuntary separation it doesn't ask
the resignation date, how, or why.

**Corrections after creation.** `chat-correction.ts` now also handles the
Exit Form. A statement after the draft exists ("her last day was actually
9/18", "she did bring the key back") is saved to the same form as the
manager's own edit. No second form is created. A correction that says how
they left replaces both Resignation Details groups.

**Forms already created keep the version they were pinned to.** Revision 2 is
published as a new version by `ensureTemplateLibrary`. Existing drafts and
finalized forms keep printing the version they were filled from.

**Dates are shown MM/DD/YYYY** on this form: Date, Last Day Worked, both
notice dates, Resignation Date, and the PDF footer. The version sets this with
`style.dateFormat: "us"`, used by `displayDate` in the PDF, in the read-only
chat form and in chat correction messages. Stored values stay ISO. An editable
date is still the browser's date picker. A form pinned to revision 1 has no
`dateFormat` and prints ISO exactly as before.

**The salon key's $25 is not the Payroll Deduction answer.** "She'll be
deducted $25 for the key" only affects the Salon Key line. "Is Payroll
Deduction applicable?" is answered only by a statement about payroll deduction
itself, because it can cover more than the key.

**PDF.** The acknowledgement now moves to the next page together with the
signature lines under it when they don't all fit. The longer Details section
had pushed the signatures onto page 2 on their own. On the Exit Form, page 1
now ends about 1.5–2 inches above the bottom margin, and page 2 opens with the
Acknowledgement. The same rule applies to every template. Blank PDFs of every
other template are byte-identical to before. With every field filled, the one
other template affected is the FTTC EPP. Its acknowledgement had been left at
the foot of page 1 with the signatures on page 2, and now moves to page 2 with
them (still two pages).

## Asking for it

Any of: "exit form", "STC exit", "resignation paperwork", "termination/exit
form", "termination paperwork", "separation paperwork", "offboarding form",
"Resignation/Exit Form". "Termination" alone, "termination policy" and "exit
interview" are **not** matched — those remain knowledge questions.

Sunny then either asks the short intake (nothing given), asks who (facts but no
name), or lists what it will fill, what it leaves blank, and asks only for what's
missing: the last day worked and how they left, HR's Details lines (see
Revision 2), and anything said two ways (two last days, a bare "Friday",
fulfilled *and* not fulfilled, the key returned *and* not returned).

## Reading the conversation

- **Employee:** the existing reader (any case, first name, brackets, one-line
  intake answers). A first name alone is completed from the manager's earlier
  turns when exactly one full name starts with it ("Jane Smith quit… exit form
  for Jane" → Jane Smith); two ("Jane Smith and Jane Doe") → Sunny asks which.
  There is no employee directory, so nothing is looked up or invented. Names are
  stored as typed.
- **Job title:** the existing reader, now also accepting plurals ("one of my TCs").
- **Salon:** `proposeLocation` with main's `salon-mention.ts` reader — the
  authorized scope first, then a salon named in chat, in any case, only where the
  scope proves it. A salon outside the assignment is named back and never filled
  in; "Lawrence Smith" is not KS Lawrence.
- **Dates:** the existing `datesInText` reader (9/30, 09/30/2026, 2026-09-30,
  Sept 30, September 30th) plus today / today's date / yesterday / tomorrow /
  last or next Friday against the business day. A bare weekday is asked about.

## Reviewing and downloading a draft

1. In Ask Sunny, press **Create draft** on the proposal card. The draft opens
   inline, editable, marked DRAFT.
2. It is also listed in **Forms → Form Monitoring** for roles that may read it.
   Forms are only created in Ask Sunny.
3. To download the draft, use the **PDF** link on its row in Form Monitoring
   (`GET /api/forms/instances/[id]/pdf`). A draft prints "DRAFT" in the footer
   with every unanswered line blank. The inline editor's **Download PDF**
   button appears once the form is finalized.
4. Finalize when complete. Signatures are made by hand on the printed form.

## Changes outside the form, found during QA

- **No builder entry point.** The standalone builder is gone (main, #42); the
  Overview's "Create a coaching form" shortcut opens the chat with the request.
  `no-generic-create-form.test.ts` keeps any UI link to `/forms/create` out.
- **PDF: a checkbox group's question now prints.** The renderer drew only the
  boxes, so yes/no questions (here, and the prescreen's "Are you at least 18
  years old?") printed as bare "Yes No". Short answer sets sit beside the question.
  The First Round interview's "✔ / X" column header prints as "Tick / X" (the PDF
  fonts have no tick glyph).
- **PDF: an instruction-only section is kept with its heading** rather than
  leaving its last line alone on the next page.

## Open follow-ups

- Adoption analytics has no `exit_form` activity category (it is a database
  check); exit-form activity is reported as unclassified until one is added.
