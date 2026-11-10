# Sunny-only: OBSERVATION_NO_EARLIER_QUESTION_ENABLED (sf-s25's Observation)

Pau via QA, sf-s25 (5 Nov 2026; QA, 10 Nov 2026): "closing policy" → "What policy would it be if a tanning consultant did
not complete the closing correctly and i have already talked to her about it" → "Write a CA for <name> … on 11/3/26
she was scheduled until 9:15PM and clocked out at 9:01 …": the card's Observation of Offense began with the earlier
question. With the flag, an Observation (and the card's issue) that begins with an earlier question turn starts after
it (`forms/observation-no-earlier-question.ts`, a chat route post-step).

Not needed in the sibling app (checked on its main 09a0660d): its twin case (nov5-twin-sf-s25-closing-no-late-opening-claim,
the same turns in its own wording) gives a card whose Issue is the account alone ("she is a team member works at … on
11/3/26 she was scheduled until 9:15PM and clocked out at 9:01"); the question turn is not among the card's turns.
