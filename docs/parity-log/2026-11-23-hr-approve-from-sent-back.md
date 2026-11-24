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
  your form"). From that replied-to stage HR may also send it back again with a note (QA: HR may still need more
  changes): it waits on the manager again and their bell rings. Reject still needs `pending`.
- `hrApprovalViewFor` gives HR `canApproveSentBack`; the panel shows Approve and Send back for changes beside Add note.
- Form Monitoring is unchanged: an approved form is an ordinary finalized form, scoped by salon, all of them for an
  every-salon account. The thread and who approved stay creator/sender/HR only.
- Print beside Download PDF on a finalized card (`printFormPdf`, the same server PDF). The PDF renders only the form's
  fields; a test prints an approved form whose thread has a note on every step and finds none of them.
- HR's list on Form Monitoring (Pau: the tab read "Pending HR approval (0)" with a replied-to row listed as "Sent back
  for changes"): `listHrQueue` marks `managerReplied`; the row reads "Manager replied to changes"; the list has
  "Needs your decision (N)" (waiting, then replied to) and "Waiting on the manager"; the tab's number is
  `needsHrDecision` rows, the same N.
- The "Pending HR approval (N)" tab (Pau: "its so small pending approval, make it red button and animated shaking if
  theres a pending"): with N > 0 a bigger button in the danger colour (`--status-failed`) that shakes every few seconds
  (`.hr-pending-shake`, none under prefers-reduced-motion); with N = 0 the ordinary tab.
- AI: `read_hr_approvals` gives the asker's own approved form (replay cases for "was my CA for <P> approved?" and
  another salon's manager getting nothing); for HR, a replied-to form is listed with the ones waiting for them.

**Ask Bubbles:** the same gap. On Bubbles main 4f9f706, `decideHrApproval` (from #1099) refuses anything but `pending`
(`hr-approval.ts:185`), and `canDecide` is pending-only. Port the mechanism (the rule, the decide change, the view
flag, the panel button, `managerReplied` and the count, the red shaking tab, `printFormPdf` and the Print button, the
tests) with Bubbles' own wording (store, Forms
Register). This session has read-only access to Ask Bubbles, so the port goes to a Bubbles coder through QA.
