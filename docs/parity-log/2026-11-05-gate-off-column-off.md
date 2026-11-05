# flag-classify: the off column has every flipped flag off (FLAG_CLASSIFY_OFF; Sunny only for now)

**Report.** QA, 5 Nov 2026: Pau checked Vercel, and `PRIOR_COACHING_OPTIONAL_ENABLED` is off in this app's production. `src/config/production-flags.json` lists it under `assumedOn`, so the replay pack and every gate ran it on.

**Change.** The replay pack always turned on that file's `on` and `assumedOn` lists, and a gate could only add flags. Now `scripts/flag-classify.ts` sets `FLAG_CLASSIFY_OFF` to the flipped flags (`--flag` plus `--and`) in its off runs, and the pack leaves them off. Nothing changes when the variable is unset.

**Why Sunny only, for now.** Ask Bubbles' `production-flags.json` does not list `PRIOR_COACHING_OPTIONAL_ENABLED`, so its pack already runs it off. Bubbles' `flag-classify.ts` also has no `--and`, which is what flips several flags at once. Port both together the first time a Bubbles gate flips a flag that its `production-flags.json` lists as on.
