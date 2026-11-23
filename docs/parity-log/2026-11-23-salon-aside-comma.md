# A salon phrase written as an aside leaves the account with its commas (23 Nov 2026, port of Ask Bubbles #1078, A1)

**Sibling app: ported from Ask Bubbles** #1078 (its QA's live re-run of 23 Nov, A1), taken from that pull request's
head `39f86b1` before it merged. Stacked on Ask Sunny #1236 (`claude/fix-salon-phrase-leaves-place-word`, `547fe5b`),
which this builds on. Mechanism only: no store names, no Bubbles wording.

`withoutNamedSalon` (`agent-loop/tools.ts`) took the salon phrase and its closing comma out and left the opening one:
"<P>, at Kearney, was 10 minutes late" became "<First>, was 10 minutes late". With the state (#1236's R13 shape) it
was worse: ", at Kearney, NE, was" left "<First>,, was".

Now a phrase with a comma before it is an aside and leaves with that comma; the text after it follows the words before
it. With no comma before it, a comma after it closes something earlier and stays (", a tanning consultant at Kearney,
was" keeps its closing comma). At the very start, the phrase leaves with its comma. Bubbles changed only the plain
phrase; Sunny also reads the state with the phrase (#1236), so the same rule is applied to that pass. Punctuation and
the salon's own data only, no word lists.

| Account (salon director at Kearney) | #1236 head | After |
| --- | --- | --- |
| "Testy, at Kearney, was late …" | "Testy, was late …" | "Testy was late …" |
| "Testy, at Kearney, NE, was late …" | "Testy,, was late …" | "Testy was late …" |
| "Testy, at the Kearney salon, was late …" | "Testy, was late …" | "Testy was late …" |

Tests: `without-named-salon.test.ts` ("commas around a salon phrase", 5 cases), and replay
`nov23-agent-loop-salon-aside-comma-cases.ts` (invented Testy Testerson): `nov23-a1-salon-aside-leaves-with-its-commas`,
`nov23-a1-salon-aside-with-state-leaves-with-its-commas`, `nov23-a1-salon-after-title-aside-keeps-closing-comma`. All
fail on #1236's head and pass after.

Bubbles' tester also misspelt the name on the first turn; that turn is left out here, because Sunny's person-change
guard refuses a different name on an open card without new-form evidence (a separate behaviour, not this fix).

One difference from Bubbles: there, a comma after a phrase with no comma before it always stays. Here it stays only when
its sentence opened a comma before the phrase (", a tanning consultant at Kearney, was"). Otherwise it is the phrase's
own and leaves with it, as Sunny's item 20 test asks ("She was late at the Kearney salon, and left early." → "She was
late and left early."). Bubbles has no test for that shape; it would keep "She was late, and left early." Worth a
back-port if Bubbles' QA wants the same.
