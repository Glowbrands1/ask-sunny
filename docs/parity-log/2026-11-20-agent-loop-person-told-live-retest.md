# 2026-11-20 — agent loop: the person told is named across turns, and the card's own account is named too

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet.

QA's live retest of #1147 (conv_mwp5inao2y4s849) and a second sample (conv_mwp6vj6m2fmzxg9):
- The pronoun pass (`reply-pronouns.ts`) found the one doing the telling only among known names. Live, the shift lead was
  named in an earlier turn and is not on the roster, so "<A>'s shift lead, <L>, told her …" read <A> as the teller and
  kept "her … she". The teller is now the subject right before the verb (an appositive set aside), known or not, and a
  possessive never tells.
- The card's own account (propose_form's issue) gets the same pass with the card's reply name ("She was late on
  11/19." → "<first name> was late on 11/19.").
- The rules book's not-a-request line asks for Sunny's own words with the person's first name, never the manager's text
  typed back or a pronoun.

Port with the loop when Ask Bubbles gets it.
