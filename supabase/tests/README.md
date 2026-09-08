# Migration verification harness

`reporting_schema_checks.sql` proves the behaviours the reporting migrations
are supposed to guarantee — supersession, idempotency, the basis-year rule,
the zero-padding hazard, RLS and privileges — by applying them to a **throwaway
local PostgreSQL cluster** and then trying to break them.

This is not a substitute for applying migrations to Supabase. It is the step
before that: catching, locally and for free, the class of defect that was
previously only found by applying migrations to the live project.

`bed_spa_schema_checks.sql` does the same for the Bed Usage, SPA Wellness and
Spa Engagement migrations. Its most valuable steps are the ones a comment
cannot enforce:

- a **zero-session spa row is refused by Postgres**, not merely avoided by the
  parser — which is what stops any later `avg()` from counting equipment that
  is not installed as equipment that is failing;
- **MTD, YTD and LTM through the same day are three distinct periods**, so a
  year's spa sessions cannot be divided by a month's tanning traffic;
- **supersession is scoped to (period, company)**: a corrected report replaces
  its own month and a backfill of an earlier month supersedes nothing;
- an **unresolved salon name comes back to the caller** and no salon is
  invented for it;
- **Spa Per Unique % and Spa Sessions per Unique Tanner per Spa Bed** come out
  of the read view as separate columns whose ratio is exactly the bed count.

`src/lib/config/reporting-schema.test.ts` covers the same invariants statically
and runs in the normal `npm test` suite. This file covers what static text
analysis cannot: whether Postgres actually enforces them.

## Running it

Needs PostgreSQL 16 and pgvector (`postgresql-16-pgvector`) on the machine —
`supabase_stub.sql` stands in for the Supabase-managed objects the migrations
reference (`extensions`, `auth.users`, `storage.buckets`, the `anon` /
`authenticated` / `service_role` roles), **including Supabase's own
`alter default privileges ... grant all on tables to anon, authenticated`.**
That default is what caused two real privilege defects in the knowledge
migrations, so reproducing it locally is the point rather than a detail.

```bash
initdb -D /var/tmp/asksunny-pg -U postgres --auth=trust
pg_ctl -D /var/tmp/asksunny-pg -o '-p 55432 -k /var/tmp' start
createdb -h /var/tmp -p 55432 -U postgres asksunny

psql -h /var/tmp -p 55432 -U postgres -d asksunny -v ON_ERROR_STOP=1 \
  -f supabase/tests/supabase_stub.sql
for f in supabase/migrations/*.sql; do
  psql -h /var/tmp -p 55432 -U postgres -d asksunny -v ON_ERROR_STOP=1 -q -f "$f" || break
done
psql -h /var/tmp -p 55432 -U postgres -d asksunny -f supabase/tests/reporting_schema_checks.sql
```

Every `MUST FAIL` step below is expected to print an error. A step that
succeeds where it says MUST FAIL is a regression.

All data in the checks is invented. No report content appears anywhere here.
