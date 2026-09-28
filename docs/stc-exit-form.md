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
| Inline in chat | Yes |
| Look | The Word source's: centred headings over rules, stacked header, Sun Tan City mark top right (the approved `sun-tan-city` asset), 1in margins |

It is seeded by `ensureTemplateLibrary` the first time Forms or chat reads the
library after the migration has run. No existing template, version or record is
touched.

## Who fills what

| Lines | Responsibility | How |
|---|---|---|
| Name, Date, Job Title, Location | `system` | From the record at creation. Date is the day the draft is created. Location prints only where a salon name is verified (in live mode that is never, from chat — see `resolveLocationName`) |
| Last Day Worked, notice given/fulfilled dates, Resignation Details ticks | `ai`, **derived** | Computed from the manager's own words by `lib/forms/exit-facts.ts`. The model is never shown these keys and anything it returns for them is discarded |
| Details | `ai` | Drafted by the model under exit-specific rules, then `guardExitDetails` drops any sentence that answers a yes/no question, claims a signature, claims a termination step was done, calls it a termination, or carries a date the manager did not give — unless the manager said it |
| Permanent Address, all six yes/no questions | `manager` | Never filled by Ask Sunny; `enforceResponsibilities` drops any attempt |
| Three signature lines | signature | No key; nothing can write into them |
| Steps to Finish Termination | text | Printed instructions only. Creating or finalizing the form removes nobody from MyGlow, changes no payroll and touches no other system |

**Immediate involuntary separation is never ticked by Ask Sunny.** A described
firing is reported to the manager, who ticks it once the leadership process has
approved it (`SENSITIVE_ACTION_OPTION_KEYS`).

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

## Reviewing and downloading a draft

1. In Ask Sunny, press **Create draft** on the proposal card. The draft opens
   inline, editable, marked DRAFT.
2. It is also listed in **Forms → Form Monitoring**, and can be started by hand
   from **Forms → Create a Form** under Separation & Exit Forms.
3. To download the draft, use the **PDF** link on its row in Form Monitoring
   (`GET /api/forms/instances/[id]/pdf`). A draft prints "DRAFT" in the footer
   with every unanswered line blank. The inline editor's **Download PDF**
   button appears once the form is finalized.
4. Finalize when complete. Signatures are made by hand on the printed form.

## Open follow-ups

- Adoption analytics has no `exit_form` activity category (it is a database
  check); exit-form activity is reported as unclassified until one is added.
