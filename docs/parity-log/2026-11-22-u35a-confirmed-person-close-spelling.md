# A close spelling of a person the manager already confirmed is that person, not another Did-you-mean (Ask Bubbles #1055, f7122281, u35a) — ported

**Report (Ask Bubbles' live run 2, 22 Nov 2026):** the manager confirmed the person ("fix her last name <surname>", with no
card yet). Then two later turns with new close spellings of that person (letters swapped, a first letter changed) each
got the full "Did you mean **<P>**?" again.

**Ask Sunny: same gap.** Sunny's find_staff close-spelling branch settled a close spelling only when that exact spelling
had been confirmed. `nov22-u35a-confirmed-person-new-close-spelling-not-asked` fails on main: T6 and T8 ask again.

**Port (the mechanism; the person invented):** `agent-loop/tools.ts`, find_staff's close-spelling branch. When the staff
list's only close candidate is a person the manager already confirmed in this chat (any spelling, from the question
records, `spellingKeysConfirmedFor`), and this message is not a "no", that person is used. No word list. A "no" still
asks (control case).

**Not ported here: Ask Bubbles' U35(a), #1040 (28ba69dd).** It reads a typo corrected to the offered name ("fix her last
name <surname>") as a yes, and it decides "the person on this chat's card" from the card record instead of reply text.
Sunny reads that T4 as no answer, so the fix case confirms with a plain "yes", and the tester's verbatim T4 is an open case
(`nov22-u35a-verbatim-correction-confirms`, an expected failure in both flag modes) that flips to a reported pass when
U35(a) is ported.

**Tests:** replay `nov22-agent-loop-u35a-confirmed-person-cases.ts`: the fix case fails before and passes after; the "no"
control passes before and after; the verbatim case is open.

**Live harness:** not run here (the session's permission check refused the key); QA runs Sunny's live set.
