# Employment change forms — Demotion, Position Transfer, Resignation/Exit

**Date:** 28 September 2026

## What shipped

| Form | Key | Status |
|---|---|---|
| GlowBrands Demotion Form | `demotion` | Published (revision 1) |
| GlowBrands Position Transfer Form | `position-transfer` | Published (revision 1) |
| Sun Tan City Resignation/Exit Form | `resignation-exit` | Published (revision 1). The Acknowledgement of Receipt and the Steps to Finish Termination are the `STC Exit(1).docx` wording, as the business supplied it on 28 September 2026. |

`STC Demotion Example.docx` has the same text as the Demotion Form (only the title's line break differs). It's used as the model for how the reason paragraph is worded. It isn't a separate template.

None of the three needed a migration. On the next Forms page load, `ensureTemplateLibrary` installs any template that isn't there yet.

## Where things live

- **Templates:** `src/lib/forms/employment-change-library.ts`, registered in `TEMPLATE_SEEDS` (`library.ts`). They appear under the new **Employment Change Forms** category (`catalog.ts`).
- **Permission:** `create_employment_change_form`. It's granted to Salon Director and above, which are the roles that can already file a Corrective Action Form.
- **Layout family:** `coaching` (the single-page layout that isn't a rung of the Performance Management ladder). A new enum value would need an approved migration before the seeder could insert the rows.
- **Reading the manager's words:** `src/lib/forms/employment-change.ts`. It reuses `extractFormDate`, which now also reads `10-05-2026`, `extractJobTitle`/`JOB_TITLES`, the existing employee-name reader, and reporting's `storeNameKey` for salons (`salon-text.ts`).
- **Chat:** `template-intent.ts` (aliases, plus change statements such as "Jane is transferring from salon 12 to salon 18"), `proposal.ts` (name positions such as "demote paulyne …" and "mike quit …"), and `lib/ai/form-proposal.ts` (the prefilled summary, one grouped question, and continuing when a reply contains only details).
- **Prefill:** `POST /api/forms/instances/[id]/draft` calls `applyStatedFacts` before the model runs.
- **Corrections after creation:** `lib/forms/chat-correction.ts`, called from `/api/chat` when the conversation has a created form.

## Who fills what

- **`system`:** Employee Name, Date, Job Title (the *current* title), Location.
- **`manager`:** every fact about the change (statuses, pay, new title and location, voluntary or involuntary, and every exit yes/no). The model can't write these. They're filled only from what the manager said, and only into empty fields.
- **`ai`:** the reason (or details) paragraph.

## Technical debt

- **"Coaching" layout label on the employment change forms.** The forms reuse the `coaching` layout family (see above). The label shows only on the admin-only Form Templates pages: the library card's badge and the editor's "Layout family" line, both behind `manage_form_templates`. It never appears in Ask Sunny chat, in Create a Form, or on the printed PDF. Giving these forms their own value needs an approved migration that adds it to `form_layout_family`, plus a one-line seed change.

## The Resignation/Exit Form

The fields match the STC Exit document:

- **Employee Information:** Name, Date, Job Title, Location, Permanent Address, Last Day Worked.
- **Resignation Details:**
  - Submitted & Fulfilled Notice, Immediate Voluntary Resignation, Immediate involuntary separation, Did not fulfill required 14 day / 30 day notice, No Call No Show.
  - Date notice was given and date notice was fulfilled.
  - Six Yes/No questions, worded as the source asks them ("All store items were returned" through "Is this employee eligible for rehire?"), then Details.
- **Signatures:** Employee, Supervisor, and District Manager/Witness (when required).
- **Steps to Finish Termination:** printed after the signatures.

Every Yes/No and every separation box is manager-owned. They're filled only from the manager's explicit words, and the model can't write them.

**Pre-ticked "No" on "Written notice attached?".** The source document shows this box ticked. The form deliberately starts it unanswered, because:

- The document model has no concept of a pre-ticked option, and no other template carries one.
- These are HR answers. A tick left in a blank Word template is formatting, not a decision.
