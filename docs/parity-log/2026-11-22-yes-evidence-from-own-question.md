# "Yes please" to the app's own "… for <P> … Is that the one you mean?" opens <P>'s form, whichever turn the model quotes (Ask Bubbles #1059, 1b132cca) — ported

**Report (Ask Bubbles, its QA's follow-up, 22 Nov 2026, both apps):** in 1 of 6 live runs the model found the form by
date and asked "I found a Corrective Action Form dated 11/20 for <P> for lateness. Is that the one you mean?"; the
manager's "yes please" was refused as privacy_not_this_person. Sunny's #1219 (S1(b)) reads only the app's reply right
before the QUOTED message, and the model quoted either the manager's earlier request (naming nobody, no reply before it)
or the app's own question (refused: the app's turns carry no id the model sees). Bubbles #1059 also carries the
Bubbles port of Sunny's #1219, which Sunny already has.

**Port (the mechanism; `agent-loop/tools.ts`):**
- `formsOnFileAsked`: the app's own question right before the message being answered, quoted under that message's id
  (or its own), with the quote really in it, is evidence; the ask is the manager's reply.
- `formsOnFileAskedFor`: the cited manager turn names nobody, the app's question right before the current message names
  this person, and no manager turn from the cited one to now names anyone: the ask is about them. The person only ever
  comes from the app's own question in this request.

**Sunny-only test change:** `privacy-evidence.test.ts` (Bubbles has no such file) expected the app's own words to be
refused as evidence even from the turn right before the current message. That line changes on purpose (comment in the
test); the app's words from any earlier turn, or a quote not in its question, are still refused.

**Tests:** replay `nov22-agent-loop-yes-evidence-from-own-question-cases.ts` (invented Remy Calder / Juno Paxton, STAFF;
the tester's words, the date 11/20): the two "opens" cases and the tester-order case fail on main (6 runs), pass after;
the two controls (Juno's forms; another person named in between) stay closed before and after. Sunny's #1219 S1(b)
cases still pass. Live harness not run here; QA runs the live set.
