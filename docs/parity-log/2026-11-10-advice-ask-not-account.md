# Sunny-only: ADVICE_ASK_NOT_ACCOUNT_ENABLED (asks for advice are no account on the card)

Pau's P14(b) (Sunny production, 9 Nov 2026, via QA): a manager described an employee's pushback, asked "how i do about
her frusteration", then "tell me how what to say back. send a messageto me", then "create a coaching form for <first
name>". The Coaching card's Observation pasted every manager turn, the asks to the app included. With the flag, a
short sentence that only asks the app for advice or a message is left out of the card's Observation and the draft's
account (`ai/app-instructions.ts`).

Not needed in the sibling app now (checked on its main a529c29e): the same conversation, replayed there with its
production flags and an invented name, makes a Coaching card with no Observation line at all ("Everything I need is
here …"), so the asks cannot show on it, and its draft is not handed the earlier turns (the ACCOUNT_BEFORE_REQUEST
port, coding 5's). When that port hands the draft the turns before the request, it should leave these asks out the
same way; this entry is the note for it.
