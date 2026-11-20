# 2026-11-20 — the exit card's stated lines land in the exit form's own fields

**Part Sunny-only, part needs port to Ask Bubbles.**

- Sunny-only (Bubbles has no agent loop yet): the loop's exit card carries its locked termination (`loopTermination`) and
  account to Create, Create writes "Immediate involuntary separation", the reason and the payroll answer as the manager's
  statement, and the card asks for a missing last day worked (`exit_unset`). Port with the loop.
- Needs port to Ask Bubbles (shared code): `exit-details.ts` reads "payroll deduct no apply" / "payroll deduct: no" as
  No (it read Yes), and the draft route never replaces an exit line the manager stated (`manager_statement`), and writes no
  "resignation method" or type tick of its own over a stated involuntary separation. Mechanism only.
