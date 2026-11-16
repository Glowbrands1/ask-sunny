# Agent loop: a date change on a finalized form, and an honest step-limit reply: Ask Sunny only

**Change in Ask Sunny** (Coding-7, 16 Nov 2026; `src/lib/ai/agent-loop/`; QA's live finding on production e2e92554):
"…, change the date to 11/9", "Which one?", "the 11/10 one" made four edit_form calls and ended on the step limit with
the date unchanged. Now: a form this turn already opened (open_form, or the revision draft edit_form opened) is the
open form (no privacy_not_asked); the form's date the manager typed in this message or the one before it is theirs to set
as form_date; any refusal about a field lists the keys a direct edit takes and where the date goes; the edit_form tool
description says the date is a direct field edit, never the reviser. The code-written step-limit reply states only what
the turn's records show (what was saved, or "Nothing else was saved yet") and asks for the change again.

**Ask Bubbles: not needed yet.** Ask Bubbles has no agent loop on its main. Port with the loop.
