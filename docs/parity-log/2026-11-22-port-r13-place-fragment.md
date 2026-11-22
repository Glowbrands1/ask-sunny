# Ported from Ask Bubbles (#1027, R13): the salon the manager named leaves the account whole, state and all (22 Nov 2026)

**Sibling app: ported from Ask Bubbles.** Mechanism only.

"… at <store>, NE. location. On 10-16-26 Testy …" gave the Observation "NE on 10/16/26 …". The place phrase left the
account (`withoutNamedSalon`, QA item 20), but its state ", NE" stayed. Now a ", <word>" right after the phrase, where
the word is part of that salon's own name ("NE" in "NE Kearney"), goes with the phrase. A word that is not the salon's
own ("at Kearney, she …", "at the bank, NE side") is left as typed.

Sunny's tests use Kearney and a salon's account in place of the sibling app's store and its work:
`agent-loop/without-named-salon.test.ts` and replay `nov22-agent-loop-place-fragment-cases.ts` (QA's test name). Both
fail before the port and pass after.
