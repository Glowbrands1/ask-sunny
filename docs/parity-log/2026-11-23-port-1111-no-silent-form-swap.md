# Port from Ask Bubbles (#1111, board f099 on the loop): a form the library does not have is never swapped silently (23 Nov 2026)

**Source:** Ask Bubbles #1111 (head e6bb604, open as a draft when this port was made; QA merges it on CI green). Mechanism
only; this app's own forms and the pack's roster.

In Ask Bubbles, live on the loop, asking for a form the library has no title for made the nearest form's card with nothing
said. This app's propose_form had the same gap (the same `quoteNamesForm`, no evidence of which form was named).

propose_form now takes form_asked_evidence, which is optional: this turn's words naming the form, only when the manager
typed a form's name or title. The check runs only when the quote reads as a form's title, meaning it holds the word the
library's titles end with (`titleWordOf`, read from the template names). The quote is checked against the chosen form's own
names (`quoteNamesForm`).
- Another library form answers to it: form_asked_is_another.
- No form does: form_not_in_library, with an ask_exactly saying there's no such form (`formAskedName` trims it to the form's
  name) and listing the forms. No card is made.
- A substitute only with instead_of_asked true, which the card says (instead_of_asked.say_exactly).

Everyday requests that name no form's title ("write her up", "do the paperwork") are never checked. The rules book has one
line; the prompt fixtures are re-taken; the two reason codes are registered in reason-codes.test.ts.

Replay: `nov23-agent-loop-no-silent-form-swap-cases.ts` (Remy Calder, the pack's roster). Three cases fail before and pass
after (the model choosing the Tanning Consultant Interview Form for "a salon manager interview form"). The control and six
everyday wordings keep their normal cards.
