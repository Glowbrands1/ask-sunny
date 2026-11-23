# "Put up the verbal CA for <P>" singles out the verbal one by its own level (U16 again; QA, 23 Nov 2026): same gap in Ask Bubbles, port pending

**Report (Sunny's live set and Ask Bubbles' live re-run, U16):** "put up the verbal CA for <P>" answered "none specify
'verbal' so I can't single one out" and listed 7 Corrective Actions, while the same forms read as "Corrective Action
Form, Verbal Warning" elsewhere (the prior-actions line).

**Cause:** find_past_forms' level narrowing (Sunny's #1224, the port of Bubbles #1044) read only the words the model
passed (its form, about and forms_on_file_evidence quote). The live model asked for "CA" and quoted "put up", so
"verbal" never reached it; and the list the model got (each row's `choice`) carried no level, so it could not single
one out itself.

**Fix (form data, no word list):** the narrowing also reads the manager's own message; each Corrective Action's level,
read once from its own Type of Warning on the form (`warning_type`'s ticked option), is on its row (`level: "Verbal
Warning"`) and in its choice line ("Corrective Action Form · Verbal Warning · finalized · …"); the single_out note names
the level. Several verbal CAs still ask which.

**Ask Bubbles: same gap.** Bubbles main's narrowing reads the same three inputs (`asked` from form, about and quote)
and its choice lines carry no level. Port the reading of the manager's message, the row's level and the choice line,
with the replay cases below on Bubbles' roster and store.

**Tests:** replay `nov23-agent-loop-u16-single-out-by-level-cases.ts` (U16's wording, an invented person): 7 CAs, one
verbal, the model quoting "put up": fails on main (all 7 listed, no level), passes after (the verbal one is the
best_match); control: two verbal CAs still ask which.
