# 2026-11-20 — the exit form's Permanent Address is only ever the manager's own

**Sibling app: check before porting.** Rule this adds: a Permanent Address is kept only when that address is in a message
the manager typed in the chat (`addressTypedIn`, `withoutUntypedAddresses` in exit-details.ts). Sunny paths:

- The agent loop's card account loses a labelled address the manager never typed (tools.ts, propose_form). Ask Bubbles has
  no agent loop yet: port this part with the loop.
- Create (`api/forms/instances/[id]/draft`) reads the address only from the manager's own lines of the notes, never a loop
  card's lines (`notesWithoutCardLines` in draft-notes.ts). Ask Bubbles' Create reads the notes from the manager's turns
  only (it has no loop card), so this guard adds nothing there today; port it with the loop.
- edit_form already never writes the field (the form writer refuses `manager` fields); guarded by a replay case.
