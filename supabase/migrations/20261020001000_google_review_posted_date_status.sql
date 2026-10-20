-- ============================================================================
-- A THIRD WAY A REVIEW COMES TO COUNT: BY THE DATE GOOGLE SAYS IT WAS POSTED
-- ============================================================================
--
-- Its own file because Postgres will not let a new enum value be USED in the
-- transaction that adds it, and every migration here runs in one transaction.
-- `20261020001100_google_review_count_by_posted_date.sql` is the one that uses
-- it, and explains the change.
--
--   historical       Stored, shown, counted toward nothing.
--   anchor_assigned  Proven to sit above its listing's anchor at the sync that
--                    counted it. Counted in the week of that sync.
--   posted_date      Posted on or after its listing's posted-date start, by
--                    Google's own publication instant. Counted in the week —
--                    and the month — it was POSTED, Central.

alter type public.google_review_assignment_status add value if not exists 'posted_date';
