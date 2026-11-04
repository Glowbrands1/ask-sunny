## 4 Nov 2026: Corrective Action Type of Offense, four boxes — ported from Ask Bubbles #424 as revision 8

Ask Bubbles #424 (squash f58cf4fa; branch commits f3182e31..df4e9bfc) is
ported here, one commit per Bubbles commit. Template approved by Pau via QA,
4 Nov 2026, for both apps; the `reviseInstance` hunk in `instances.ts`
(protected) approved as option A behind CA_SALES_POLICY_ENABLED, identical
in both apps.

What differs in Ask Sunny, and why:

- **Revision 8, not 7.** Ask Sunny's seed was already revision 7 (Payroll
  deduction amount, not published: the database stays on revision 6 until Pau
  approves the line). Revision 8 keeps that line in the seed;
  `withholdUnpublishedDpoa` now publishes revision 8 without it, so the line
  still waits for Pau and the approved offense change reaches new forms.
- **Old forms are on revision 6 or 7.** Both documents are fixtures
  (`src/test/fixtures/forms/corrective-action-revision-6.json`, `-7.json`),
  and the old-form, copy and revise tests run on both.
- **Late Opening** follows the Attendance Policy box with Ask Sunny's own
  salon wording; Sunny's `describesRule` has no box check, so it needed no
  change.
- **A named section under a replacing box** (`route.ts`,
  `namedUnderReplacement`) is filed alone only when its old box had no section
  of its own (Violation of Company Policies). Bubbles applies it to every
  replaced box, which would drop Attendance beside a named/card Late Opening;
  here the card case (replay `nov3-card-policy-label`) keeps it. Worth checking
  in Bubbles.
- **ATTENDANCE_POLICY_CITATION** (Sunny only, on in production) cites the
  Attendance Policy box by section and page as it cited Tardiness
  (`required-policy-citation.ts`).
- Eval b6 (the chat names a Cell Phone / Visitors / Animals section alone,
  never "under Standards of Conduct"): the `currentBoxLabel` fix is identical;
  Ask Sunny has no such eval, so its wording is a unit test.
- Ask Sunny has no reference-PDF migration QA (`forms-migration-qa`,
  `template-parity`, `approved-removals`), so Bubbles' changes there have no
  counterpart.
