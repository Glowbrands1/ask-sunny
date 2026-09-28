# Employment change forms — Demotion, Position Transfer

**Date:** 28 September 2026

## What shipped

| Form | Key | Status |
|---|---|---|
| GlowBrands Demotion Form | `demotion` | Published (revision 1) |
| GlowBrands Position Transfer Form | `position-transfer` | Published (revision 1) |

`STC Demotion Example.docx` has the same text as the Demotion Form (only the title's line break differs). It's used as the model for how the reason paragraph is worded. It isn't a separate template.

The Resignation/Exit Form is not part of this work. This branch first carried its own (`resignation-exit`), but `main` shipped the same form as `stc-exit` (#44, see `docs/stc-exit-form.md`). When `main` was merged in, the duplicate was removed, and `stc-exit` is the only Exit form.

Neither form needed a migration. On the next Forms page load, `ensureTemplateLibrary` installs any template that isn't there yet.

## Where things live

- **Templates:** `src/lib/forms/employment-change-library.ts`, registered in `TEMPLATE_SEEDS` (`library.ts`). They appear under the new **Employment Change Forms** category (`catalog.ts`), with display order 16 and 17 (`stc-exit` holds 15). Forms are created in chat only; `main` removed the Create a Form builder (#42).
- **Permission:** `create_employment_change_form`. It's granted to Salon Director and above, which are the roles that can already file a Corrective Action Form.
- **Layout family:** `coaching` (the single-page layout that isn't a rung of the Performance Management ladder). A new enum value would need an approved migration before the seeder could insert the rows.
- **Reading the manager's words:** `src/lib/forms/employment-change.ts`. It reuses `extractFormDate`, which now also reads `10-05-2026`, `extractJobTitle`/`JOB_TITLES`, the existing employee-name reader, and reporting's `storeNameKey` for salons (`salon-text.ts`). Dates go through `datesInText` (`form-date-answer.ts`), the same reader the Exit form uses.
- **Chat:** `template-intent.ts` (aliases, plus change statements such as "Jane is transferring from salon 12 to salon 18"), `proposal.ts` (name positions such as "demote paulyne …"), and `lib/ai/form-proposal.ts` (the prefilled summary, one grouped question, and continuing when a reply contains only details).
- **Prefill:** `POST /api/forms/instances/[id]/draft` calls `applyStatedFacts` before the model runs.
- **Corrections after creation:** `lib/forms/chat-correction.ts`, called from `/api/chat` when the conversation has a created form.

## Who fills what

- **`system`:** Employee Name, Date, Job Title (the *current* title), Location.
- **`manager`:** every fact about the change (statuses, pay, new title and location, voluntary or involuntary). The model can't write these. They're filled only from what the manager said, and only into empty fields.
- **`ai`:** the reason paragraph.

## Technical debt

- **"Coaching" layout label on the employment change forms.** The forms reuse the `coaching` layout family (see above). The label shows only on the admin-only Form Templates pages: the library card's badge and the editor's "Layout family" line, both behind `manage_form_templates`. It never appears in Ask Sunny chat or on the printed PDF. Giving these forms their own value needs an approved migration that adds it to `form_layout_family`, plus a one-line seed change.

