# 2026-11-20 — Create: a loop card never passes on a name start the loop would not settle

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet, so it has no loop cards (`isSettledName` is only given
for them; #1095). Rule this adds (`checkProposalIsCurrent`): for a loop card, the start rules (`typedFor`'s 2-letter
starts, `looseFits`, the accepted-suggestion and preferred-name starts) never accept a name, and a name read after the
card that is only part of the card's name and part of another roster person's ("Remy") makes the card out of date.
Old-path cards are unchanged. Port with the loop.
