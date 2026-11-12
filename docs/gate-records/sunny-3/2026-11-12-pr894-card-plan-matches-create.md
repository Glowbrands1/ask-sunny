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

## Re-gate, head eba76b238 (contains main 7e8dcdb6f; termination-plan port of G4-824 + guards) — GO

1 OFF + 1 ON, full suite, production flags in the env; ON adds CARD_PLAN_MATCHES_CREATE_ENABLED. tsc clean.

| | tests | passed | failed |
|---|---|---|---|
| OFF | 22,188 | 20,789 | 1,265 |
| ON  | 22,188 | 20,787 | 1,267 |

- The two OPEN arms now hold: `nov12-17l-card-shows-pau-attendance-plan` and `nov12-17l-card-plan-equals-saved-plan`.
  INTENDED.
- In the full run, qa-f8-draft-actions-e2e failed in ON only (1 test) and card-change-e2e failed in OFF only (1 test).
  Run alone, those two files give 3 failed / 29 passed both OFF and ON (the production-env baseline), so this is
  load noise.
- Replay text (1,687 records): **191 differ**. 190 are the same Attendance-card plan change as in the 3+3 (generic
  "Management will review …" becomes Pau's attendance plan). The 191st is
  `nov12-g4-824-termination-plan-kept-late-on-a-date` (production arm). Its card plan was "Management will review the
  Attendance policy with Remy. Effective immediately, employment is terminated …" and is now "Remy is expected to
  arrive on time … per company policy. Effective immediately, employment is terminated following the progressive
  corrective action plan." The termination sentence stays last, and no "Future policy violations" closing is added.
  The other 3 termination guards (so-i-need, term-ca-did-not-show, terminating-never-showed) are unchanged and still
  end with the termination sentence. INTENDED. 0 REGRESSION.
- Eval (flag on): 63/63, 42/51 cases pass, and no case changes outcome.

**GO** on eba76b238.

### Test-only delta, head 63aa44424 (Pau's ruling (b)) — GO

- The only change is to `nov12-17l-card-plan-matches-create-cases.ts`. Each guard now also asserts that the plan
  isn't the termination sentence alone, and (late-on-a-date, flag on) that it contains Pau's attendance template.
- With production flags: all 4 guards pass OFF and ON. The only ON failures in the 17l file filter are the two OPEN
  arms, which now hold (INTENDED).
- Mutation: I changed `src/lib/ai/termination-stated.ts` so the card's Action Plan becomes the termination sentence
  alone. **All 8 runs (4 guards × OFF/ON) fail** with "the plan is the termination sentence alone". After I reverted
  it, they pass again. (A mutation in `withRequiredClosing` changed nothing, because the card's line is built in
  `ai/termination-stated.ts`; that's noted so nobody repeats it.)

**GO** on 63aa44424.
