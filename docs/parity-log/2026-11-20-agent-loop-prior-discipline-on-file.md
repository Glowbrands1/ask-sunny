# 2026-11-20 — agent loop: prior discipline on file fills a Corrective Action card's prior actions

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. Rule this adds (Pau's call via QA): a Corrective Action
card's prior actions list this person's finalized Corrective Actions and Coaching / Follow-Up Coaching forms already in the
app (form, level, date), oldest first, at most 10, only the ones this manager may open (`finalizedPriorsOnFile` in
tools.ts); the manager's own stated steps win, and the card's level is never set from them. It reverses two standing loop
rules for this case only: "prior actions never from records on file" and "forms on file only when the manager asks".
Port with the loop.
