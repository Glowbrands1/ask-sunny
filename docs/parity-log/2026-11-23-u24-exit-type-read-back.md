# The exit type the card ticks is always read back (Ask Bubbles #1061, 863c6a31, its QA's flaky check, U24) — ported

**Report (Ask Bubbles):** with the type stated ("… Immediate Vol Resignation …") the exit card ticked it, but one live
reply of five read back every reads_back line and never the type: exit_ticks is a separate rules-book line the model can
skip.

**Ask Sunny: same gap.** Sunny's exit card gives its ticks only as `exit_ticks` (`exitCardTicks`), with the same
rules-book line, and nothing added them when the reply left them out. The replay cases below fail on main.

**Port (the mechanism; Sunny's own exit form labels, names invented):**
- `tools.ts`: `ToolEffects.exitTicks`, the exit card's ticks (`exitCardTicks`, the card's own facts), set right after
  `effects.proposal` (never an await before it: a parallel propose_form would pass the one-card check). The facts'
  `exit_ticks` comes from the same call.
- `run.ts`: a reply for this turn's exit card that names none of the ticked types gets "Filed as: <ticks>." after its
  opening paragraph.
- The model's input is unchanged: no "Filed as" line in reads_back, and no rules-book change. A first Bubbles version
  put it in reads_back, and its QA's live check saw the rehire case lose its reads_back. A termination keeps
  exit_termination's own line (`exitCardTicks` gives a termination no ticks).

**Tests:** replay `nov23-agent-loop-u24-exit-type-read-back-cases.ts` (the tester's U24 wording in Sunny's shape;
invented person STAFF's Rowan Kestrel): the skip-the-type case and the rehire case fail on main (4 runs) and pass after;
the control (the model says the line itself, no second line) passes before and after.

**Live harness:** not run here (QA runs live tests).
