# Ported from Ask Bubbles (#1021, U26): how the person resigned is how they quit, not how the manager reached them (22 Nov 2026)

**Sibling app: ported from Ask Bubbles.** Bubbles noted that Sunny's exit-details reader has the same `methodsIn`
(Voicemail included) over the whole account, that its loop had no `exit_method`, and that its own-salon offer ran only
for an active person. Mechanism only.

- **The model's reading.** propose_form takes `exit_method` (one of How Employee Resigned's own methods,
  `EXIT_METHOD_LABELS`) and `exit_method_evidence`. It is kept only when the quoted words of this request name that
  method (`quoteNamesMethod`). Create writes it as the manager's statement after checking the quote in the chat's
  manager turns.
- **No method from the model.** A loop card's draft reads the method only from the sentences in which the exit form's
  own reader reads a resignation type (`resignationStatementMethod`), never from a voicemail left earlier in the account.
- **The salon.** A former employee whom Woven lists at one salon in the manager's scope has that salon offered first
  (`employee_salon`; Bubbles' `employee_store`), as an active person's salon is.
- **The rules book.** The card states `how_resigned`, and `exit_ticks` is never said "as you said". The prompt fixtures
  were re-taken.

Sunny adaptations: salon in place of store, and `salonIds` in place of `locationIds`. The case uses Sunny's invented
people (Odessa Varnell, Corin Vale, Marlo Quint), Sun Tan City titles (Salon Director, Assistant Salon Director) and
Kearney.

Replay: `nov22-agent-loop-exit-method-is-the-quitters-cases.ts` (QA's wording). All 8 runs fail before the port and
pass after.
