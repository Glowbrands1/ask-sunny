# Agent loop: the level stays when the same CA is asked for again (20 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet.

Runner 2's c263 (17 Nov saved-form run on 33863575): Written, set with evidence at T1 ("Please create a CA written warning
for <A> for being out of dresscode on 11/13"), was dropped at T2 ("Write me a CA form for <A> … on 11/13 and 11/6"): the
model marked T2 a new request, and a new request starts with no level. A new request now keeps the level of the card on
screen only when it is that same card asked again: this person's card on this form is on screen and the message states
its incident date again. Another date, or none, still starts fresh. The card record holds the card's incident date (a
date of the form, never a name).

QA's code audit on d7960a5f: `levelOptionIsTheLevel` accepted "written up" ("she got written up again for no-call, I need a
CA") because "up" is a short word; "written up" is discipline already given, never this form's level.

Port with the rest of the loop when Ask Bubbles gets it.
