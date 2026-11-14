# #961 ON_FILE_LINE_NOT_THE_POLICY — Sunny — **GO @db50848e** (main bf62d363)

Live bug (Pau's morning scan, 13 Nov): a dress-code CA resent word for word was carded "Policy: Late Opening — read from this
request", because the intent reader took the heading from the app's own "On file in Form Monitoring … Late Opening" line.

## History of heads
- 2798441b: literal heading match. Probe NO-GO: a described late opening ("she opened the salon 25 minutes late",
  "make it about her opening…", typo "late openng") lost its Policy line for a repeat offender.
- 8099b668 / 20329550 / 4f6e20b7: the card's own readers on the manager's words (policy reader, describesLateOpening,
  manual named/described sections, close spelling).
- 4f6e20b7 full runs: flag OFF = main + the PR's new cases only. Flag ON: 1 REGRESSION,
  warning-level-live-path-oct24 R2. Cause: policyHeading undefined passed `!== null`, headingOnlyOnFile threw, and the catch
  dropped the turn's whole intent reading.
- db50848e: `?? null` + a typeof guard + main bf62d363.

## Evidence on db50848e (flag on, production flags of main bf62d363)
- Replay pack: 1,814 shared records byte-identical to main bf62d363 (replies, ok, system-prompt hashes); +5 new cases.
- src/lib/ai + src/app/api/forms: 775 failed on both sides (production-flags baseline); 0 status changes except 7 new
  passing on-file-heading tests. R2 now matches main.
- Eval on 4f6e20b7 (63/63, 0 of 41 rows changed); the delta since is only the guard.
- Probes (repeat offender with Late Opening on file, and fresh; flag off and on):
  - kept Late Opening: QA's 4 different-stem wordings, my 4, "late for her opening shift",
    "customers waiting … late opening up";
  - fixed: the crewneck resend;
  - "on her phone the whole shift" now reads Cell Phone.
- Residual follow-up (QA: not a blocker): "doors didn't get unlocked till 10 past opening" for a repeat offender falls back
  to "check the applicable company policy".
