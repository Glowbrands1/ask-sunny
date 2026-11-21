# A message naming another person, not the open card's, with its own date is that person's request (21 Nov 2026)

**Sibling app: port to Ask Bubbles** with CARD_PERSON_THIS_REQUEST (Coding-D). Mechanism only.

QA2's ruling on #1199 (option b, belt-and-braces beside the live model's new_form_evidence): with
CARD_PERSON_THIS_REQUEST on, "the same for <B>, she was late on 11/10/26" after <A>'s card was refused without
new_form_evidence. `agent-loop/tools.ts` now treats a message as <B>'s own request when, by the records, it names the
card's person (the roster), names NOT the open card's or draft's person (any of their names, first name included), and
states its own date. "Salon Director, <B>, messaged <A> …" names <A>, so it is still refused. Replay:
`nov21-agent-loop-new-person-own-account-cases.ts`.
