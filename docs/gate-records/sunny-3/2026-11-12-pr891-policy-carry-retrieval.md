# Gate-Sunny-3 — #891 POLICY_CARRY_RETRIEVAL_ENABLED — GO

- Head `792fe043` (Coding-6 + Coding-2). Merged onto main `05576461` (clean, tsc clean); also clean onto `40ec11436`.
- The harness change is record-only: the fake knowledge search pushes each query to `state.knowledgeQueries`, and a case
  reads it with `searches()`. Nothing else in the harness changed.
- 1 OFF + 1 ON, full suite, production flags in the env. ON adds `POLICY_CARRY_RETRIEVAL_ENABLED`.

| | tests | passed | failed |
|---|---|---|---|
| OFF | 21,914 | 20,520 | 1,260 |
| ON  | 21,914 | 20,516 | 1,264 |

Status changes ON vs OFF:
- replay `nov12-248-just-make-it-searches-the-named-policy` OPEN arm: it now holds. INTENDED. Parity child: INTENDED-HARNESS.
- `policy-carry-retrieval.test.ts` "T4 'just make it' off: no carried topic": fails with the flag on in the env. The
  "off" test doesn't stub the flag off. INTENDED-HARNESS. Tidy-up: `vi.stubEnv(…, "")` in the off test.
- chat-trace.migration: noise.

Replay text: **1 record differs** (the target's open arm). The turns' text and system prompts are the same; only the
recorded search query differs, so the replies don't move in the stubbed pack. 0 REGRESSION.

Eval (flag on): 63/63, 42/51 cases pass, and no case changes outcome.

**GO.** The case that now holds is `nov12-248-just-make-it-searches-the-named-policy`.
