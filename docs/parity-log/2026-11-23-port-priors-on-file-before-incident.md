# A form on file is a prior action only when it came before the card's incident (port of Ask Bubbles #1083, 0fbdd8b) — ported (the date filter only)

**Report (Ask Bubbles, its QA's live re-run, 23 Nov 2026, U09):** for an incident on 11/1 the card's Prior actions listed
ten forms on file dated 11/10–11/17, all after the incident.

**Ask Sunny: same code.** Sunny's `finalizedPriorsOnFile` counted every finalized form on or before today (the replay
case fails on main).

**Port:** a form on file counts only when dated before the card's incident date: this proposal's, else this person's
card proposed earlier this turn or on screen (a re-proposal often gives none); with no incident date, on or before
today, as before. Only finalized forms, as before.

**Not in this port:** Pau's ruling (23 Nov 2026) that forms on file are never added to Prior actions automatically (the AI
offers, and adds only on "yes"). Bubbles coder 3 is building it; QA sends it for Sunny when Bubbles has it.

**Tests:** replay `nov23-agent-loop-priors-on-file-before-incident-cases.ts` (Bubbles' U09 T1–T2 wording, Sunny's salon,
an invented person; forms on file 10/2, 11/10, 11/17; re-proposed with no incident date, as live): fails on main,
passes after; the 10/2 form stays listed.
