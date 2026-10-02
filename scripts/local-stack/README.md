# Disposable local stack

A Supabase-shaped stack on `127.0.0.1` for the authentication and access-sync
integration tests. **No cloud resources, no cost, never the Ask Sunny
project.** Every credential in it is a throwaway local value.

```
npm run stack:up          # Postgres 16 + pgvector, Supabase Auth, PostgREST, Mailpit; applies every migration
npm run test:local-stack  # the *.local-stack.test.ts suites (skipped in a normal `npm test`)
npm run stack:down        # stops everything and deletes the data directory
```

| Piece | Source | Port |
|---|---|---|
| Postgres 16 + pgvector | native binaries (`PGBIN`, default `/usr/lib/postgresql/16/bin`) | 54329 |
| Supabase Auth (GoTrue) | `supabase/gotrue:v2.180.0` Docker image | 59999 |
| PostgREST | static binary (`POSTGREST_BIN`, default `/tmp/postgrest`) | 53001 |
| Gateway (`/auth/v1`, `/rest/v1`) | `gateway.mjs` | 54321 |
| Mailpit (catches every email) | `axllent/mailpit:v1.27` Docker image | SMTP 51025, API 58025 |

`bootstrap.sql` reproduces the roles and privileges observed (read-only) in the
Supabase project: `postgres` is not a superuser but bypasses RLS and may
delete auth sessions; `anon` / `authenticated` / `service_role` receive the
same default privileges in `public`. Migrations are applied, in order, as
`postgres`, each in its own transaction.

One pre-existing repository issue is worked around for the LOCAL copy only:
`20260919003000_google_review_url_check_repetition.sql` asserts its own probe
URL is over 500 characters but builds one of about 392, so it cannot apply to
a fresh database. `up.sh` lengthens that probe in a temporary copy; the file
in `supabase/migrations` is untouched.

Requires root (Postgres runs as the `postgres` OS user), Docker and Node.
