## 13 Nov 2026: CARD_ADDED_FACT_IN_OBSERVATION stays Sunny-only

QA's Sunny 38f live test (main 24e0fb74): with CARD_CHECKED_AGAINST_WORDS on, "create a CA for <A>, she was late on
11/3/26" then "she yelled at a guest and she maybe forgot" was noted as "Added to the Observation of Offense: she
yelled at a guest", while the card's Observation held the whole turn joined with a space. This app's card has no
Issue: its Observation line is built before the card check (`ai/keep-filled-slots.ts`), and the check only added the
note. The fix rewrites that line to match the note.

Ask Bubbles' card carries an Issue, and its card check writes the trimmed fact into it ("…; she yelled at a
customer") and reads the note from the same value: QA's Bubbles 17w live item 4 showed it right. Not needed there.
