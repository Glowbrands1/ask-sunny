# The reply and the loop card write the person's possessive as the saved write-up does (21 Nov 2026)

**Sibling app: port to Ask Bubbles** (Coding-D copies; it follows #1145's item 19 port). Mechanism only.

QA2's live R3 on cdb2ddc2: "…came into the salon to show her team her new puppy" was saved as "… to show the team the
new puppy" (#1145), but the reply and the card's issue text read "to show <First>'s team <First>'s new puppy".
`agent-loop/reply-pronouns.ts` (`withoutPersonPronouns`, which writes both the reply and the card issue) now writes a
possessive of a person already named in the sentence as "the" when it is an object ("show her team", "team her new
puppy"). It still keeps the name when the possessive opens a clause ("and her shift …"), follows "with"/"of", or sits in
reported speech ("said her car broke down"). Test: `reply-pronouns-possessive-repeat.test.ts`; replay:
`nov21-agent-loop-possessive-not-repeated-cases.ts`.

**Also in this PR (QA2's live R3, same day):**
- #1168's case: "Her shift lead told her to go home and she refused" read "<First>'s shift lead, <J>, told <First> to go home
  and <First> refused". When the told listener is named later in the sentence (f059), the opening possessive is now "The":
  "The shift lead, <J>, told <First> to go home and <First> refused". Same file, `reply-pronouns.ts`. Port with the above.
- #1174's case: a termination's reason line saved "terminated for job abandonment; not eligible for rehire." The reason
  trim (f077) moved to `lib/forms/exit-reason-only.ts`. A rehire answer (read by the exit form's own `readExitDetails`)
  leaves the reason and answers "Is this employee eligible for rehire?". Port to Bubbles' `api/forms/instances` the same way.
