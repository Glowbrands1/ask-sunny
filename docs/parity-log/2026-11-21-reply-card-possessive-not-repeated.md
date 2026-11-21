# The reply and the loop card write the person's possessive as the saved write-up does (21 Nov 2026)

**Sibling app: port to Ask Bubbles** (Coding-D copies; it follows #1145's item 19 port). Mechanism only.

QA2's live R3 on cdb2ddc2: "…came into the salon to show her team her new puppy" was saved as "… to show the team the
new puppy" (#1145), but the reply and the card's issue text read "to show <First>'s team <First>'s new puppy".
`agent-loop/reply-pronouns.ts` (`withoutPersonPronouns`, which writes both the reply and the card issue) now writes a
possessive of a person already named in the sentence as "the" when it is an object ("show her team", "team her new
puppy"). It still keeps the name when the possessive opens a clause ("and her shift …"), follows "with"/"of", or sits in
reported speech ("said her car broke down"). Test: `reply-pronouns-possessive-repeat.test.ts`; replay:
`nov21-agent-loop-possessive-not-repeated-cases.ts`.
