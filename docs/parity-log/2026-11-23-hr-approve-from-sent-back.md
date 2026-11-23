# HR approves a form it sent back, once the manager has replied; Print on a finalized form — Ask Bubbles port by a Bubbles coder

**Ask (Pau, via QA, 23 Nov 2026):** "when manager replies in note, there should be approve button here please and notify
manager, then it will show in form monitoring for that manager only for her salon but of course [the person who sees
every salon] will be able to see all. then the manager once sent back, will have option to print and save as PDF" …
"of course the notes should not show in PDF".

**Change (Ask Sunny):**
- `approvableFromSentBack` (`hr-approval-rules.ts`): a form in `changes_requested` whose creator or a sender added a
  note after HR's latest send-back.
- `decideHrApproval` approves it through the same path as from pending (`finalizeInstance` with `fromHrApproval`:
  finalized and approved in one write, "HR approved it" in the thread, the creator's and senders' bell "HR approved
  your form"). Send back and reject still need `pending`.
- `hrApprovalViewFor` gives HR `canApproveSentBack`; the panel shows Approve beside Add note.
- Form Monitoring is unchanged: an approved form is an ordinary finalized form, scoped by salon, all of them for an
  every-salon account. The thread and who approved stay creator/sender/HR only.
- Print beside Download PDF on a finalized card (`printFormPdf`, the same server PDF). The PDF renders only the form's
  fields; a test prints an approved form whose thread has a note on every step and finds none of them.
- AI: `read_hr_approvals` (unchanged) gives the asker's own approved form; replay cases for "was my CA for <P>
  approved?" and another salon's manager getting nothing.

**Ask Bubbles:** the same gap. On Bubbles main 4f9f706, `decideHrApproval` (from #1099) refuses anything but `pending`
(`hr-approval.ts:185`), and `canDecide` is pending-only. Port the mechanism (the rule, the decide change, the view
flag, the panel button, `printFormPdf` and the Print button, the tests) with Bubbles' own wording (store, Forms
Register). This session has read-only access to Ask Bubbles, so the port goes to a Bubbles coder through QA.
