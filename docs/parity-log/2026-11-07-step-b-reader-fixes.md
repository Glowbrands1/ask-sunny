# Both apps: Step B's reader takes the faithful edits (FORM_PATCH_READER_FIXES_ENABLED, FORM_EDIT_SAID_REPLACEMENT_ENABLED)

QA's Step B target (coding 5, 7 Nov 2026): every production turn in either app answered "I haven't changed the <form> — everything on it is as it was." (9 here, 7 in the sibling app) and coding 2's real-AI trace (6 Nov) are replay cases and a LIVE set (`replay-pack/nov7-step-b-refusals-*`, `LIVE_SCENARIOS=step-b-refusals`), the managers' exact words, invented people, each app's own setting.

Same code in both apps, default off, under FORM_PATCH_REDUCER_ENABLED:
- FORM_EDIT_SAID_REPLACEMENT_ENABLED (coding 2, the sibling app's #519, unmerged there) ported here unchanged.
- FORM_PATCH_READER_FIXES_ENABLED (new): a patch that changes nothing goes to the old path; `not_in_manager_words` reads the form's own name and text as said, name-prefixed evidence as the manager's, words by stem, facts (numbers, capitals inside a sentence) exactly; Pau's "yes rewrite" as how "reword" (prompt lines added after the approved text); a replace may drop assistant-written words (never typed ones); the Job Title settable only to the latest message's words.

Ported in the same session from the sibling app's branch `claude/step-b-edit-reader` (one commit per port, `Port from Ask Bubbles (<sha>)`).
