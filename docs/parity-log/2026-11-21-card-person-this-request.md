# 2026-11-21 — a card's person is named by the manager in this request (CARD_PERSON_THIS_REQUEST_ENABLED)

**Loop: Sunny-only for now (Ask Bubbles has no agent loop). The mechanism applies to Bubbles' chat path; see below.**

The outside audit's wrong-person risk (approved by Pau, 21 Nov 2026; it happened in Ask Bubbles on 18 Nov 2026): the
agent loop's `personNamedOrPicked` seated a roster person when any manager turn in the chat held their name, or any
earlier card in the chat was theirs. Behind the new flag (off in `production-flags.json`), a person is seated only when:

- the manager named them in this request: the turn that asks, or a manager turn after the chat's last card and after the
  last manager turn that named a different roster person (`ai/agent-loop/person-in-request.ts`), which keeps the f059
  story-then-ask flow; or
- a recorded confirmation (a spelling confirmed, a name question answered), the card on screen or the open draft; or
- an earlier card for them, only while no different person was named since.

A name the model passes that is nobody on the roster is taken only from the manager's words of this request; otherwise
Sunny asks who the form is for. Sunny's own replies and tool notes were never read by these checks and still are not.
With a card on screen, this chat's latest card or a draft open for one person, a card for a DIFFERENT person is made only
when the manager's own words ask for another form (`new_form_evidence`, this message) or correct the person: a person
named inside an account ("<Y>, the salon director, messaged <X> …") never takes the form from <X> (QA2's 17 Nov case,
Ask Bubbles' old path, conv_mwk2t40v27izanu; replay case `nov21-card-person-exit-account-names-the-salon-director`).

**Ask Bubbles' old chat path: Monday (Pau, 21 Nov 2026), not touched.** It carries a person over from any earlier turn
when its six-turn window names nobody (`employeeFromEarlierTurns`, only when the conversation settles on one person,
with the "I took <A> from earlier" notice), and the 17 Nov exit went to the role-named person (its #933, and Sunny's
#1030 `ACCOUNT_PERSON_NOT_SUBJECT`, both open, cover that on the old path). **Sunny's old chat path:** left as is; its
person check is not shared with the loop. Ask Bubbles' loop will copy the Sunny version.
