# FUZZY_SALON_ASKS: a salon the words only resemble is asked, not filed

**Change.** QA's Sunny 38h live check (Admin, all areas, off-roster person): "at omaha west" was filed as NE Omaha
Pacific by the trigram guess (`intake-augment.ts` `uniqueRosterSalon` / `fuzzySalon`, `grounded-entities.ts`), and
"because she was at lincoln high" as NE Lincoln Pine Lake by the card's partial-name fallback (`form-card-slots.ts`
`salonIdsIn`), unasked, while the reply said "this form won't name one". With `FUZZY_SALON_ASKS_ENABLED` a salon only
a resemblance reader supplied is asked ("I read … as … — is that the salon?"), and a card that names a salon never
says "won't name one" (`ai/loose-salon-ask.ts`). This ports the mechanism of Ask Bubbles' #881 (FUZZY_STORE_ASKS).

**Ask Bubbles: not needed.** Ask Bubbles has the same trigram guessers (`uniqueRosterStore` / `fuzzyStore`), but its
stores are named by city, and a guess lands only where the city has a single store, which the mention reader already
files ("at bellevue high" → Bellevue, NE). A city two stores share gives no guess ("at sioux falls west" → none,
probed on Ask Bubbles 6d6b5d42). There is no multi-word store name whose one long word could stand for it, so neither
failure happens there. Close spellings are already asked by #881.
