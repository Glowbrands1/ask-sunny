## 14 Nov 2026: SALON_NAME_LETTER_WORD stays Sunny-only

Coding-4's finding (13 Nov 2026), from Gate-Sunny's #933 place probes: an Admin's "create a ca for <A>, she was at
lincoln street fair instead of her shift" is filed at NE Lincoln O Street. The slot reader (`ai/intent-slots.ts`
matchSalonsInText) matches a salon by its name's words of four letters or more, so "lincoln" and "street" anywhere
were enough; the street "O" was never asked for. With SALON_NAME_LETTER_WORD_ENABLED (default off) a one-letter word
of the name must be said, before the word after it ("o street", "o st").

Sibling app: not needed. Ask Bubbles' slot reader (`matchStoresInText`) also reads only words of four letters or more,
but no store there is told apart by a one-letter word alone: "Sioux Falls, SD (W 41st St)" and "(E 18th St)" need
"41st" / "18th", which a passing phrase does not carry.

Not fixed here: the Observation of that turn still reads "she was street fair instead of her shift" — "at lincoln" is
cut as the shared city. Reported to QA for #936 (PLACE_STRIP_WHOLE_PHRASE_ONLY), which owns that reader.
