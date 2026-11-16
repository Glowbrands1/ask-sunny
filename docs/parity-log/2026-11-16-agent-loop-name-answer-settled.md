# 2026-11-16 — agent loop: an answer to a recorded name question is used (keep-as-typed; the card's name check)

**Stays Sunny-only for now: Ask Bubbles has no agent loop yet.** Two live failures on main e2e92554 (QA): "no" and
"use <typed>" after "Did you mean <B>?" never kept the name as typed (a4); and a full name given right after an
off-roster exit card re-asked about the form instead of correcting the card (c219). Both are now settled from the
server's name question record before any roster refusal: "no" / "use <typed>" keep the typed name, and an off-roster
card's name check is recorded, so the next message's full name corrects the card through the s10 roster check. When the
loop is ported, take the mechanism and the replay cases `nov16-agent-loop-keep-as-typed-cases.ts` and
`nov16-agent-loop-card-name-answer-cases.ts`, swapping the invented people and the salon/store wording.

**Follow-up (QA, 16 Nov 2026, live c219 0/6).** After a recorded name correction (`name_corrected` <T> → <C>), every
turn of the request made under <T> is <C>'s own turn for every evidence check (termination, level, payroll, dates,
account): `tools.ts` adds <T>'s request turns and treats <T> as an alias in `answerEvidence`, and a card recorded under
<T> is this card's request start. The card check (`run.ts`) now compares a reply with the card on screen (its record
holds the policy line beside the level) when nothing is proposed this turn, and writes "That change isn't on the card
yet" only with a card on screen. Sunny-only for the same reason: Ask Bubbles has no agent loop yet.
