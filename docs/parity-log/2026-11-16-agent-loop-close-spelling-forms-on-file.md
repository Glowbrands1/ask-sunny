# Agent loop: a close spelling given to find_past_forms is asked (16 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet.

The Runner's live inputs on #1064 (d2710ad): after <A>'s card, "edit <typo> ca" made the model call `find_past_forms`
with the typo itself; no form was under it, so the tool said "None on file" and the reply named <A>. Now a name a tool
is given that is nobody's exact name but a close spelling of roster people, not confirmed in this chat, gets the
recorded Did-you-mean (`close_spelling_not_confirmed`) instead of "None on file". Port when Ask Bubbles gets the loop.
