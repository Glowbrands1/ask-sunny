
## Re-gate, heads 885244c8e → 867dc2de0 (main b3352a76 merged in) — in progress 13 Nov ~22:00Z

- 51676ea1b no longer merged onto b3352a76 (a cleaningUndonePhrase conflict with #839). Coding-5 merged it as
  885244c8e (both sides kept: SPELLING_CLEANUP's text feeds main's OTHER_POLICY_AGREES pattern list); tsc clean.
- Full suite, production flags (main b3352a76 = `mb335`, PR OFF `w927`, PR ON `w927ON`, on 885244c8e):
  - main 1,265 / OFF 1,265 / ON 1,274 failed.
  - OFF vs main: only the new nov13 arms are added; 0 existing replay records change.
  - **ON vs OFF: only the 5 nov13 OPEN arms (now hold) and 4 parity quarters.** Replay: 5 records differ, all
    targets.
- The 74-row class from 1daeb29d4 is GONE. The 8 date and audit files (ordinal, prior-sentence(+live), prior-row,
  relative, unread-day, qa-oct21-audit, account-only-policy-query) give the same 74 failures OFF and ON (the
  production-env baseline), and no field falls back to the chat turn.
- Found on 885244c8e: the possessive of the full name ("Marnie Holloway's drawer…") counted as a changed name →
  4 calls, draft replaced by the never-blank fallback. **Fixed in 867dc2de0** (a trailing 's/’s is stripped).
  Re-probed: straight, curly, lowercase-typed and capitalised possessives → 1 call, saved as written. A respelled
  possessive ("Halloway's") is still refused. New case `nov13-spelling-cleanup-possessive-name-kept` passes in
  both arms. The qa-oct21 "Sela's" fallbacks are gone. One harmless leftover: 8× "October 21, 2026 was not given"
  in qa-oct21-audit, which only redrafts without the rule, with identical results.
- Eval (flag on, 885244c8e): 63/63, 42/51 cases pass, and no case changes outcome.
- Pending: the prompt-unchanged-OFF hash check (tools/hash-prompts.py; replay pack on main b3352a76 vs PR
  885244c8e; ~1,650 of 1,790 records done). The 867dc2de0 delta is flag-gated, so OFF prompts can't change. Then
  the verdict (expected GO).
