# Analytics: L10, Form Monitoring, AI Training, Google Reviews, Calendar

Pau, 28 Nov 2026: "add usage for the L10 all meetings and the form monitoring as well pls, and list all users per
name and backfill it please not just by title", "also add ai training", "add google reviews too and calendar".

## What is counted

| Area | From history (already in the database) | From this release |
| --- | --- | --- |
| L10 Meetings | one-off backfill of the Leadership Hub's save history (below) | each Central day a person opens an L10 meeting in Ask Sunny |
| Form Monitoring | archive, unarchive and every follow-up action (`form_instance_events`) | each day a person opens Form Monitoring |
| AI Training | submitted assignments (`ai_training_submissions`) | each day a person opens AI Training |
| Google Reviews | (nothing per person was recorded; questions asked from the Reviews page stay under Ask Sunny, surface "Google Reviews") | each day a person opens Google Reviews |
| Calendar | saved reminders (`calendar_reminders`) | each day a person opens the Calendar |

A day of use is one row in `app_usage_days` (person, area, L10 meeting, Central day), written by `noteAppUsage`
(`src/lib/analytics/app-usage.ts`) after the page is sent, and counted by `activity_unified` as one event. The
Analytics page shows each area in "Which parts of Ask Sunny are used" and per person in "Usage by person".

Names: an account whose name is one word gets its surname from a `first.last@` email with the same first name
(`src/lib/analytics/person-name.ts`), on the Analytics page only.

## The L10 backfill (run once, after both migrations)

The Hub keeps every save of a meeting (`l10.meeting_state_history`, `saved_by` = a Hub auth user). One row per
person, meeting and Central day, for the meetings Ask Sunny opens, matched to Ask Sunny accounts by email. Saves made
in the Hub itself are included: it is the same meeting. Re-running it is safe (`on conflict do nothing`).

1. In the Leadership Hub's database:

   ```sql
   select h.meeting_key, lower(u.email) as email, (h.saved_at at time zone 'America/Chicago')::date as day,
          min(h.saved_at) as first_at, max(h.saved_at) as last_at, count(*) as hits
   from l10.meeting_state_history h join auth.users u on u.id = h.saved_by
   where h.meeting_key in ('stc-dm', 'stc-sd-one', 'stc-sd-two', 'stc-sd-three')
   group by 1, 2, 3;
   ```

2. In Ask Sunny's database, with those rows as `hub(meeting_key, email, day, first_at, last_at, hits)`:

   ```sql
   insert into public.app_usage_days (user_id, area, detail, day, first_at, last_at, hits, actor_role, source)
   select u.id, 'l10', hub.meeting_key, hub.day, hub.first_at, hub.last_at, hub.hits, u.role, 'backfill'
   from (values /* the rows from step 1 */) as hub(meeting_key, email, day, first_at, last_at, hits)
   join public.app_users u on lower(u.email) = hub.email
   on conflict (user_id, area, detail, day) do nothing;
   ```

Hub accounts with no Ask Sunny account of the same email are left out (they are not on this roster).
