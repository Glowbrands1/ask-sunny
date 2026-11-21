# 2026-11-20 — every flag the code reads is in production-flags.json

**Ported from Ask Bubbles #985** (QA's audit of Ask Bubbles, P3). The flag-file test only checked that each listed flag
is read by the code, never the reverse, so flags the code reads but the file never listed ran OFF in the replay pack
whatever production had. Sunny's main read 452 *_ENABLED flags in production code and listed 39 of them nowhere; they
are now under 'unknown' (no value guessed; QA reads each in Vercel), and a test fails on any new unlisted flag. Each app
keeps its own list.
