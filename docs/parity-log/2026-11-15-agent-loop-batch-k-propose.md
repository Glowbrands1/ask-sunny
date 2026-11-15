# Agent loop batch K, propose_form (K4, K6, K8): Ask Sunny only

**Change in Ask Sunny** (v2-Coding-9, 15 Nov 2026; `src/lib/ai/agent-loop/`, from the private shadow replay of 266
real manager chats):

- K4: `propose_form` adds the fact `account_names_other_person` (each full name in the manager's own words for the
  request other than the card's person, masked as untrusted text, with the sentence it was said in) and a rules-book line
  that asks "This account is about <Y>. Is the form for <Y> or <X>?". The model decides from the sentence whether the
  account is about <Y> (a witness or a mention is not a question); code reads no intent.
- K6: the card's date is read from the person's own request turns, never from the chat before it.
- K8: a turn whose name the app asked about ("Did you mean", "reply use"), followed by the turn that corrected it,
  belongs to the corrected person (`turnsFromThisPersonsRequest`), so an exit asked in it, and its termination
  words, survive the correction.

**Ask Bubbles: not needed yet** (v2-Coding-9). Ask Bubbles has no agent loop on its main; all three live in the loop's
`propose_form` and its request-turn helpers. Port them with the loop, on Bubbles' own data (store ↔ salon). The old
chat path is unchanged (`this-persons-turns.ts` only gained an optional argument).
