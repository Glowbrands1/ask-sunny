# Employment change forms — Demotion, Position Transfer, Resignation/Exit

**Date:** 28 September 2026

## What shipped

| Form | Key | Status |
|---|---|---|
| GlowBrands Demotion Form | `demotion` | Published (revision 1) |
| GlowBrands Position Transfer Form | `position-transfer` | Published (revision 1) |
| Sun Tan City Resignation/Exit Form | `resignation-exit` | **Built, not published.** Its source document (`STC Exit(1).docx`) wasn't supplied, so the acknowledgement and "Steps to Finish Termination" wording are missing. |

`STC Demotion Example.docx` has the same text as the Demotion Form (only the title's line break differs). It's used as the model for how the reason paragraph is worded. It isn't a separate template.

**To publish the exit form:** paste the two source texts, word for word, into `EXIT_ACKNOWLEDGEMENT` and `EXIT_TERMINATION_STEPS` in `src/lib/forms/employment-change-library.ts`. The seed then joins the library, and the next Forms page load installs it. You don't need a migration.

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
