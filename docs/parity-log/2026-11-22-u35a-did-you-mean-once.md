# "Did you mean <P>?" is not asked again once the manager corrected the typo or the card is <P>'s (Ask Bubbles #1040, 28ba69dd, its QA's live round-2 re-run, U35(a)) — ported

**Report (Ask Bubbles' production):** the tester's twelve turns: "<P, surname mistyped>" got "Did you mean **<P>**?"; T4
"fix her last name <surname>" was not read as an answer (not a yes, not the full name), so the same question came back at
T3–T6, and after the card was already <P>'s.

**Ask Sunny: same gap.** Sunny's `confirmed-spelling.ts` read only a yes or the offered full name; `closeSpellingNotSettled`
and `cardNameCorrection` re-asked from the first message's misspelling with the card already <P>'s; find_staff's "on this
chat's card" was read from a reply's text, which the Did-you-mean itself names.

**Port (the mechanism; names invented, Sunny's salon and first question):**
- `confirmed-spelling.ts`: an answer holding the one word that turns the manager's typed name into an offered name confirms
  that person (`by: "correction"`; with several offered, only the one the word makes). The typed name is found in the
  manager's earlier words by the record's key. `spellingsConfirmedFor` gives the spellings the chat confirmed as a person.
- `tools.ts`: find_staff seats the one close candidate this chat's recorded answer confirmed for this typed spelling; "on
  this chat's card" is the card record's person, never a reply's words; `closeSpellingNotSettled` is settled by the card's
  own person; `cardNameCorrection` keeps the card its person's on a close spelling of them (no name_corrected fact);
  propose_form's account spelling pass also replaces the spellings the chat confirmed.

**Sunny differs (kept on purpose):** Sunny's item 4 ruling (`confirmed-spelling.test.ts`) is that a first name alone confirms
nobody: "remy" alone after "Did you mean **Remy Calder**?" for "Remi Calder" is a name for the name readers. So the
correcting word confirms only when the answer says more than it ("fix her last name <surname>"); Ask Bubbles has no such
rule and confirms on the word alone.

**Tests:** `confirmed-spelling.test.ts` (2 new: a correction confirms, another word or the word alone does not; with two
offered, the one the word makes): fail before, pass after; the item-4 test is unchanged and passes. Replay `nov22-agent-loop-u35a-did-you-mean-once-cases.ts` (the tester's turns, an invented person): the verbatim
T1–T12 case and the admin account case fail before and pass after; the "fix her last name garcia" control passes before
and after (Sunny's propose_form path never read the reply text). #1243's open verbatim case
(`nov22-u35a-verbatim-correction-confirms`) fails before and is fixed.

**Live harness:** not run here (the session's permission check refused the key); QA runs Sunny's live set.
