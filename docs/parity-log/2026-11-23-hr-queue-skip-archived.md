# 2026-11-23: an archived form is out of HR's queue

**Report (QA, 23 Nov 2026).** A duplicate exit draft was archived, with Pau's OK, while it still waited for HR
(`hr_approval_state` "pending"). It kept showing in HR's "Needs your decision".

**Cause.** These HR-approval reads in `src/lib/forms/hr-approval.ts` read every draft in an HR state, archived or not:
- `listHrQueue`, which also feeds `hrQueueSummary`: the tab count, the Overview card and the 6 AM reminder bell;
- `listMyFormsWithHr`;
- the chat's approved-forms read in `readHrApprovalsFor`.

**Fix (Ask Sunny).** Each of those reads adds `.is("archived_at", null)`. Archiving changes nothing stored: the form
keeps its HR state, and restoring it puts it back in the queue.

Archiving a form that waits for HR also marks HR's "waiting for your approval" bells for it as read (`archiveInstance` →
`clearRequestBells`), so the bell stops pointing at it. Restoring the form doesn't ring them again (QA, 23 Nov 2026).

Tests:
- `src/lib/forms/hr-approval-archived.test.ts`: the queue, the count, the reminder bell, the manager's list and the
  chat reader.
- Replay `nov23-hr-approval-archived-form-leaves-hrs-queue`.

Both fail before the fix.

**Ask Bubbles: Bubbles coder 4 makes the same change there (QA, 23 Nov 2026).** The mechanism is the same: the archived
filter on the HR-approval reads.
