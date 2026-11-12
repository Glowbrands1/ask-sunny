# 2026-11-12 — "can employees wear uggs at work?" and the full-manual gate (open case; no fix yet)

**Sibling report:** Ask Bubbles' 17g live test: "policy specific to uggs?" was not answered from the manual there.
Bubbles fixed it with FULL_MANUAL_WIDE_GATE (on in Bubbles).

**Checked here (12 Nov 2026, production flags):** `isPolicyAnswerQuestion` loads the JBA Policy Manual for
"is there a policy specific to uggs?" and "are uggs allowed?" whatever the normalizer's intent. "can employees wear uggs
at work?" loads it only when the intent reads "policy"; read as "other" or none, it is answered from retrieval alone.

**Decision (QA, 12 Nov 2026):** no wide-gate port for now. The replay case `nov12-uggs-can-employees-wear-reads-manual`
is OPEN and documents the gap; `nov12-uggs-policy-specific-reads-manual` guards the wording that works. Fix it, by
porting the mechanism and not the sibling's words, if a manager hits it.
