-- ---------------------------------------------------------------------------
-- WHAT LEADERS USE ASK SUNNY FOR — the business topics.
--
-- The first cut of `activity_category` could say which FEATURE was invoked:
-- chat, forms, knowledge, reports. That answers "which button did they press"
-- and not "what did they need", and the second is the question this dashboard
-- exists for. A manager asking about a no-call-no-show and a manager asking
-- about lamp replacement were both "general guidance".
--
-- THE NINE VALUES BELOW ARE NOT INVENTED. Each one is a business topic the
-- product already has a vocabulary for — they are the `KnowledgeCategory` values
-- that every indexed document carries and every citation reports:
--
--   leadership_coaching     -> coaching_guidance
--   operations              -> salon_operations
--   equipment_procedures    -> equipment_maintenance
--   training                -> training
--   sales_client_experience -> membership_sales
--   bonuses_compensation    -> pay_bonus
--   safety                  -> safety_hr
--
-- plus `hiring_onboarding`, which is the CONVERSATION about hiring as distinct
-- from `hiring_form`, the filed interview record; and `unclassified`, which is
-- the honest answer when nothing identified the turn at all.
--
-- `other` gets no category on purpose. Six of the forty documents in this
-- corpus are filed as "other", and a document nobody categorised says nothing
-- about what a question was about.
--
-- STILL NO QUESTION TEXT. `activity_events` gains no column here and never
-- will: the question is read in memory on the server to pick one of these
-- values and is discarded when the request returns.
--
-- ADDITIVE AND IRREVERSIBLE BY NATURE. `alter type ... add value` cannot be
-- undone without rewriting the type, which is why each is `if not exists` and
-- why this is its own migration: Postgres will not let a new enum value be USED
-- in the same transaction that adds it, so the value and any code reading it
-- have to be committed separately.
-- ---------------------------------------------------------------------------

alter type public.activity_category add value if not exists 'coaching_guidance';
alter type public.activity_category add value if not exists 'salon_operations';
alter type public.activity_category add value if not exists 'equipment_maintenance';
alter type public.activity_category add value if not exists 'training';
alter type public.activity_category add value if not exists 'membership_sales';
alter type public.activity_category add value if not exists 'pay_bonus';
alter type public.activity_category add value if not exists 'safety_hr';
alter type public.activity_category add value if not exists 'hiring_onboarding';
alter type public.activity_category add value if not exists 'unclassified';
