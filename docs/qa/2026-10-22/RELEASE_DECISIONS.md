# Release decisions — Ask Sunny full release (owner, 22 Oct 2026)

| # | Decision | Where it is enforced |
|---|---|---|
| 1 | Keep "Create a form" hidden for Assistant Salon Directors and Employees | `src/lib/permissions/form-creation.test.ts`, `src/components/shell/no-generic-create-form.test.ts`; the server already refuses them (403 on all 17 templates) |
| 2 | Ambiguous salon numbers 306/307/314: ask the manager to clarify, never guess | `src/lib/ai/qa-w3-salon-numbers.test.ts` (owner-decision block, `bee01d6`), `src/lib/forms/salon-mention.test.ts`, `src/app/api/forms/qa-f12-salon-reply-e2e.test.ts` |
| 3 | Keep district-manager restrictions until assignments are verified | `src/app/api/forms/location-authority.test.ts`, `src/lib/reporting/scope/authorized-salons.test.ts` (fail-closed, unchanged) |
| 4 | Keep employee names exactly as entered, no automatic capitalisation | `src/app/api/forms/qa-w2-employee-e2e.test.ts`, `src/lib/ai/form-intake-qa-2026-10-21.test.ts` |
| 5 | R1 (lower-case name in "what should I do?") left for a separate update | not in this release |
