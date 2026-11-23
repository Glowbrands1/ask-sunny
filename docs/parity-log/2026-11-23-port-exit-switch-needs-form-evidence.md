# A switch to the exit form needs the same evidence as any form change (port of Ask Bubbles #1082, 309ec42) — ported

**Report (Ask Bubbles, QA, 23 Nov 2026, the exit-lock gap):** the form lock (f108) keeps the card on screen's form unless
this turn's words ask for another form and the quote names it (`quoteNamesForm`) or answers the app's own offer of it. A
switch to the exit form skipped that: any real quote of this turn passed as exit_evidence, so "she told me she is
thinking about quitting" made the CA on screen an exit card.

**Ask Sunny: same code.** Sunny's lock is the same (the replay case fails on main: "the CA became an exit card").

**Port:** `exitAsked` needs `lockLeft(input.exit_evidence)` too; `quoteNamesForm` reads a name with alternatives
("Resignation/Exit Form") as each alternative with its last word ("Resignation Form", "Exit Form"), the name's own shape,
no word list, so "make it an exit form instead" still switches.

**Tests:** replay `nov23-agent-loop-exit-switch-needs-form-evidence-cases.ts` (Bubbles' wording, Sunny's roster): fails
on main, passes after; the control ("make it an exit form instead") passes on both.
