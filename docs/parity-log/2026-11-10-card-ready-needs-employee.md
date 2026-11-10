# Sunny-only: CARD_READY_NEEDS_EMPLOYEE_ENABLED (no "The card is ready" over a card with no employee)

QA (10 Nov 2026; the roster-name set's eval, n3, a global salon director: "name is TT and use todays date to create coaching
form"): the global salon question, "Which salon is this about? The card is ready — choose the salon …"
(`forms/global-salon-ask.ts`), is written while the card still holds the typed name; when the roster check then emptied the
card, the reply still called it ready, and said "I have the employee.", above "Who is this form for?". With the flag both
claims go when the card has no employee.

Not needed in the sibling app (checked on its main): it has no global salon question and no "The card is ready" sentence;
its location choice is the card's own picker. Its "I have the employee." over an emptied card is dropped by the roster-name
set's FORM_NAME_OFF_ROSTER_ASK (Glowbrands1/Ask-bubbles#665).
