# Browser QA — invitation, activation, sign-in

Drives the real `/auth/accept` and `/reset-password` pages in Chromium against the
**disposable local stack** (real Supabase Auth, real emails caught by Mailpit).
Every person is synthetic (`@example.test`). The spec refuses to run unless the
Supabase URL is `127.0.0.1`.

```
npm run stack:up
# start the app against the stack (see playwright.config.ts for the exact command)
npm run test:e2e
```
