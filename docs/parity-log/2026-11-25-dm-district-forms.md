# A district or region scope reads and files forms at its salons (Ask Sunny only, 25 Nov 2026)

**Request (Pau, 25 Nov 2026):** "are Dms able to see the forms that their managers are submitting?" — then "there is in
sunny though?" (a district-to-salon map) and "i need this in sunny please".

**Changed (Ask Sunny):** `authorizedSalonIds` (`src/lib/forms/location-scope.ts`) resolves a `district` or `region`
scope through the roster (`PRODUCTION_SALONS`, via Reporting's `authorizedSalonNumbers`) instead of naming no salon.
So for an account whose scope in User Management is a district (or region):
- reading (`forms-visibility.ts`): Form Monitoring, the Overview queue, the badge and the chat's forms on file add
  every salon of that district or region to the salons Woven assigns them;
- filing (`authorizeLocation`, `proposeLocation`): a form may name any of those salons, and the card asks which one
  instead of saying the district cannot be verified.

A stored `global` scope still grants no salon when reading (every account carries it), and a district the roster does
not know names none (fails closed).

**Ask Bubbles: not ported, on purpose for now.** Bubbles' `authorizedLocationIds` already expands a district or region
through its roster (`locationIdsInArea`), so filing works there. Its `forms-visibility.ts` still reads only a
`location` scope's stores plus Woven, so a Bubbles DM with a district scope reads only their Woven stores. The same
two-line change would widen who reads Buff City Soap HR records, so it waits for the owner to ask for it in Bubbles.

**Tests:** `src/app/api/forms/dm-district-forms-visibility.test.ts`; replay
`src/app/api/chat/replay-pack/nov25-dm-district-forms-cases.ts`. Both fail before the change.
