# Gate-Sunny-3 — #894 CARD_PLAN_MATCHES_CREATE_ENABLED — GO (3+3)

- Head `7f192e4f7` (Coding-6; port of B#824, QA's 17l ruling B). Merged onto main `1ecadf923`: conflicts in
  flags-off-parity and chat-quality-flags (kept both sides). The closing `}` of `formsOnFileOrderMatchPossibleEnabled`
  had to be restored by hand; then tsc is clean. **Coding-6 should rebase.**
- 3 OFF + 3 ON (QA asked for 3+3), full suite, production flags in the env.

| run | failed (OFF) | failed (ON) |
|---|---|---|
| 1 | 1,261 | 1,264 |
| 2 | 1,260 | 1,266 |
| 3 | 1,259 | 1,264 |

Replay text is **byte-identical across the three OFF runs and across the three ON runs** (deterministic).

Tests that pass in all 3 OFF runs and fail in all 3 ON runs:
- replay `nov12-17l-card-shows-pau-attendance-plan` and `nov12-17l-card-plan-equals-saved-plan` OPEN arms: they now
  hold. INTENDED.
- flags-off-parity, first half: INTENDED-HARNESS.
- `card-plan-matches-create.test.ts` "off: the card as built": its off arm reads the env (fails with the flag on in
  the env). INTENDED-HARNESS; tidy-up.
Everything else varying between runs is the known chat-trace / load noise.

Replay text, OFF vs ON: **190 records differ.** I checked each changed reply line by line. In 188 records the
only changed line is the card's **Action Plan**. On every one of them the card's Policy line is **Attendance** (197
replies "Attendance — read from this request", 15 "Attendance, as you said"). The plan changes from "Management will
review the Attendance policy with <first>. Future policy violations may result in …" (172) or "… review the Late
Opening policy …" (40 replies, where the Policy line already said Attendance, via LATE_SLOT_READS_ATTENDANCE) to Pau's
plan: "<First> is expected to arrive on time for all scheduled shifts moving forward. Leadership will monitor
<first>'s attendance closely and provide coaching as needed. A follow-up meeting will be scheduled …", the plan Create
saves. The other 2 records (`nov9-ca-shift-answer-own-account-next-turn`, two arms) also gain the "Attendance Policy,
JBA Policy Manual p.14" citation line on a later turn, matching their Policy line. All pass. INTENDED-ADJACENT. No
card with another policy changes. 0 REGRESSION.

The cases changed on purpose (`nov9-late-reads-attendance-*`, `nov10-late-slot-reads-attendance`) now accept either
plan, each with a comment. A flag-aware assertion would be stricter; that's a note, not a blocker.

Eval (flag on): 63/63, 42/51 cases pass, and no case changes outcome.

**GO.** The cases that now hold are `nov12-17l-card-shows-pau-attendance-plan` and `nov12-17l-card-plan-equals-saved-plan`.
Expect every Attendance CA card in production to show Pau's plan after the flip.
