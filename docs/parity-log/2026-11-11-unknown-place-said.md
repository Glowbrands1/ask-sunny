## 11 Nov 2026: UNKNOWN_PLACE_SAID_ENABLED — a named place that is not a salon is said back

**Not needed in Ask Bubbles: it does not have this bug.**

QA's D5 follow-up: an all-salon admin who named a place that is not one of the salons ("… for <name> at IA Altoona")
was told "Your account covers every salon, so this form won't name one", as though no place was named. With the flag on
(default off), `holdFilledSlots` (`ai/keep-filled-slots.ts`) says "IA Altoona isn't one of our salons, so this form
won't name one". No protected file is changed.

Ask Bubbles has no `keep-filled-slots.ts`. Probed on its main (11 Nov 2026, replay, production flags, a global district
manager): coaching, corrective action and exit requests "for <invented> at IA Zephyrton" (no such store) gave no
"covers every store" line.
