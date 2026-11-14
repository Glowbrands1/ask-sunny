# #964 MODEL_WARNING_LEVEL_DISCARDED — Sunny — **GO @ca2b1fc8** (main bf62d363); RELEASE ONLY WITH #970

38g live bug: a CA with no stated level was saved with the model's Written.

## Heads
- d5225286: first probes.
- 3e5ee833: + the level stated in the drafting turns written as the manager's statement (as Bubbles); full runs.
- ca2b1fc8: route.ts promptGroups line kept as on main, with the flag's filter chained after it; flag added to flags-off-parity
  NEW_FLAGS.

## Evidence
- Full runs on 3e5ee833 vs main bf62d363 (production flags):
  - Flag ON: all 1,814 existing replay records byte-identical; the only status changes are the PR's new tests and 4 OPEN arms
    (each flags-off-parity quarter fails only on one of them).
  - Flag OFF: the same, plus no OPEN flips.
  - Both had 1 CI break: coaching-autocomplete.test.ts (a source-text guard on the promptGroups line), clean env, flag-independent.
- ca2b1fc8 delta (1 line + parity list): clean env coaching-autocomplete + model-warning e2e + pm-draft-route 98/98; flag on 24/24;
  tsc clean.
- Eval 63/63 (3e5ee833), 0 of 41 rows changed.
- Probes (17 + 6 history), scripted model always ticks a level:
  - unstated → [] (38g live wording fixed);
  - stated levels kept whatever the model ticks, including numbered notes "3. verbal warning";
  - an earlier verbal (same turn, later turn, coaching remark) never becomes this form's level;
  - termination untouched.
  - Identical with SPELLING_CLEANUP on.
- Pre-existing, not #964:
  - "final warning CA for …" isn't read as a stated level;
  - "second verbal for …" gives no card (#968 covers it).
- Merge onto main 857482ca: flag-list conflict only (keep both).

## Release rule (QA)
#964 and #970 ship and roll back together. QA's "verbal warning on 9/21. late again…" is read as a stated Verbal by the
card on main, and #964 alone keeps that; #970 fixes it.
