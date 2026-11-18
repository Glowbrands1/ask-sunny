# Live fix: Create from a loop card drafts the card's account, under the card's policy box (18 Nov 2026)

**Sibling app: not needed now.** Ask Bubbles has no agent loop yet, and these are loop cards (`fromAgentLoop`). Port both
with the loop. The box mapping reads the form's own Type of Offense labels, so it ports as is.

Background: Pau's test chat (QA, 18 Nov 2026). T1 named the manager herself; T2 "for <employee>" made a CA card whose
account was "<first> was wearing a mini skirt on 9/12." and whose policy was "All Locations Dress Code Policy, JBA Policy
Manual p.15". Then the manager pressed Create.

**1. Empty Observation.** The card's request was only T2, so the draft notes were "for <employee>" and nothing was
drafted.

- Fix: a loop card that carries an account drafts from the card's own lines (`draftNotesFromCard`, account first, now
  with the payroll amount), with the manager's cited turns after them.
- A loop card with no account is unchanged.

**2. Wrong offense box.** Type of Offense was ticked "Standards of Conduct", and Policy Violated read "Standards of
Conduct — All Locations Dress Code".

- Fix: for a loop card, the box follows the card's heading. The heading is read against this form's own option labels,
  minus their generic words ("Dress Code Violation" is read as "Dress Code").
- Policy Violated is the card's own heading line, with its page.
- A heading that no label names (Late Opening) is left as before.

T3's payroll (edit_form on the saved draft) already reached the form; a case now pins it.
