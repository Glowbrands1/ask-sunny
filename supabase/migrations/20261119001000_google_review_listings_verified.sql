-- Google verification cleared on MO Kansas City Wornall (140) and KS Lawrence (314).
--
-- Both were seeded as 'verification_required' in 20260917002000_google_reviews.sql,
-- and nothing updates listing_state afterwards. The Reviews page therefore kept
-- saying "Google verification on two listings" after both profiles were verified.
-- Reported 19 Nov 2026: "canu remove this pls because its verified aldy in sunny".
--
-- Only these two rows, and only while they still say verification_required, so
-- running it twice changes nothing.
update public.google_review_locations
   set listing_state = 'verified'
 where store_code in ('140', '314')
   and listing_state = 'verification_required';
