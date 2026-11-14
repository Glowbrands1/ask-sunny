# #971 OTHER_BESIDE_DESCRIBED — Sunny — **GO @496d35c5** (main bf62d363)

Live mismatch (OTHER_POLICY_AGREES on since 38e):
- "she was on her phone and did not do the 10 minute sanitation" → box Other, Direct policy = Cell Phone text;
- "late … and did not do the sanitation" → Attendance dropped.

## Heads
- d01a816c: first probes.
  - F1: Attendance + cleaning, Policy Violated dropped Other. QA: must fix.
  - F2: no Other line in the plan. QA: accepted, the card note is enough.
- 605c2c81: F1 fixed. Full runs:
  - flag OFF = main + new cases;
  - flag ON: REGRESSION on nov6-as-you-said-attendance-s2a-opening-cleaning-duties ("failing to complete opening duties. … did not
    complete daily cleaning duties" → Attendance instead of Other).
- 2ec46bd7: three-label Policy Violated keeps every policy.
- 496d35c5: duties words are no second offense; the attendance branch needs a lateness/absence word; protected
  form-proposal.ts patch regenerated (byte-identical, checked).

## Evidence on 496d35c5
- Delta run, flag ON (replay pack + api/forms + lib/forms + form-proposal + form-card-slots) vs main bf62d363:
  - 1,814 shared replay records byte-identical (the s2a opening-duties record included);
  - +4 new cases; the 2 OPEN arms flip;
  - the only other change: required-policy-citation-other "off" test, which fails only when the flag is forced on (passes clean env and
    on production flags). Nit: pin the flag off in that test.
- Flag OFF: full run on 605c2c81 = main + new cases (the 605→496 delta is behind the flag).
- Eval 63/63, 0 of 41 rows changed.
- Probes (14 wordings × off/on):
  - phone / late / rude beside cleaning lead with the described offense, Other ticked and in Policy Violated, card note;
  - cleaning alone, opening/closing duties and opening checklist stay Other alone;
  - plain lateness unchanged.
- Gap, not a regression: late + yelled + sanitation on production flags alone ticks Attendance + Other, not SoC (the chain's other
  flags supply it).
