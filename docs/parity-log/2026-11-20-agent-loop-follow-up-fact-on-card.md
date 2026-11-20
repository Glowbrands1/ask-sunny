# 2026-11-20 — agent loop: the card says the follow-up Create sets (f048b)

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet (and #1134's follow-up default is Sunny-only for the
same reason, `2026-11-20-agent-loop-follow-up-date-default.md`). Rule this adds: propose_form's fact
`follow_up_on_create` ({date, say_exactly}) is the follow-up Create will set (`followUpForCard`: stated, else a week after
the form date, else a week from today), and a Card replies line has the reply say it and never deny a follow-up the
form will have. Port with the loop.
