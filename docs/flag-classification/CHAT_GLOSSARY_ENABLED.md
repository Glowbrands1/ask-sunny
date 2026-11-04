# CHAT_GLOSSARY_ENABLED: which tests it changes, and why

Written from `node scripts/flag-classify.ts --flag CHAT_GLOSSARY_ENABLED src/lib/forms src/app/api/forms src/app/api/chat src/lib/ai` on main 621f521a (the glossary, #506). The run was stopped at the 2-hour limit for background runs on a loaded machine after **5 of 6 runs: 3 off, 2 on** (11,057 tests each); the table below is computed from those five runs' JSON reports. An earlier whole-suite run (18,658 tests) was stopped after 2 off and 2 on and showed the same result.

Tests run: 11057. Changed: 1. INTENDED 1, INTENDED-HARNESS 0, REGRESSION 0, FLAKY 0 (see below), UNCLASSIFIED 0.

Replay records (171, the replay pack's REPLAY_RECORD lines): none differs between off and on in a way that is stable across runs.

| test | off | on | category | twin | reason |
| --- | --- | --- | --- | --- | --- |
| src/app/api/chat/replay-pack/replay-pack-e2e.test.ts :: the replay pack nov4-scan-sf-s12-msb-not-a-person: "I need to make a corrective action for msb" — MSB is Must See Behaviors (the reason), not a person: ask which employee, never save "Msb" as the name — OPEN in production ("msb" is taken as the employee: the card is for "Msb" ("I can create a Corrective Action Form for **msb**"), awaiting the incident, and never asks which employee) | expected fail (3/3) | passed, so reported failed (2/2) | INTENDED | the same case with production's flags (flag unset): OPEN, expected to fail | An OPEN-in-production case that holds with CHAT_GLOSSARY_ENABLED on (vitest reports the expected failure as failed when the case passes): "msb" is never the employee and the reply asks which employee. Sunny #508 moves it to fixed after the flip. |

## Failing in both modes (not caused by the flag)

These failed with the flag off AND on, in some or all runs, and none reads CHAT_GLOSSARY_ENABLED. They are timeouts under the machine's load (several classifier and test runs in parallel); each passes alone with a longer timeout:

- `src/lib/ai/chat-trace.migration.test.ts` (3 tests): PGlite migrations, 5 s test timeout.
- `src/lib/ai/performance-management-runtime.test.ts` (2 tests): 5 s test timeout.
- `src/lib/ai/flags-off-parity.test.ts` (2 child runs): the 540 s child-run limit.
