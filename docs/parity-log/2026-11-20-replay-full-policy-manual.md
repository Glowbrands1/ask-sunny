# 2026-11-20 — replay pack: REPLAY_FULL_POLICY_MANUAL reads the whole production manual

**Stays Sunny-only.** Test harness only (no app code): `REPLAY_FULL_POLICY_MANUAL=1` makes the replay pack's knowledge
provider return the 151 production manual rows already in the repo (`src/test/fixtures/jba-manual-full.ts`) instead of
the CA-only fixture, for shadow and saved-form runs (QA, 20 Nov 2026: c259/c242/c091 policy findings were fixture
artifacts). Ask Bubbles' replay harness can take the same switch over its own manual fixture when it needs it.
