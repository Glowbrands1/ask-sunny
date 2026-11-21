# A message naming another person, not the open card's, with its own date is that person's request (21 Nov 2026)

**Sibling app: port to Ask Bubbles** with CARD_PERSON_THIS_REQUEST (Coding-D). Mechanism only.

QA2's ruling on #1199 (option b, belt-and-braces beside the live model's new_form_evidence): with
CARD_PERSON_THIS_REQUEST on, "the same for <B>, she was late on 11/10/26" after <A>'s card was refused without
new_form_evidence. `agent-loop/tools.ts` now treats a message as <B>'s own request when, by the records, it names the
card's person (the roster), names NOT the open card's or draft's person (any of their names, first name included), and
states its own date. "Salon Director, <B>, messaged <A> …" names <A>, so it is still refused. Replay:
`nov21-agent-loop-new-person-own-account-cases.ts`.

**Also (#1199, QA2's item B fix, same day):** with CARD_PERSON_THIS_REQUEST on, the manager's one-word "yes" to the app's
own next-person offer ("Want me to make the … for <B> next?", after "write CAs for <A> and <B>") was refused
(`person_not_named`, then `person_change_not_asked`). That accepted offer now counts as <B>'s request in
`personNamedOrPicked` and in the guard's `ownRequest`, reading Sunny's own reply (`offeredNextFirst`), never the manager's
words. Replay: `nov16-several-people-one-card-then-yes`, unchanged. Port with the above.
