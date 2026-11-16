# Agent loop: an edit of another form type asks which one (16 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet.

QA's live group E on main 63ba4c48: with a person's Coaching card on screen and Corrective Actions on file, "edit <name>
ca" made a new Corrective Action card. propose_form now refuses a new card of a type when the manager asked to edit
(the reopen path's own `mayAskToReopen`), the person's card on screen is another type, and forms of the asked type are
on file (`edit_asked_forms_on_file`): its ask_exactly lists the card on screen first. Port with the loop.
