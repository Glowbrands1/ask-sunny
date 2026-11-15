# Agent loop batch J (QA's live re-run, part 1): Ask Sunny, with two shared fixes for Ask Bubbles

**Change in Ask Sunny** (QA's batch J, from the live re-run on main f6c3a3ca; `src/lib/ai/agent-loop/` unless named):

- **J1.** A reply whose Policy line is the card's own line with a source marker ("… p.12 [S1]") is the card's policy;
  the self-check no longer replaces a good reply with "That change isn't on the card yet". The heading (SoC read in
  full) and page decide when the whole line does not match.
- **J3.** A reply that stops early (step limit, timeout, error) lists what the message stated that is not on the card
  or form ("Not saved yet: **Payroll deduction amount** ($15)").
- **J4.** `question_asked_before`: after "Using <name> from your staff list … What happened?", a "Yes" never gets the
  same question word for word.
- **J5.** "late to open" and a failure to open are the manual's Late Opening section, as today's chat reads them.
- **J7–J10** (speed, from the J6 report). With a draft open a change goes straight to edit_form; the self-check
  hand-back asks as the turn did, so its prefix is cached; what_happened stays the manager's own account;
  `first_token_ms` is written on loop traces (`chat-trace.ts`).
- **J2** (a dictated field saved word for word) reuses batch G's helper and lands after G.

**Ask Bubbles** (v2-Coding-5, 15 Nov 2026):

- **Shared amount reader** (`saysAmountUnknown`, today's chat): "yes payroll but I don't know the amount" leaves the
  amount blank. **Ported** in Ask-bubbles#930.
- **Payroll answer as the Observation** (`payroll-clause-not-account.ts`, today's chat): Ask Bubbles' card keeps its
  Issue line to the incident already; **not needed**, regression case only in Ask-bubbles#931.
- J1–J10 are loop-only, and Ask Bubbles has no agent loop on its main: port them with the loop.
