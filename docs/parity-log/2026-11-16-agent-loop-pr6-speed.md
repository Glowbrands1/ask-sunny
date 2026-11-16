# 2026-11-16 — agent loop PR 6: speed

**Stays Sunny-only for now.** The agent loop is not in Ask Bubbles yet (it is behind AGENT_LOOP_ENABLED here, under
rebuild). PR 6 changes only the loop:
- propose_form looks up a typed name itself;
- the policy manual is read once per turn;
- the step budget counts the reviser's model calls;
- find_staff says more_matches.

Two shared files gain no-op hooks: `src/lib/ai/anthropic.ts` and `src/lib/forms/form-patch-call.ts` note a model call
only inside a loop tool's scope (`src/lib/ai/model-call-scope.ts`), and count nothing elsewhere. When the loop is
ported, take these with it. The mechanism is the same, with the invented people and salon/store wording swapped.
