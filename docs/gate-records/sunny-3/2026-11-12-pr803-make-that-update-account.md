# Gate-Sunny-3 — #803 MAKE_THAT_UPDATE_ACCOUNT_ENABLED — GO

- Head `042d00ed` (Coding-5). Merged onto main 40ec11436 (clean, tsc clean); also clean onto 1ecadf923.
- 1 OFF + 1 ON, full suite, production flags in the env.

| | tests | passed | failed |
|---|---|---|---|
| OFF | 21,894 | 20,501 | 1,259 |
| ON  | 21,894 | 20,499 | 1,261 |

- replay `nov10-make-that-update-writes-her-account` OPEN arm: it now holds. Instead of "I haven't changed the Coaching
  Form … Tell me which part to change", her account is written ("Details of the incident … marked a … the guest hadn't
  been sprayed yet …" reaches coaching_details). INTENDED. Parity child: INTENDED-HARNESS.
- Replay text: **1 record differs** (the target). 0 REGRESSION.
- Eval (flag on): 63/63, 42/51 cases pass, and no case changes outcome.

**GO.** The case that now holds is `nov10-make-that-update-writes-her-account`.
