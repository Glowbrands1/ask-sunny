## 4 Nov 2026: QA's overnight scan — 11 replay cases in both apps, where the apps differ

Ported from Ask Bubbles (1551d306). Test-only, no flag
(`src/app/api/chat/replay-pack/nov4-overnight-scan-cases.ts` in both apps,
the same ids). The same eleven chats, each app in its own setting: salons
here, stores in the sibling app. sf-s11 … sf-s20 are this app's chats; sf-b5
is the sibling app's, run here at a salon with a neutral salon product in
place of its laundry refills.

Where the result differs today (production flags):

- sf-s14 (team coaching at a salon outside the manager's scope) is OPEN here —
  the card is made for Grand Island without asking — and holds in the sibling
  app, whose card waits for a location and says the manager cannot file there.
- sf-s11, sf-s15: here turn 3 edits the first card, and sf-s15 cites Standards
  of Conduct instead of Care and Cleaning; in the sibling app both get no card.
- sf-s12, sf-s13, sf-b5: here the abbreviation, the product and the typed name
  become the card's employee as typed; in the sibling app they are looked up
  on the roster and refused.
- sf-s16: this app's card cites Standards of Conduct p.12 and the case checks
  the page; the sibling app's card names the section only.
- sf-s17, sf-s19, sf-b5: here the warning level the manager named is kept on
  the card; the sibling app reads it as earlier history and asks again.
- sf-s18 holds in both apps.
