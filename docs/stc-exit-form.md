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
| Details | `ai` | Drafted by the model under exit-specific rules, then `guardExitDetails` drops any sentence that answers a yes/no question, claims a signature, claims a termination step was done, calls it a termination, or carries a date the manager did not give — unless the manager said it |
| Permanent Address, all six yes/no questions | `manager` | Never filled by Ask Sunny; `enforceResponsibilities` drops any attempt |
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

## Asking for it

Any of: "exit form", "STC exit", "resignation paperwork", "termination/exit
form", "termination paperwork", "separation paperwork", "offboarding form",
"Resignation/Exit Form". "Termination" alone, "termination policy" and "exit
interview" are **not** matched — those remain knowledge questions.

Sunny then either asks the short intake (nothing given), asks who (facts but no
name), or lists what it will fill, what it leaves blank, and asks only for the
last day worked / how they left when neither was said, or for anything said two
ways (two last days, a bare "Friday", fulfilled *and* not fulfilled).

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
