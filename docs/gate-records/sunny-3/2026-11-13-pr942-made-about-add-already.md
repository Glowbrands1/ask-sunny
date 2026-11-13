# Gate-Sunny-3 — S#942 MADE_ABOUT_EMPTY_PATCH_ANSWERS_SAVED + ADD_ALREADY_ON_FORM_SAYS_SO — GO (head 0190ed13b9)

Coding-6, Sunny twin of Bubbles 17u. Heads: c3743f37e → 05c9af522b → 0190ed13b9 (the later two change only
add-already-on-form.ts, its test and the cases). The PR is based on 0ef33633; I merged main b3352a76 locally (flag-list
conflict, both kept, one `}` restored); tsc clean.

## Full suite (production flags incl. SHARED_CITY + OTHER_POLICY_AGREES)
- main b3352a76 1,265 / PR OFF 1,265 / PR ON (c3743f37) 1,269 failed. OFF vs main: only the new arms added; 0
  existing replay records change.
- ON (c3743f37) changed 2 target arms plus `nov7-refusal-sun-make-that-update` (×2 shapes): "add details about the
  towel" got "already says that". That was the old head's looser match (any content word anywhere on the form).
- **Replay pack ON on 0190ed13b9** (whole pack, both flags) vs OFF: **2 records differ**, the two OPEN arms, which
  now hold. The new `nov13-add-already-on-form-says-so-small-word-left-out` also holds. The towel cases are
  unchanged from OFF. 0 REGRESSION.

## Probes (QA's flow; invented person; production flags)
CA "she was late on 11/3/26" → Create → "change the issue to not doing the 10-minute sanitation" → "make it about her
phone use instead, she was on her phone the whole shift" → add:
- MADE_ABOUT: 1 revision (2 OFF); the reply names the Observation change instead of "I haven't changed…". Works with
  either flag alone.
- ADD_ALREADY on 0190ed13b9, the matcher against "…was on the phone for the entire shift. / Phone use is limited to
  breaks.":
  - ALREADY: "…on the phone the whole shift" (QA's), "…on her phone the whole shift", "…for the whole shift", "…on
    the phone", "phone use is limited to breaks".
  - not: "…not on the phone…", "…off the phone…", "…never on the phone", "…for an hour", "…of 11/4", "…again on
    11/5", "…and ignored a guest", "…of a customer", "phone use is not limited to breaks".
  - End to end with both flags, QA's add gets "The Corrective Action Form for <name> already says that: I checked
    the saved form…". Negation and new-fact adds are still added.
  - On 05c9af522b QA's wording still missed (the "for" was left out); fixed in 0190ed13b9 by skipping filler words.
- Eval (both flags): 63/63, 42/51 cases pass, and no case changes outcome.

## Verdict
**GO on 0190ed13b9** for MADE_ABOUT_EMPTY_PATCH_ANSWERS_SAVED and ADD_ALREADY_ON_FORM_SAYS_SO. The PR needs main merged
before it lands (flag-list conflict only). Cases that now hold: nov13-made-about-empty-patch-answers-saved,
nov13-add-already-on-form-says-so, nov13-add-already-on-form-says-so-small-word-left-out.
